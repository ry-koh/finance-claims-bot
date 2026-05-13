import asyncio
import csv
import io
import logging
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel
from supabase import Client

from app.auth import get_claim_for_member, require_auth, require_director, require_finance_team
from app.config import settings
from app.database import get_supabase
from app.models import ClaimCreate, ClaimStatus, ClaimUpdate, WBSAccount
from app.routers.bot import send_bot_notification
from app.services import r2 as r2_service
from app.services.events import log_claim_event
from app.services.storage import insert_file_row
from app.utils.rate_limit import guard


class BulkStatusUpdate(PydanticBaseModel):
    claim_ids: list[str]
    status: ClaimStatus


class RejectReviewRequest(PydanticBaseModel):
    comment: str


class AttachmentRequestBody(PydanticBaseModel):
    message: str


class ReimbursementClaimsRequest(PydanticBaseModel):
    claim_ids: list[str]


class ClaimsListResponse(PydanticBaseModel):
    items: list[dict]
    total: int
    page: int
    page_size: int


class BulkStatusResponse(PydanticBaseModel):
    updated: int
    skipped: int


EMAIL_REMINDER_STATUSES = {"email_sent", "screenshot_pending"}

router = APIRouter(prefix="/claims", tags=["claims"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STALE_TRIGGER_FIELDS = {
    "claim_description",
    "wbs_account",
    "total_amount",
    "claimer_id",
    "transport_form_needed",
    "is_partial",
}


def _claim_update_requires_treasurer_draft(update_data: dict) -> bool:
    return set(update_data.keys()) != {"treasurer_notes"}


def _slug(text: str) -> str:
    """Upper-case and remove spaces."""
    return text.upper().replace(" ", "")


def _get_claim_or_404(db: Client, claim_id: str) -> dict:
    resp = (
        db.table("claims")
        .select("*")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    return resp.data[0]


def _email_send_reminder_message(claim: dict) -> str:
    ref = claim.get("reference_code") or f"claim {claim.get('id')}"
    description = claim.get("claim_description") or "your claim"
    return "\n".join([
        f"Reminder: please send the confirmation email for {ref}.",
        "",
        f"Claim: {description}",
        "",
        "Steps:",
        "1. Open the confirmation email from Finance.",
        "2. Copy everything below the line into a new email.",
        "3. Check the To, CC, and Subject fields.",
        "4. Send the email.",
        "5. Send the sent-email screenshot back to Finance so we can continue processing the claim.",
    ])


def _email_send_bulk_reminder_message(claims: list[dict]) -> str:
    lines = [
        "Reminder: please send the confirmation email screenshot for the claim(s) below.",
        "",
        "Waiting claims:",
    ]
    for claim in claims:
        ref = claim.get("reference_code") or f"claim {claim.get('id')}"
        description = claim.get("claim_description") or "your claim"
        lines.append(f"- {ref}: {description}")
    lines.extend([
        "",
        "Steps:",
        "1. Open the confirmation email from Finance.",
        "2. Copy everything below the line into a new email.",
        "3. Check the To, CC, and Subject fields.",
        "4. Send the email.",
        "5. Send the sent-email screenshot back to Finance so we can continue processing the claim.",
    ])
    return "\n".join(lines)


def _add_file_ref(r2_paths: set[str], drive_file_ids: set[str], file_id: str | None) -> None:
    """Split stored file IDs into R2 object names and Google Drive IDs."""
    if not file_id:
        return
    value = str(file_id)
    if "/" in value:
        r2_paths.add(value)
    else:
        drive_file_ids.add(value)


def _add_file_refs(r2_paths: set[str], drive_file_ids: set[str], file_ids: list[str] | None) -> None:
    for file_id in file_ids or []:
        _add_file_ref(r2_paths, drive_file_ids, file_id)


def _normalise_claim_ids(claim_ids: list[str]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for raw in claim_ids:
        try:
            claim_id = str(uuid_lib.UUID(str(raw).strip()))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid claim ID: {raw}") from exc
        if claim_id not in seen:
            ids.append(claim_id)
            seen.add(claim_id)
    return ids


def _normalise_statuses(statuses: str | None) -> list[str]:
    if not statuses:
        return []
    allowed = {status.value for status in ClaimStatus}
    result: list[str] = []
    for raw in statuses.split(","):
        status = raw.strip()
        if not status:
            continue
        if status not in allowed:
            raise HTTPException(status_code=422, detail=f"Invalid claim status: {status}")
        if status not in result:
            result.append(status)
    return result


def _money(value) -> float:
    return round(float(value or 0), 2)


def _format_money(value) -> str:
    return f"SGD {_money(value):.2f}"


def _claim_payee(claim: dict) -> dict:
    claimer = claim.get("claimer") or {}
    if claim.get("claimer_id"):
        return {
            "key": f"member:{claim['claimer_id']}",
            "name": claimer.get("name") or "Unknown claimer",
            "phone_number": claimer.get("phone_number") or "",
            "email": claimer.get("email") or "",
            "telegram_id": claimer.get("telegram_id"),
            "payee_type": "registered",
        }

    name = claim.get("one_off_name") or "One-off claimer"
    phone = claim.get("one_off_phone") or ""
    email = claim.get("one_off_email") or ""
    return {
        "key": f"oneoff:{name.lower()}|{phone}|{email.lower()}",
        "name": name,
        "phone_number": phone,
        "email": email,
        "telegram_id": None,
        "payee_type": "one_off",
    }


def _fetch_reimbursement_claims(db: Client, claim_ids: list[str]) -> list[dict]:
    if not claim_ids:
        return []
    resp = (
        db.table("claims")
        .select(
            "id, reference_code, status, total_amount, claim_description, date, "
            "internal_notes, one_off_name, one_off_phone, one_off_email, claimer_id, "
            "claimer:finance_team!claims_claimer_id_fkey(id, name, email, phone_number, telegram_id)"
        )
        .in_("id", claim_ids)
        .is_("deleted_at", "null")
        .execute()
    )
    order = {claim_id: idx for idx, claim_id in enumerate(claim_ids)}
    return sorted(resp.data or [], key=lambda row: order.get(row.get("id"), len(order)))


def _build_reimbursement_preview(db: Client, claim_ids: list[str]) -> dict:
    claims = _fetch_reimbursement_claims(db, claim_ids)
    found_ids = {claim["id"] for claim in claims}
    skipped = [
        {"id": claim_id, "reason": "Claim was not found"}
        for claim_id in claim_ids
        if claim_id not in found_ids
    ]
    groups_by_key: dict[str, dict] = {}

    for claim in claims:
        if claim.get("status") != ClaimStatus.SUBMITTED.value:
            skipped.append({
                "id": claim["id"],
                "reference_code": claim.get("reference_code"),
                "reason": "Claim is not submitted",
            })
            continue

        payee = _claim_payee(claim)
        group = groups_by_key.setdefault(payee["key"], {
            **payee,
            "claim_count": 0,
            "total_amount": 0.0,
            "claims": [],
        })
        amount = _money(claim.get("total_amount"))
        group["claim_count"] += 1
        group["total_amount"] = _money(group["total_amount"] + amount)
        group["claims"].append({
            "id": claim["id"],
            "reference_code": claim.get("reference_code"),
            "amount": amount,
            "description": claim.get("claim_description") or "",
            "date": claim.get("date"),
            "internal_notes": claim.get("internal_notes") or "",
        })

    groups = sorted(groups_by_key.values(), key=lambda group: group["name"].lower())
    return {
        "groups": groups,
        "skipped": skipped,
        "total_claims": sum(group["claim_count"] for group in groups),
        "total_payees": len(groups),
        "total_amount": _money(sum(group["total_amount"] for group in groups)),
        "notifiable_payees": sum(1 for group in groups if group.get("telegram_id")),
    }


def _reimbursement_message(group: dict) -> str:
    claim_lines = [
        f"- {claim.get('reference_code') or claim['id']}: {_format_money(claim.get('amount'))}"
        for claim in group["claims"]
    ]
    claim_word = "claim" if len(group["claims"]) == 1 else "claims"
    return (
        "Reimbursement completed.\n\n"
        f"You should have received {_format_money(group['total_amount'])} for "
        f"{len(group['claims'])} {claim_word}:\n"
        + "\n".join(claim_lines)
        + "\n\nPlease verify that the PayLah/PayNow payment was received."
    )


def _get_current_attachment_request(db: Client, claim_id: str) -> dict | None:
    """Return the latest pending or submitted attachment request for a claim."""
    resp = (
        db.table("claim_attachment_requests")
        .select("*")
        .eq("claim_id", claim_id)
        .in_("status", ["pending", "submitted"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def _attach_readiness_summaries(db: Client, claims: list[dict]) -> None:
    """Attach lightweight missing-attachment counters used by list cards."""
    claim_ids = [c["id"] for c in claims if c.get("id")]
    if not claim_ids:
        return

    receipts_resp = (
        db.table("receipts")
        .select(
            "id, claim_id, bank_transaction_id, receipt_no, amount, receipt_image_drive_id, "
            "bank_screenshot_drive_id, is_foreign_currency, "
            "exchange_rate_screenshot_drive_id, exchange_rate_screenshot_drive_ids"
        )
        .in_("claim_id", claim_ids)
        .execute()
    )
    receipts = receipts_resp.data or []
    receipts_by_claim: dict[str, list[dict]] = {}
    for receipt in receipts:
        receipts_by_claim.setdefault(receipt["claim_id"], []).append(receipt)

    receipt_ids = [r["id"] for r in receipts]
    receipt_image_counts: dict[str, int] = {}
    if receipt_ids:
        image_resp = db.table("receipt_images").select("receipt_id").in_("receipt_id", receipt_ids).execute()
        for image in image_resp.data or []:
            receipt_id = image["receipt_id"]
            receipt_image_counts[receipt_id] = receipt_image_counts.get(receipt_id, 0) + 1

    bt_resp = db.table("bank_transactions").select("id, claim_id, amount").in_("claim_id", claim_ids).execute()
    bank_transactions = bt_resp.data or []
    bts_by_claim: dict[str, list[dict]] = {}
    for bt in bank_transactions:
        bts_by_claim.setdefault(bt["claim_id"], []).append(bt)

    bt_ids = [bt["id"] for bt in bank_transactions]
    bt_image_counts: dict[str, int] = {}
    refunds_by_bt: dict[str, float] = {}
    if bt_ids:
        bt_image_resp = db.table("bank_transaction_images").select("bank_transaction_id").in_("bank_transaction_id", bt_ids).execute()
        for image in bt_image_resp.data or []:
            bt_id = image["bank_transaction_id"]
            bt_image_counts[bt_id] = bt_image_counts.get(bt_id, 0) + 1
        refund_resp = db.table("bank_transaction_refunds").select("bank_transaction_id, amount").in_("bank_transaction_id", bt_ids).execute()
        for refund in refund_resp.data or []:
            bt_id = refund["bank_transaction_id"]
            refunds_by_bt[bt_id] = refunds_by_bt.get(bt_id, 0.0) + float(refund.get("amount") or 0)

    for claim in claims:
        claim_receipts = receipts_by_claim.get(claim["id"], [])
        claim_bts = bts_by_claim.get(claim["id"], [])
        missing_receipt_images = 0
        missing_bank_links = 0
        missing_fx = 0
        receipt_amounts_by_bt: dict[str, float] = {}

        for receipt in claim_receipts:
            receipt_no = str(receipt.get("receipt_no") or "")
            bt_id = receipt.get("bank_transaction_id")
            is_bank_only_receipt = (
                bool(bt_id)
                and receipt_no.upper().startswith("BT")
                and receipt_no[2:].isdigit()
            )
            bank_only_has_proof = is_bank_only_receipt and bt_image_counts.get(bt_id, 0) > 0
            if not bank_only_has_proof and not receipt.get("receipt_image_drive_id") and receipt_image_counts.get(receipt["id"], 0) == 0:
                missing_receipt_images += 1
            if not receipt.get("bank_transaction_id") and not receipt.get("bank_screenshot_drive_id"):
                missing_bank_links += 1
            if receipt.get("bank_transaction_id"):
                bt_id = receipt["bank_transaction_id"]
                receipt_amounts_by_bt[bt_id] = receipt_amounts_by_bt.get(bt_id, 0.0) + float(receipt.get("amount") or 0)
            fx_ids = receipt.get("exchange_rate_screenshot_drive_ids") or []
            if receipt.get("is_foreign_currency") and not receipt.get("exchange_rate_screenshot_drive_id") and not fx_ids:
                missing_fx += 1

        missing_bt_images = sum(1 for bt in claim_bts if bt_image_counts.get(bt["id"], 0) == 0)
        amount_mismatches = 0
        for bt in claim_bts:
            linked_total = receipt_amounts_by_bt.get(bt["id"])
            if linked_total is None:
                continue
            net_amount = float(bt.get("amount") or 0) - refunds_by_bt.get(bt["id"], 0.0)
            if abs(linked_total - net_amount) > 0.01:
                amount_mismatches += 1
        mf_ids = claim.get("mf_approval_drive_ids") or []
        mf_missing = claim.get("wbs_account") == "MF" and not claim.get("mf_approval_drive_id") and not mf_ids

        claim["readiness"] = {
            "receipt_count": len(claim_receipts),
            "receipt_missing_images_count": missing_receipt_images,
            "receipt_missing_bank_link_count": missing_bank_links,
            "bank_transaction_count": len(claim_bts),
            "bank_transaction_missing_images_count": missing_bt_images,
            "amount_mismatch_count": amount_mismatches,
            "foreign_receipt_missing_fx_count": missing_fx,
            "mf_approval_missing": mf_missing,
        }


# ---------------------------------------------------------------------------
# GET /claims
# ---------------------------------------------------------------------------

@router.get("", response_model=ClaimsListResponse)
async def list_claims(
    status: Optional[str] = Query(default=None),
    statuses: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    query = (
        db.table("claims")
        .select("*, claimer:finance_team!claims_claimer_id_fkey(id, name)", count="exact")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )

    # Treasurers can only see claims they created
    if _member.get("role") == "treasurer":
        query = query.eq("filled_by", _member["id"])
    else:
        # Finance team / directors: hide draft claims owned by treasurers.
        # These are only visible to the treasurer until they submit for review.
        treasurer_resp = db.table("finance_team").select("id").eq("role", "treasurer").execute()
        treasurer_ids = [t["id"] for t in (treasurer_resp.data or [])]
        if treasurer_ids:
            id_list = ",".join(treasurer_ids)
            # Include row if: no filled_by, OR filled_by is not a treasurer, OR status is not draft
            query = query.or_(f"filled_by.is.null,filled_by.not.in.({id_list}),status.neq.draft")

    status_list = _normalise_statuses(statuses)
    if status and status_list:
        raise HTTPException(status_code=422, detail="Use either status or statuses, not both")
    if status:
        query = query.eq("status", status)
    elif status_list:
        query = query.in_("status", status_list)

    if search and search.strip():
        s = search.strip()
        or_parts = [
            f"reference_code.ilike.%{s}%",
            f"one_off_name.ilike.%{s}%",
        ]
        ft_resp = (
            db.table("finance_team")
            .select("id")
            .ilike("name", f"%{s}%")
            .eq("role", "treasurer")
            .execute()
        )
        ft_ids = [r["id"] for r in (ft_resp.data or [])]
        if ft_ids:
            or_parts.append(f"claimer_id.in.({','.join(ft_ids)})")
        query = query.or_(",".join(or_parts))

    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        from datetime import date as _date, timedelta
        try:
            exclusive_end = (_date.fromisoformat(date_to) + timedelta(days=1)).isoformat()
            query = query.lt("created_at", exclusive_end)
        except ValueError:
            pass

    offset = (page - 1) * page_size
    query = query.range(offset, offset + page_size - 1)

    resp = query.execute()
    total = resp.count if resp.count is not None else len(resp.data)
    items = resp.data or []
    _attach_readiness_summaries(db, items)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------------------------------
# GET /claims/export  — must be before /{claim_id} to avoid path conflict
# ---------------------------------------------------------------------------

@router.get("/export")
async def export_claims(
    status: Optional[str] = Query(default=None),
    statuses: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Export all matching claims as CSV (no pagination)."""
    query = (
        db.table("claims")
        .select(
            "id, reference_code, claim_number, status, claim_description, "
            "total_amount, is_partial, wbs_account, wbs_no, "
            "transport_form_needed, remarks, date, created_at, "
            "one_off_name, one_off_matric_no, one_off_phone, one_off_email, "
            "claimer:finance_team!claims_claimer_id_fkey(id, name)"
        )
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )

    if _member.get("role") == "treasurer":
        query = query.eq("filled_by", _member["id"])
    else:
        treasurer_resp = db.table("finance_team").select("id").eq("role", "treasurer").execute()
        treasurer_ids = [t["id"] for t in (treasurer_resp.data or [])]
        if treasurer_ids:
            id_list = ",".join(treasurer_ids)
            query = query.or_(f"filled_by.is.null,filled_by.not.in.({id_list}),status.neq.draft")

    status_list = _normalise_statuses(statuses)
    if status and status_list:
        raise HTTPException(status_code=422, detail="Use either status or statuses, not both")
    if status:
        query = query.eq("status", status)
    elif status_list:
        query = query.in_("status", status_list)

    if search and search.strip():
        s = search.strip()
        or_parts = [f"reference_code.ilike.%{s}%", f"one_off_name.ilike.%{s}%"]
        ft_resp = (
            db.table("finance_team").select("id").ilike("name", f"%{s}%").eq("role", "treasurer").execute()
        )
        ft_ids = [r["id"] for r in (ft_resp.data or [])]
        if ft_ids:
            or_parts.append(f"claimer_id.in.({','.join(ft_ids)})")
        query = query.or_(",".join(or_parts))

    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        from datetime import date as _date, timedelta
        try:
            exclusive_end = (_date.fromisoformat(date_to) + timedelta(days=1)).isoformat()
            query = query.lt("created_at", exclusive_end)
        except ValueError:
            pass

    resp = query.limit(5000).execute()
    claims = resp.data or []

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Reference Code", "Claimer", "Status", "WBS Account", "WBS No",
        "Total Amount", "Is Partial",
        "Claim Description", "Transport Form", "Date", "Created At",
        "One-off Name", "One-off Matric", "One-off Phone", "One-off Email",
    ])
    for c in claims:
        claimer_name = (c.get("claimer") or {}).get("name") or c.get("one_off_name") or ""
        writer.writerow([
            c.get("reference_code") or "",
            claimer_name,
            c.get("status") or "",
            c.get("wbs_account") or "",
            c.get("wbs_no") or "",
            c.get("total_amount") or "",
            c.get("is_partial") or False,
            c.get("claim_description") or "",
            c.get("transport_form_needed") or False,
            c.get("date") or "",
            (c.get("created_at") or "")[:10],
            c.get("one_off_name") or "",
            c.get("one_off_matric_no") or "",
            c.get("one_off_phone") or "",
            c.get("one_off_email") or "",
        ])

    output.seek(0)
    filename = "claims_export.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# GET /claims/counts  — must be before /{claim_id} to avoid path conflict
# ---------------------------------------------------------------------------

@router.get("/counts", response_model=dict[str, int])
async def get_claim_counts(
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    query = (
        db.table("claims")
        .select("status, filled_by")
        .is_("deleted_at", "null")
    )
    if _member.get("role") == "treasurer":
        query = query.eq("filled_by", _member["id"])
    else:
        treasurer_resp = db.table("finance_team").select("id").eq("role", "treasurer").execute()
        treasurer_ids = [t["id"] for t in (treasurer_resp.data or [])]
        if treasurer_ids:
            id_list = ",".join(treasurer_ids)
            query = query.or_(f"filled_by.is.null,filled_by.not.in.({id_list}),status.neq.draft")
    resp = query.execute()
    counts: dict = {}
    for item in (resp.data or []):
        s = item["status"]
        counts[s] = counts.get(s, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}
# ---------------------------------------------------------------------------

@router.get("/{claim_id}")
async def get_claim(
    claim_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Fetch claim (with claimer)
    claim_resp = (
        db.table("claims")
        .select("*, claimer:finance_team!claims_claimer_id_fkey(id, name, email, matric_number, phone_number), cca:ccas(name, portfolio:portfolios(name))")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_resp.data[0]

    if _member.get("role") == "treasurer" and str(claim.get("filled_by")) != str(_member["id"]):
        raise HTTPException(status_code=403, detail="Access denied")

    # Line items ordered by index
    line_items_resp = (
        db.table("claim_line_items")
        .select("*")
        .eq("claim_id", claim_id)
        .order("line_item_index")
        .execute()
    )

    # Receipts ordered by created_at, with category/gst_code/dr_cr from line_item
    receipts_resp = (
        db.table("receipts")
        .select("*, line_item:claim_line_items(category, gst_code, dr_cr)")
        .eq("claim_id", claim_id)
        .order("created_at")
        .execute()
    )
    for r in receipts_resp.data:
        li = r.pop("line_item", None) or {}
        r["category"] = li.get("category")
        r["gst_code"] = li.get("gst_code")
        r["dr_cr"] = li.get("dr_cr")

    # Fetch receipt images
    if receipts_resp.data:
        receipt_ids = [r["id"] for r in receipts_resp.data]
        ri_resp = db.table("receipt_images").select("*").in_("receipt_id", receipt_ids).order("created_at").execute()
        images_by_receipt: dict = {}
        for img in ri_resp.data:
            images_by_receipt.setdefault(img["receipt_id"], []).append(img)
        for r in receipts_resp.data:
            r["images"] = images_by_receipt.get(r["id"], [])
    else:
        for r in receipts_resp.data:
            r["images"] = []

    # Fetch bank transactions with their images
    bt_resp = db.table("bank_transactions").select("*").eq("claim_id", claim_id).order("created_at").execute()
    bank_transactions = bt_resp.data
    if bank_transactions:
        bt_ids = [bt["id"] for bt in bank_transactions]
        bti_resp = db.table("bank_transaction_images").select("*").in_("bank_transaction_id", bt_ids).order("created_at").execute()
        images_by_bt: dict = {}
        for img in bti_resp.data:
            images_by_bt.setdefault(img["bank_transaction_id"], []).append(img)
        for bt in bank_transactions:
            bt["images"] = images_by_bt.get(bt["id"], [])

    # Fetch refunds for each bank transaction
    if bank_transactions:
        btr_resp = db.table("bank_transaction_refunds").select("*").in_(
            "bank_transaction_id", bt_ids
        ).order("created_at").execute()
        refunds_by_bt: dict = {}
        for ref in btr_resp.data:
            refunds_by_bt.setdefault(ref["bank_transaction_id"], []).append(ref)
        for bt in bank_transactions:
            bt["refunds"] = refunds_by_bt.get(bt["id"], [])
            bt["net_amount"] = float(bt.get("amount") or 0) - sum(float(r["amount"]) for r in bt["refunds"])
    else:
        for bt in bank_transactions:
            bt["refunds"] = []
            bt["net_amount"] = float(bt.get("amount") or 0)

    # Documents — only current
    docs_resp = (
        db.table("claim_documents")
        .select("*")
        .eq("claim_id", claim_id)
        .eq("is_current", True)
        .execute()
    )

    claim["line_items"] = line_items_resp.data
    claim["receipts"] = receipts_resp.data
    claim["documents"] = docs_resp.data
    claim["bank_transactions"] = bank_transactions
    _attach_readiness_summaries(db, [claim])

    return claim


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/line-items — Get all line items with nested receipts
# ---------------------------------------------------------------------------

@router.get("/{claim_id}/events")
async def get_claim_events(
    claim_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return the audit timeline for a claim. Empty until the claim_events migration is run."""
    get_claim_for_member(db, claim_id, _member)
    try:
        resp = (
            db.table("claim_events")
            .select("*")
            .eq("claim_id", claim_id)
            .order("created_at")
            .execute()
        )
    except Exception:
        return []
    events = resp.data or []
    actor_ids = list({event["actor_id"] for event in events if event.get("actor_id")})
    actors: dict[str, dict] = {}
    if actor_ids:
        actor_resp = (
            db.table("finance_team")
            .select("id, name, role")
            .in_("id", actor_ids)
            .execute()
        )
        actors = {actor["id"]: actor for actor in (actor_resp.data or [])}
    for event in events:
        event["actor"] = actors.get(event.get("actor_id"))
    return events


@router.get("/{claim_id}/line-items")
async def get_claim_line_items(
    claim_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """
    Return all line items for a claim ordered by line_item_index,
    each with its receipts list nested inside.
    """
    # Verify claim exists (and check treasurer ownership)
    resp = (
        db.table("claims")
        .select("id, filled_by")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    if _member.get("role") == "treasurer" and str(resp.data[0].get("filled_by")) != str(_member["id"]):
        raise HTTPException(status_code=403, detail="Access denied")

    # Fetch line items ordered by index
    line_items_resp = (
        db.table("claim_line_items")
        .select("*")
        .eq("claim_id", claim_id)
        .order("line_item_index")
        .execute()
    )
    line_items = line_items_resp.data

    # Fetch all receipts for the claim in one query
    receipts_resp = (
        db.table("receipts")
        .select("*")
        .eq("claim_id", claim_id)
        .order("created_at")
        .execute()
    )

    # Group receipts by line_item_id
    receipts_by_line_item: dict = {}
    for receipt in receipts_resp.data:
        li_id = receipt.get("line_item_id")
        if li_id not in receipts_by_line_item:
            receipts_by_line_item[li_id] = []
        receipts_by_line_item[li_id].append(receipt)

    # Nest receipts into each line item
    for li in line_items:
        li["receipts"] = receipts_by_line_item.get(li["id"], [])

    return line_items


# ---------------------------------------------------------------------------
# POST /claims
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_claim(
    payload: ClaimCreate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Read academic year from DB
    ay_resp = db.table("app_settings").select("value").eq("key", "academic_year").single().execute()
    if not ay_resp.data:
        raise HTTPException(status_code=500, detail="Academic year not configured — update it in Settings")
    academic_year = ay_resp.data["value"]

    # --- Atomically increment document counter (INSERT ... ON CONFLICT DO UPDATE) ---
    counter_resp = db.rpc("increment_document_counter", {"p_year": academic_year}).execute()
    if counter_resp.data is None:
        raise HTTPException(status_code=500, detail="Failed to increment document counter")
    counter = counter_resp.data

    # --- Validate claimer ---
    effective_claimer_id: Optional[UUID] = None
    if _member.get("role") == "treasurer":
        if payload.wbs_account == WBSAccount.MBH:
            raise HTTPException(400, "Treasurers cannot select MBH as WBS account")
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", _member["id"])
            .execute()
        )
        allowed_cca_ids = {row["cca_id"] for row in (cca_links.data or [])}
        if str(payload.cca_id) not in allowed_cca_ids:
            raise HTTPException(403, "You can only create claims for your own CCAs")
        effective_claimer_id = UUID(_member["id"])
    else:
        if payload.claimer_id is not None and payload.one_off_name:
            raise HTTPException(422, "Provide either claimer_id or one_off_name, not both")
        if payload.claimer_id is None and not payload.one_off_name:
            raise HTTPException(422, "Provide either claimer_id or one_off_name")
        if payload.claimer_id is not None:
            ft_check = (
                db.table("finance_team")
                .select("id, role")
                .eq("id", str(payload.claimer_id))
                .eq("role", "treasurer")
                .single()
                .execute()
            )
            if not ft_check.data:
                raise HTTPException(404, "Claimer not found — must be a registered treasurer")
        effective_claimer_id = payload.claimer_id  # may be None if one-off

    # --- Fetch CCA → portfolio for reference code ---
    cca_resp = (
        db.table("ccas")
        .select("name, portfolio:portfolios(name)")
        .eq("id", str(payload.cca_id))
        .single()
        .execute()
    )
    if not cca_resp.data:
        raise HTTPException(404, "CCA not found")
    cca_name = cca_resp.data["name"]
    portfolio_name = (cca_resp.data.get("portfolio") or {}).get("name", "UNKNOWN")

    reference_code = (
        f"{academic_year}"
        f"-{_slug(portfolio_name)}"
        f"-{_slug(cca_name)}"
        f"-{counter:04d}"
    )

    # --- Insert claim ---
    claim_data = {
        "reference_code": reference_code,
        "claim_number": counter,
        "cca_id": str(payload.cca_id),
        "claim_description": payload.claim_description,
        "total_amount": str(payload.total_amount),
        "date": payload.date.isoformat(),
        "wbs_account": payload.wbs_account.value,
        "transport_form_needed": payload.transport_form_needed,
        "is_partial": payload.is_partial,
        "status": ClaimStatus.DRAFT.value,
    }
    if effective_claimer_id is not None:
        claim_data["claimer_id"] = str(effective_claimer_id)
    if _member.get("role") != "treasurer":
        if payload.one_off_name:
            claim_data["one_off_name"] = payload.one_off_name
        if payload.one_off_matric_no:
            claim_data["one_off_matric_no"] = payload.one_off_matric_no
        if payload.one_off_phone:
            claim_data["one_off_phone"] = payload.one_off_phone
        if payload.one_off_email:
            claim_data["one_off_email"] = payload.one_off_email
    if _member.get("role") == "treasurer":
        claim_data["filled_by"] = str(_member["id"])
    elif payload.filled_by is not None:
        claim_data["filled_by"] = str(payload.filled_by)
    if payload.wbs_no is not None:
        claim_data["wbs_no"] = payload.wbs_no
    if payload.remarks is not None:
        claim_data["remarks"] = payload.remarks
    if payload.treasurer_notes is not None and _member.get("role") != "treasurer":
        raise HTTPException(status_code=403, detail="Only the CCA treasurer can add treasurer notes")
    if payload.treasurer_notes is not None:
        claim_data["treasurer_notes"] = payload.treasurer_notes.strip()
    create_resp = db.table("claims").insert(claim_data).execute()
    if not create_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create claim")

    created_claim = create_resp.data[0]
    log_claim_event(
        db,
        created_claim["id"],
        _member.get("id"),
        "claim_created",
        "Claim created",
        {"reference_code": created_claim.get("reference_code")},
    )
    return created_claim


# ---------------------------------------------------------------------------
# PATCH /claims/bulk
# ---------------------------------------------------------------------------

@router.patch("/bulk", response_model=BulkStatusResponse)
async def bulk_update_status(
    payload: BulkStatusUpdate,
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    if not payload.claim_ids:
        raise HTTPException(status_code=422, detail="claim_ids must not be empty")
    if payload.status == ClaimStatus.SUBMITTED:
        query = db.table("claims").update({"status": "submitted"}).in_("id", payload.claim_ids).eq("status", "compiled")
    elif payload.status == ClaimStatus.REIMBURSED:
        query = db.table("claims").update({"status": "reimbursed"}).in_("id", payload.claim_ids).eq("status", "submitted")
    else:
        raise HTTPException(status_code=400, detail="Bulk status update only supports submitted or reimbursed")

    resp = query.execute()
    updated = len(resp.data) if resp.data else 0
    event_type = "marked_submitted" if payload.status == ClaimStatus.SUBMITTED else "marked_reimbursed"
    message = "Marked as submitted" if payload.status == ClaimStatus.SUBMITTED else "Marked as reimbursed"
    for claim in resp.data or []:
        log_claim_event(db, claim["id"], _member.get("id"), event_type, message, {"bulk": True})
    return {"updated": updated, "skipped": len(payload.claim_ids) - updated}


# ---------------------------------------------------------------------------
# POST /claims/reimbursements/preview
# ---------------------------------------------------------------------------

@router.post("/reimbursements/preview")
async def preview_reimbursements(
    payload: ReimbursementClaimsRequest,
    _member: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    claim_ids = _normalise_claim_ids(payload.claim_ids)
    if not claim_ids:
        raise HTTPException(status_code=422, detail="claim_ids must not be empty")
    return _build_reimbursement_preview(db, claim_ids)


# ---------------------------------------------------------------------------
# POST /claims/reimbursements/complete
# ---------------------------------------------------------------------------

@router.post("/reimbursements/complete")
async def complete_reimbursements(
    payload: ReimbursementClaimsRequest,
    member: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    guard(f"reimbursements:{member.get('id')}", max_calls=3, window_seconds=60)
    claim_ids = _normalise_claim_ids(payload.claim_ids)
    if not claim_ids:
        raise HTTPException(status_code=422, detail="claim_ids must not be empty")

    preview = _build_reimbursement_preview(db, claim_ids)
    payable_ids = [
        claim["id"]
        for group in preview["groups"]
        for claim in group["claims"]
    ]
    if not payable_ids:
        return {
            "updated": 0,
            "skipped": len(claim_ids),
            "messages_sent": 0,
            "messages_skipped": 0,
            "groups": [],
            "skipped_claims": preview["skipped"],
        }

    resp = (
        db.table("claims")
        .update({"status": ClaimStatus.REIMBURSED.value})
        .in_("id", payable_ids)
        .eq("status", ClaimStatus.SUBMITTED.value)
        .execute()
    )
    updated_ids = {claim["id"] for claim in (resp.data or [])}
    skipped_claims = list(preview["skipped"])
    for claim_id in payable_ids:
        if claim_id not in updated_ids:
            skipped_claims.append({
                "id": claim_id,
                "reason": "Claim was no longer submitted when completing reimbursement",
            })

    completed_groups = []
    messages_sent = 0
    messages_skipped = 0

    for group in preview["groups"]:
        updated_claims = [claim for claim in group["claims"] if claim["id"] in updated_ids]
        if not updated_claims:
            continue

        completed_group = {
            **group,
            "claims": updated_claims,
            "claim_count": len(updated_claims),
            "total_amount": _money(sum(claim["amount"] for claim in updated_claims)),
        }
        completed_groups.append(completed_group)

        for claim in updated_claims:
            log_claim_event(
                db,
                claim["id"],
                member.get("id"),
                "reimbursement_batch_completed",
                "Reimbursed through payout workflow",
                {
                    "payee": completed_group["name"],
                    "payee_total_amount": completed_group["total_amount"],
                    "batch_claim_count": completed_group["claim_count"],
                },
            )

        telegram_id = completed_group.get("telegram_id")
        if telegram_id:
            sent = await send_bot_notification(telegram_id, _reimbursement_message(completed_group))
            if sent:
                messages_sent += 1
            else:
                messages_skipped += 1
        else:
            messages_skipped += 1

    return {
        "updated": len(updated_ids),
        "skipped": len(skipped_claims),
        "messages_sent": messages_sent,
        "messages_skipped": messages_skipped,
        "groups": completed_groups,
        "skipped_claims": skipped_claims,
    }


# ---------------------------------------------------------------------------
# PATCH /claims/{claim_id}
# ---------------------------------------------------------------------------

@router.patch("/{claim_id}")
async def update_claim(
    claim_id: str,
    payload: ClaimUpdate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Build update dict from only provided fields, excluding immutable/meta fields
    # wbs_no is GENERATED ALWAYS (computed from wbs_account) and cannot be set directly
    immutable = {"reference_code", "claim_number", "created_at", "client_updated_at", "wbs_no"}
    update_data = {}
    for field, value in payload.model_dump(exclude_none=True).items():
        if field in immutable:
            continue
        if hasattr(value, "value"):
            # Enum → string
            update_data[field] = value.value
        elif hasattr(value, "isoformat"):
            update_data[field] = value.isoformat()
        else:
            update_data[field] = value

    if not update_data:
        raise HTTPException(status_code=422, detail="No updatable fields provided")

    claim = get_claim_for_member(
        db,
        claim_id,
        _member,
        require_treasurer_draft=_claim_update_requires_treasurer_draft(update_data),
    )
    if _member.get("role") == "treasurer" and "status" in update_data:
        raise HTTPException(status_code=403, detail="Treasurers cannot change claim status directly")
    if _member.get("role") != "treasurer" and "treasurer_notes" in update_data:
        raise HTTPException(status_code=403, detail="Only the CCA treasurer can update treasurer notes")

    # Convert Decimal to string for JSON serialisation
    for k, v in update_data.items():
        from decimal import Decimal
        if isinstance(v, Decimal):
            update_data[k] = str(v)
        if isinstance(v, list):
            update_data[k] = v

    # Detect whether stale-doc fields are being changed
    stale_trigger = STALE_TRIGGER_FIELDS.intersection(update_data.keys())

    stale_document_types = []
    stale_ids = []
    if stale_trigger:
        # Find current documents for this claim
        docs_resp = (
            db.table("claim_documents")
            .select("id, type")
            .eq("claim_id", claim_id)
            .eq("is_current", True)
            .execute()
        )
        if docs_resp.data:
            # email_screenshot is an uploaded artifact — never mark it stale
            PRESERVE_TYPES = {"email_screenshot"}
            stale_docs = [d for d in docs_resp.data if d["type"] not in PRESERVE_TYPES]
            stale_document_types = [d["type"] for d in stale_docs]
            stale_ids = [d["id"] for d in stale_docs]

    # Perform the update — with optional optimistic concurrency check
    client_ts = payload.client_updated_at
    query = db.table("claims").update(update_data).eq("id", claim_id)
    if client_ts:
        query = query.eq("updated_at", client_ts)
    update_resp = query.execute()

    if not update_resp.data:
        if client_ts:
            raise HTTPException(
                status_code=409,
                detail="This claim was modified by someone else. Please refresh and try again.",
            )
        raise HTTPException(status_code=500, detail="Failed to update claim")

    if stale_ids:
        db.table("claim_documents").update({"is_current": False}).in_("id", stale_ids).execute()

    updated_fields = sorted(update_data.keys())
    internal_notes_only = updated_fields == ["internal_notes"]
    treasurer_notes_only = updated_fields == ["treasurer_notes"]
    event_type = (
        "internal_notes_updated"
        if internal_notes_only
        else "treasurer_notes_updated"
        if treasurer_notes_only
        else "claim_updated"
    )
    event_message = (
        "Internal notes cleared"
        if internal_notes_only and not update_data.get("internal_notes")
        else "Internal notes updated"
        if internal_notes_only
        else "Treasurer notes cleared"
        if treasurer_notes_only and not update_data.get("treasurer_notes")
        else "Treasurer notes updated"
        if treasurer_notes_only
        else "Claim details updated"
    )
    log_claim_event(
        db,
        claim_id,
        _member.get("id"),
        event_type,
        event_message,
        {"fields": updated_fields, "stale_documents": stale_document_types},
    )

    return {
        "claim": update_resp.data[0],
        "stale_documents": stale_document_types,
    }


# ---------------------------------------------------------------------------
# DELETE /claims/{claim_id}
# ---------------------------------------------------------------------------

@router.delete("/{claim_id}")
async def delete_claim(
    claim_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Permanently delete a claim and all associated R2/Drive files."""
    resp = (
        db.table("claims")
        .select("id, status, filled_by, mf_approval_drive_id, mf_approval_drive_ids")
        .eq("id", claim_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = resp.data[0]
    if _member.get("role") == "treasurer" and str(claim.get("filled_by")) != str(_member["id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    if _member.get("role") == "treasurer" and claim.get("status") != "draft":
        raise HTTPException(status_code=403, detail="This claim can no longer be deleted")

    # Collect every file reference before the DB cascade removes child rows.
    r2_paths: set[str] = set()
    drive_file_ids: set[str] = set()

    _add_file_ref(r2_paths, drive_file_ids, claim.get("mf_approval_drive_id"))
    _add_file_refs(r2_paths, drive_file_ids, claim.get("mf_approval_drive_ids"))

    receipts_resp = (
        db.table("receipts")
        .select(
            "id, receipt_image_drive_id, bank_screenshot_drive_id, "
            "exchange_rate_screenshot_drive_id, exchange_rate_screenshot_drive_ids"
        )
        .eq("claim_id", claim_id)
        .execute()
    )
    receipt_ids = [r["id"] for r in (receipts_resp.data or [])]
    for receipt in receipts_resp.data or []:
        _add_file_ref(r2_paths, drive_file_ids, receipt.get("receipt_image_drive_id"))
        _add_file_ref(r2_paths, drive_file_ids, receipt.get("bank_screenshot_drive_id"))
        _add_file_ref(r2_paths, drive_file_ids, receipt.get("exchange_rate_screenshot_drive_id"))
        _add_file_refs(r2_paths, drive_file_ids, receipt.get("exchange_rate_screenshot_drive_ids"))

    if receipt_ids:
        ri_resp = db.table("receipt_images").select("drive_file_id").in_("receipt_id", receipt_ids).execute()
        for row in ri_resp.data or []:
            _add_file_ref(r2_paths, drive_file_ids, row.get("drive_file_id"))

    bt_resp = db.table("bank_transactions").select("id").eq("claim_id", claim_id).execute()
    bt_ids = [b["id"] for b in (bt_resp.data or [])]
    if bt_ids:
        bti_resp = db.table("bank_transaction_images").select("drive_file_id").in_("bank_transaction_id", bt_ids).execute()
        for row in bti_resp.data or []:
            _add_file_ref(r2_paths, drive_file_ids, row.get("drive_file_id"))
        btr_resp = (
            db.table("bank_transaction_refunds")
            .select("drive_file_id, extra_drive_file_ids")
            .in_("bank_transaction_id", bt_ids)
            .execute()
        )
        for row in btr_resp.data or []:
            _add_file_ref(r2_paths, drive_file_ids, row.get("drive_file_id"))
            _add_file_refs(r2_paths, drive_file_ids, row.get("extra_drive_file_ids"))

    docs_resp = db.table("claim_documents").select("drive_file_id").eq("claim_id", claim_id).execute()
    for doc in docs_resp.data or []:
        _add_file_ref(r2_paths, drive_file_ids, doc.get("drive_file_id"))

    request_resp = db.table("claim_attachment_requests").select("id").eq("claim_id", claim_id).execute()
    request_ids = [r["id"] for r in (request_resp.data or [])]
    if request_ids:
        attachment_resp = db.table("claim_attachment_files").select("file_url").in_("request_id", request_ids).execute()
        for row in attachment_resp.data or []:
            _add_file_ref(r2_paths, drive_file_ids, row.get("file_url"))

    # Delete uploaded files best-effort; DB cleanup should still proceed if storage cleanup has a transient failure.
    for path in r2_paths:
        r2_service.delete_file(path)

    if drive_file_ids:
        from app.services import pdf as pdf_service
        for file_id in drive_file_ids:
            try:
                pdf_service.delete_drive_file(file_id)
            except Exception as exc:
                logger.warning("Drive delete failed for claim %s file %s: %s", claim_id, file_id, exc)

    # Hard delete the claim (cascades to all child rows via DB FK constraints)
    db.table("claims").delete().eq("id", claim_id).execute()

    return {"deleted": True}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/submit-review  (treasurer only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/submit-review")
async def submit_for_review(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer moves their DRAFT claim to PENDING_REVIEW."""
    guard(f"submit-review:{claim_id}", max_calls=2, window_seconds=15)
    if member.get("role") != "treasurer":
        raise HTTPException(403, "Only treasurers can submit for review")
    claim = get_claim_for_member(db, claim_id, member)
    if str(claim.get("filled_by")) != str(member["id"]):
        raise HTTPException(403, "You can only submit your own claims")
    # Atomic: only update if still in draft — catches concurrent double-submit
    resp = db.table("claims").update({
        "status": ClaimStatus.PENDING_REVIEW.value,
    }).eq("id", claim_id).eq("status", ClaimStatus.DRAFT.value).execute()
    if not resp.data:
        raise HTTPException(409, "Claim is no longer in draft status")
    log_claim_event(db, claim_id, member.get("id"), "submitted_for_review", "Submitted for finance review")
    return {"success": True, "status": ClaimStatus.PENDING_REVIEW.value}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/reject-review  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/reject-review")
async def reject_review(
    claim_id: str,
    payload: RejectReviewRequest,
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Finance team rejects a PENDING_REVIEW claim back to DRAFT with a comment."""
    # Atomic: only update if still in pending_review
    resp = db.table("claims").update({
        "status": ClaimStatus.DRAFT.value,
        "rejection_comment": payload.comment,
    }).eq("id", claim_id).eq("status", ClaimStatus.PENDING_REVIEW.value).execute()
    if not resp.data:
        raise HTTPException(409, "Claim is no longer in pending_review status")
    # Notify the treasurer who submitted the claim
    claim_row = resp.data[0]
    filled_by_id = claim_row.get("filled_by")
    if filled_by_id:
        ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
        if ft.data and ft.data[0].get("telegram_id"):
            ref = claim_row.get("reference_code", "your claim")
            asyncio.create_task(send_bot_notification(
                ft.data[0]["telegram_id"],
                f"❌ Claim {ref} was rejected.\n\nFeedback: {payload.comment}\n\nPlease update and resubmit via the Claims App."
            ))
    log_claim_event(
        db,
        claim_id,
        _member.get("id"),
        "review_rejected",
        "Finance review rejected",
        {"comment": payload.comment},
    )
    return {"success": True, "status": ClaimStatus.DRAFT.value}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/submit  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/submit")
async def mark_submitted(
    claim_id: str,
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Mark a compiled claim as submitted to school finance."""
    guard(f"submit:{claim_id}", max_calls=2, window_seconds=15)
    resp = db.table("claims").update({"status": "submitted"}).eq("id", claim_id).eq("status", "compiled").execute()
    if not resp.data:
        raise HTTPException(409, "Claim is not in compiled status")
    claim_row = resp.data[0]
    filled_by_id = claim_row.get("filled_by")
    if filled_by_id:
        ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
        if ft.data and ft.data[0].get("telegram_id"):
            ref = claim_row.get("reference_code", "your claim")
            asyncio.create_task(send_bot_notification(
                ft.data[0]["telegram_id"],
                f"📬 Claim {ref} has been submitted to the school finance office. We will notify you when it is reimbursed."
            ))
    log_claim_event(db, claim_id, _member.get("id"), "marked_submitted", "Marked as submitted")
    return {"success": True, "status": "submitted"}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/reimburse  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/reimburse")
async def mark_reimbursed(
    claim_id: str,
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Mark a submitted claim as reimbursed."""
    guard(f"reimburse:{claim_id}", max_calls=2, window_seconds=15)
    resp = db.table("claims").update({"status": "reimbursed"}).eq("id", claim_id).eq("status", "submitted").execute()
    if not resp.data:
        raise HTTPException(409, "Claim is not in submitted status")
    claim_row = resp.data[0]
    filled_by_id = claim_row.get("filled_by")
    if filled_by_id:
        ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
        if ft.data and ft.data[0].get("telegram_id"):
            ref = claim_row.get("reference_code", "your claim")
            asyncio.create_task(send_bot_notification(
                ft.data[0]["telegram_id"],
                f"✅ Claim {ref} has been reimbursed! Please verify that you have received your payment."
            ))
    log_claim_event(db, claim_id, _member.get("id"), "marked_reimbursed", "Marked as reimbursed")
    return {"success": True, "status": "reimbursed"}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/email-reminder  (director only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/email-reminder")
async def remind_treasurer_to_send_email(
    claim_id: str,
    member: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Send a Telegram reminder to the treasurer when the claim is waiting on the sent email."""
    guard(f"email-reminder:{claim_id}", max_calls=3, window_seconds=300)
    claim = get_claim_for_member(db, claim_id, member)
    if claim.get("status") not in EMAIL_REMINDER_STATUSES:
        raise HTTPException(409, "Claim is not waiting for the treasurer to send the confirmation email")

    filled_by_id = claim.get("filled_by")
    if not filled_by_id:
        raise HTTPException(400, "This claim has no assigned treasurer to remind")

    ft = (
        db.table("finance_team")
        .select("telegram_id, name")
        .eq("id", filled_by_id)
        .execute()
    )
    if not ft.data or not ft.data[0].get("telegram_id"):
        raise HTTPException(400, "Treasurer has no Telegram ID linked")

    sent = await send_bot_notification(ft.data[0]["telegram_id"], _email_send_reminder_message(claim))
    if not sent:
        raise HTTPException(502, "Telegram reminder failed to send")

    log_claim_event(
        db,
        claim_id,
        member.get("id"),
        "email_send_reminder_sent",
        "Treasurer reminded to send confirmation email",
        {"treasurer_id": filled_by_id},
    )
    return {"success": True, "sent_to": ft.data[0].get("name")}


# ---------------------------------------------------------------------------
# POST /claims/email-reminders  (director only)
# ---------------------------------------------------------------------------

@router.post("/email-reminders")
async def remind_all_treasurers_to_send_email(
    member: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Send one reminder per treasurer for claims waiting on sent-email screenshots."""
    guard("email-reminder:bulk", max_calls=2, window_seconds=300)
    claims_resp = (
        db.table("claims")
        .select("id, reference_code, claim_description, filled_by, status")
        .in_("status", sorted(EMAIL_REMINDER_STATUSES))
        .is_("deleted_at", "null")
        .limit(500)
        .execute()
    )
    waiting_claims = claims_resp.data or []
    if not waiting_claims:
        return {
            "success": True,
            "matched": 0,
            "sent_treasurers": 0,
            "sent_claims": 0,
            "skipped_claims": 0,
            "failed_treasurers": 0,
        }

    claims_by_treasurer: dict[str, list[dict]] = {}
    skipped_claims = 0
    for claim in waiting_claims:
        treasurer_id = claim.get("filled_by")
        if not treasurer_id:
            skipped_claims += 1
            continue
        claims_by_treasurer.setdefault(str(treasurer_id), []).append(claim)

    treasurer_ids = list(claims_by_treasurer.keys())
    treasurers_resp = (
        db.table("finance_team")
        .select("id, telegram_id, name")
        .in_("id", treasurer_ids)
        .execute()
        if treasurer_ids
        else None
    )
    treasurers = {
        str(row["id"]): row
        for row in ((treasurers_resp.data if treasurers_resp else None) or [])
    }

    sent_treasurers = 0
    sent_claims = 0
    failed_treasurers = 0
    for treasurer_id, claims_for_treasurer in claims_by_treasurer.items():
        treasurer = treasurers.get(treasurer_id)
        telegram_id = treasurer.get("telegram_id") if treasurer else None
        if not telegram_id:
            skipped_claims += len(claims_for_treasurer)
            continue

        sent = await send_bot_notification(
            telegram_id,
            _email_send_bulk_reminder_message(claims_for_treasurer),
        )
        if not sent:
            failed_treasurers += 1
            continue

        sent_treasurers += 1
        sent_claims += len(claims_for_treasurer)
        for claim in claims_for_treasurer:
            log_claim_event(
                db,
                claim["id"],
                member.get("id"),
                "email_send_reminder_sent",
                "Treasurer reminded to send confirmation email",
                {"treasurer_id": treasurer_id, "bulk": True},
            )

    return {
        "success": failed_treasurers == 0,
        "matched": len(waiting_claims),
        "sent_treasurers": sent_treasurers,
        "sent_claims": sent_claims,
        "skipped_claims": skipped_claims,
        "failed_treasurers": failed_treasurers,
    }


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/request-attachment  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/request-attachment")
async def request_attachment(
    claim_id: str,
    payload: AttachmentRequestBody,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Finance team flags a submitted claim to request additional attachments."""
    claim = get_claim_for_member(db, claim_id, member)
    if claim["status"] != "submitted":
        raise HTTPException(409, "Claim must be in submitted status to request attachments")

    req_resp = db.table("claim_attachment_requests").insert({
        "claim_id": claim_id,
        "director_id": member["id"],
        "request_message": payload.message,
    }).execute()
    if not req_resp.data:
        raise HTTPException(500, "Failed to create attachment request")

    db.table("claims").update({"status": "attachment_requested"}).eq("id", claim_id).execute()
    log_claim_event(
        db,
        claim_id,
        member.get("id"),
        "attachment_requested",
        "Additional attachment requested",
        {"message": payload.message},
    )

    # One-off claimers have no app access — skip Telegram notification
    is_one_off = claim.get("claimer_id") is None
    if not is_one_off:
        filled_by_id = claim.get("filled_by")
        if filled_by_id:
            ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
            if ft.data and ft.data[0].get("telegram_id"):
                ref = claim.get("reference_code", claim_id)
                asyncio.create_task(send_bot_notification(
                    ft.data[0]["telegram_id"],
                    f"📎 Additional attachment requested for claim {ref}\n\n{payload.message}\n\nPlease upload the required files in the app."
                ))

    return req_resp.data[0]


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-upload  (any authenticated user)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-upload")
async def upload_attachment_file(
    claim_id: str,
    file: UploadFile = File(...),
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer uploads a file against the current open attachment request."""
    claim = get_claim_for_member(db, claim_id, member)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Claim is not currently awaiting attachments")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    existing_files = (
        db.table("claim_attachment_files")
        .select("id", count="exact")
        .eq("request_id", current_req["id"])
        .execute()
        .count
        or 0
    )
    if existing_files >= settings.MAX_ATTACHMENT_FILES_PER_REQUEST:
        raise HTTPException(
            413,
            f"Maximum {settings.MAX_ATTACHMENT_FILES_PER_REQUEST} attachment files per request.",
        )

    file_bytes = await file.read()
    if len(file_bytes) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. Maximum upload size is {settings.MAX_UPLOAD_BYTES // 1_000_000} MB.",
        )
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    object_name = f"attachments/{claim_id}/{uuid_lib.uuid4()}.{ext}"
    r2_service.upload_file(file_bytes, object_name, file.content_type or "application/octet-stream")

    try:
        file_resp = insert_file_row(db, "claim_attachment_files", {
            "request_id": current_req["id"],
            "file_url": object_name,
            "original_filename": filename,
            "file_size_bytes": len(file_bytes),
        })
        if not file_resp.data:
            raise RuntimeError("No attachment file row returned")
    except Exception as exc:
        r2_service.delete_file(object_name)
        logger.exception("Failed to save attachment file row for claim %s: %s", claim_id, exc)
        raise HTTPException(500, "Failed to save file record")

    uploaded = file_resp.data[0]
    log_claim_event(
        db,
        claim_id,
        member.get("id"),
        "attachment_file_uploaded",
        "Attachment file uploaded",
        {"filename": filename},
    )
    return uploaded


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-submit  (any authenticated user)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-submit")
async def submit_attachments(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer marks their uploads as complete; notifies finance director."""
    claim = get_claim_for_member(db, claim_id, member)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Claim is not currently awaiting attachments")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    files_resp = (
        db.table("claim_attachment_files")
        .select("id")
        .eq("request_id", current_req["id"])
        .execute()
    )
    if not files_resp.data:
        raise HTTPException(422, "Upload at least one file before submitting")

    db.table("claim_attachment_requests").update({"status": "submitted"}).eq("id", current_req["id"]).execute()
    db.table("claims").update({"status": "attachment_uploaded"}).eq("id", claim_id).execute()
    log_claim_event(db, claim_id, member.get("id"), "attachments_submitted", "Attachments submitted for review")

    director_resp = db.table("finance_team").select("telegram_id").eq("role", "director").execute()
    if director_resp.data and director_resp.data[0].get("telegram_id"):
        ref = claim.get("reference_code", claim_id)
        asyncio.create_task(send_bot_notification(
            director_resp.data[0]["telegram_id"],
            f"📎 Attachments uploaded for claim {ref} — ready for your review."
        ))

    return {"success": True, "status": "attachment_uploaded"}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-accept  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-accept")
async def accept_attachments(
    claim_id: str,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Director accepts uploaded attachments; claim returns to submitted."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_uploaded":
        raise HTTPException(409, "Claim is not awaiting attachment review")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    db.table("claim_attachment_requests").update({"status": "accepted"}).eq("id", current_req["id"]).execute()
    db.table("claims").update({"status": "submitted"}).eq("id", claim_id).execute()
    log_claim_event(db, claim_id, member.get("id"), "attachments_accepted", "Additional attachments accepted")

    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-reject  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-reject")
async def reject_attachments(
    claim_id: str,
    payload: AttachmentRequestBody,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Director rejects uploads, creates a new request cycle, notifies treasurer."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_uploaded":
        raise HTTPException(409, "Claim is not awaiting attachment review")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    db.table("claim_attachment_requests").update({"status": "rejected"}).eq("id", current_req["id"]).execute()

    new_req_resp = db.table("claim_attachment_requests").insert({
        "claim_id": claim_id,
        "director_id": member["id"],
        "request_message": payload.message,
    }).execute()
    if not new_req_resp.data:
        raise HTTPException(500, "Failed to create new attachment request")

    db.table("claims").update({"status": "attachment_requested"}).eq("id", claim_id).execute()
    log_claim_event(
        db,
        claim_id,
        member.get("id"),
        "attachments_rejected",
        "Additional attachments need revision",
        {"message": payload.message},
    )

    # One-off claimers have no app access — skip Telegram notification
    is_one_off = claim.get("claimer_id") is None
    if not is_one_off:
        filled_by_id = claim.get("filled_by")
        if filled_by_id:
            ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
            if ft.data and ft.data[0].get("telegram_id"):
                ref = claim.get("reference_code", claim_id)
                asyncio.create_task(send_bot_notification(
                    ft.data[0]["telegram_id"],
                    f"📎 Attachments for claim {ref} need revision.\n\n{payload.message}\n\nPlease upload the corrected files in the app."
                ))

    return new_req_resp.data[0]


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/attachment-requests  (any authenticated user)
# ---------------------------------------------------------------------------

@router.get("/{claim_id}/attachment-requests")
def get_attachment_requests(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return all attachment request cycles for a claim, newest first, with files nested."""
    get_claim_for_member(db, claim_id, member)

    reqs_resp = (
        db.table("claim_attachment_requests")
        .select("*")
        .eq("claim_id", claim_id)
        .order("created_at", desc=True)
        .execute()
    )
    requests = reqs_resp.data or []

    if requests:
        req_ids = [r["id"] for r in requests]
        files_resp = (
            db.table("claim_attachment_files")
            .select("*")
            .in_("request_id", req_ids)
            .order("uploaded_at")
            .execute()
        )
        files_by_req: dict = {}
        for f in (files_resp.data or []):
            files_by_req.setdefault(f["request_id"], []).append(f)
        for r in requests:
            r["files"] = files_by_req.get(r["id"], [])

    return requests


# ---------------------------------------------------------------------------
# DELETE /claims/{claim_id}/attachment-requests/current/files/{file_id}
# ---------------------------------------------------------------------------

@router.delete("/{claim_id}/attachment-requests/current/files/{file_id}", status_code=204)
def delete_attachment_file(
    claim_id: str,
    file_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer removes a file from the current open request (before submitting)."""
    claim = get_claim_for_member(db, claim_id, member)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Cannot delete files after submitting")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    file_resp = (
        db.table("claim_attachment_files")
        .select("id, file_url")
        .eq("id", file_id)
        .eq("request_id", current_req["id"])
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(404, "File not found on current request")

    db.table("claim_attachment_files").delete().eq("id", file_id).execute()
    if file_resp.data[0].get("file_url"):
        r2_service.delete_file(file_resp.data[0]["file_url"])


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/attachment-requests/current/files/{file_id}/download
# ---------------------------------------------------------------------------

@router.get("/{claim_id}/attachment-requests/current/files/{file_id}/download")
def download_attachment_file(
    claim_id: str,
    file_id: str,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Return a short-lived presigned R2 URL so the director can download a file."""
    get_claim_for_member(db, claim_id, member)

    req_ids_resp = (
        db.table("claim_attachment_requests")
        .select("id")
        .eq("claim_id", claim_id)
        .execute()
    )
    req_ids = [r["id"] for r in (req_ids_resp.data or [])]

    file_resp = (
        db.table("claim_attachment_files")
        .select("id, file_url, original_filename")
        .eq("id", file_id)
        .in_("request_id", req_ids)
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(404, "File not found")

    url = r2_service.generate_signed_url(file_resp.data[0]["file_url"])
    return {"url": url, "filename": file_resp.data[0]["original_filename"]}
