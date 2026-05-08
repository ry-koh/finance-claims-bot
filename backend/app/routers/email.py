import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_supabase
from app.auth import require_finance_team
from app.routers.bot import send_bot_notification
from app.services.events import log_claim_event
from app.services import gmail as gmail_service
from app.services import pdf as pdf_service
from app.services.app_settings import get_document_finance_director
from app.utils.rate_limit import guard

router = APIRouter(prefix="/email", tags=["email"])


def _fetch_claim_email_data(db, claim_id: str) -> tuple[dict, list[dict], list[dict]]:
    claim_resp = (
        db.table("claims")
        .select("*, claimer:finance_team!claims_claimer_id_fkey(id, name, email, matric_number, phone_number), cca:ccas(name, portfolio:portfolios(name))")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_resp.data

    receipts_resp = db.table("receipts").select("*").eq("claim_id", claim_id).execute()
    receipts = receipts_resp.data or []
    if receipts:
        receipt_ids = [r["id"] for r in receipts]
        image_resp = (
            db.table("receipt_images")
            .select("*")
            .in_("receipt_id", receipt_ids)
            .order("created_at")
            .execute()
        )
        images_by_receipt: dict = {}
        for img in image_resp.data or []:
            images_by_receipt.setdefault(img["receipt_id"], []).append(img)
        for receipt in receipts:
            receipt["images"] = images_by_receipt.get(receipt["id"], [])

    bt_resp = db.table("bank_transactions").select("*").eq("claim_id", claim_id).execute()
    bank_transactions = bt_resp.data or []
    if bank_transactions:
        bt_ids = [bt["id"] for bt in bank_transactions]
        image_resp = (
            db.table("bank_transaction_images")
            .select("*")
            .in_("bank_transaction_id", bt_ids)
            .order("created_at")
            .execute()
        )
        images_by_bt: dict = {}
        for img in image_resp.data or []:
            images_by_bt.setdefault(img["bank_transaction_id"], []).append(img)

        refund_resp = (
            db.table("bank_transaction_refunds")
            .select("*")
            .in_("bank_transaction_id", bt_ids)
            .order("created_at")
            .execute()
        )
        refunds_by_bt: dict = {}
        for refund in refund_resp.data or []:
            refunds_by_bt.setdefault(refund["bank_transaction_id"], []).append(refund)

        for bt in bank_transactions:
            bt["images"] = images_by_bt.get(bt["id"], [])
            bt["refunds"] = refunds_by_bt.get(bt["id"], [])

    return claim, receipts, bank_transactions


def _normalize_claim_claimer(claim: dict) -> str:
    raw_claimer = claim.get("claimer") or {}
    claimer_email = claim.get("one_off_email") or raw_claimer.get("email") or ""
    if not claimer_email:
        raise HTTPException(status_code=400, detail="Claimer does not have an email address")
    claim["claimer"] = {
        "name": claim.get("one_off_name") or raw_claimer.get("name") or "",
        "matric_no": claim.get("one_off_matric_no") or raw_claimer.get("matric_number") or "",
        "phone": claim.get("one_off_phone") or raw_claimer.get("phone_number") or "",
        "email": claimer_email,
        "cca": claim.get("cca") or {},
    }
    return claimer_email


# ---------------------------------------------------------------------------
# POST /email/send/{claim_id}
# ---------------------------------------------------------------------------

@router.post("/send/{claim_id}")
async def send_claim_email(
    claim_id: str,
    _member: dict = Depends(require_finance_team),
    db=Depends(get_supabase),
):
    """
    Build and send the claim confirmation email to the claimer.

    - Fetches claim with nested claimer + cca data.
    - Validates claimer has an email address.
    - Validates claim status is 'draft', 'pending_review', or 'email_sent' (allows re-send).
    - Sends email with receipt image attachments.
    - Updates claim status to 'email_sent'.
    """
    guard(f"email:{claim_id}", max_calls=2, window_seconds=30)

    claim, receipts, bank_transactions = _fetch_claim_email_data(db, claim_id)
    claimer_email = _normalize_claim_claimer(claim)

    # 5. Validate claim status
    allowed_statuses = {"draft", "pending_review", "email_sent"}
    current_status = claim.get("status") or ""
    if current_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot send email for claim with status '{current_status}'. "
                f"Allowed statuses: {sorted(allowed_statuses)}"
            ),
        )

    try:
        # 6. Build email
        msg = gmail_service.build_claim_email(
            claim,
            receipts,
            bank_transactions,
            finance_director=get_document_finance_director(db),
        )

        # Set headers
        reference_code = claim.get("reference_code") or ""
        msg["To"] = claimer_email
        msg["Subject"] = reference_code

        # 7. Send
        message_id = gmail_service.send_email(claimer_email, reference_code, msg)

        # 8. Update claim status to email_sent
        db.table("claims").update(
            {"status": "email_sent", "error_message": None}
        ).eq("id", claim_id).execute()
        log_claim_event(
            db,
            claim_id,
            _member.get("id"),
            "email_sent",
            "Confirmation email sent",
            {"sent_to": claimer_email, "message_id": message_id},
        )

        # Notify the treasurer who created the claim
        filled_by_id = claim.get("filled_by")
        if filled_by_id:
            ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
            if ft.data and ft.data[0].get("telegram_id"):
                ref = claim.get("reference_code", "your claim")
                asyncio.create_task(send_bot_notification(
                    ft.data[0]["telegram_id"],
                    f"📧 Confirmation email sent for claim {ref}."
                ))

    except HTTPException:
        raise
    except Exception as exc:
        # Update status to error with message
        try:
            db.table("claims").update(
                {"status": "error", "error_message": str(exc)}
            ).eq("id", claim_id).execute()
            log_claim_event(
                db,
                claim_id,
                _member.get("id"),
                "email_failed",
                "Confirmation email failed",
                {"error": str(exc)[:300]},
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send email: {exc}",
        )

    # 9. Return result
    return {
        "success": True,
        "message_id": message_id,
        "sent_to": claimer_email,
        "claim_status": "email_sent",
    }


# ---------------------------------------------------------------------------
# POST /email/resend/{claim_id}
# ---------------------------------------------------------------------------

@router.post("/resend/{claim_id}")
async def resend_claim_email(
    claim_id: str,
    _member: dict = Depends(require_finance_team),
    db=Depends(get_supabase),
):
    """
    Re-send the claim confirmation email to the claimer.

    Same as /send but allows any claim status (for cases where the claimer
    did not receive the original email).  Does NOT update claim status.
    """
    guard(f"email:{claim_id}", max_calls=2, window_seconds=30)

    claim, receipts, bank_transactions = _fetch_claim_email_data(db, claim_id)
    claimer_email = _normalize_claim_claimer(claim)

    try:
        # 5. Build email
        msg = gmail_service.build_claim_email(
            claim,
            receipts,
            bank_transactions,
            finance_director=get_document_finance_director(db),
        )

        # Set headers
        reference_code = claim.get("reference_code") or ""
        msg["To"] = claimer_email
        msg["Subject"] = reference_code

        # 6. Send
        message_id = gmail_service.send_email(claimer_email, reference_code, msg)
        log_claim_event(
            db,
            claim_id,
            _member.get("id"),
            "email_resent",
            "Confirmation email resent",
            {"sent_to": claimer_email, "message_id": message_id},
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to resend email: {exc}",
        )

    # 7. Return result (status NOT updated)
    return {
        "success": True,
        "message_id": message_id,
        "sent_to": claimer_email,
        "claim_status": claim.get("status"),
    }
