import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_supabase
from app.auth import require_finance_team
from app.routers.bot import send_bot_notification
from app.services import gmail as gmail_service
from app.services import pdf as pdf_service

router = APIRouter(prefix="/email", tags=["email"])


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
    # 1. Fetch full claim
    claim_resp = (
        db.table("claims")
        .select("*, claimer:claimers(*, cca:ccas(*))")
        .eq("id", claim_id)
        .single()
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_resp.data

    # 2. Fetch all receipts
    receipts_resp = (
        db.table("receipts")
        .select("*")
        .eq("claim_id", claim_id)
        .execute()
    )

    # 3. Fetch bank transactions with refunds
    bt_resp = (
        db.table("bank_transactions")
        .select("*, refunds:bank_transaction_refunds(*)")
        .eq("claim_id", claim_id)
        .execute()
    )

    # 4. Validate claimer email
    claimer = claim.get("claimer") or {}
    claimer_email = claimer.get("email") or ""
    if not claimer_email:
        raise HTTPException(
            status_code=400,
            detail="Claimer does not have an email address",
        )

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
        msg = gmail_service.build_claim_email(claim, receipts_resp.data, bt_resp.data)

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

        # Notify the treasurer who created the claim
        filled_by_id = claim.get("filled_by")
        if filled_by_id:
            ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
            if ft.data and ft.data[0].get("telegram_id"):
                ref = claim.get("reference_code", "your claim")
                asyncio.create_task(send_bot_notification(
                    ft.data[0]["telegram_id"],
                    f"📧 The confirmation email for claim {ref} has been sent to the claimer.\n\nPlease remind them to check their email and follow the instructions to reply."
                ))

    except HTTPException:
        raise
    except Exception as exc:
        # Update status to error with message
        try:
            db.table("claims").update(
                {"status": "error", "error_message": str(exc)}
            ).eq("id", claim_id).execute()
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
    # 1. Fetch full claim
    claim_resp = (
        db.table("claims")
        .select("*, claimer:claimers(*, cca:ccas(*))")
        .eq("id", claim_id)
        .single()
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_resp.data

    # 2. Fetch all receipts
    receipts_resp = (
        db.table("receipts")
        .select("*")
        .eq("claim_id", claim_id)
        .execute()
    )

    # 3. Fetch bank transactions with refunds
    bt_resp = (
        db.table("bank_transactions")
        .select("*, refunds:bank_transaction_refunds(*)")
        .eq("claim_id", claim_id)
        .execute()
    )

    # 4. Validate claimer email
    claimer = claim.get("claimer") or {}
    claimer_email = claimer.get("email") or ""
    if not claimer_email:
        raise HTTPException(
            status_code=400,
            detail="Claimer does not have an email address",
        )

    try:
        # 5. Build email
        msg = gmail_service.build_claim_email(claim, receipts_resp.data, bt_resp.data)

        # Set headers
        reference_code = claim.get("reference_code") or ""
        msg["To"] = claimer_email
        msg["Subject"] = reference_code

        # 6. Send
        message_id = gmail_service.send_email(claimer_email, reference_code, msg)

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
