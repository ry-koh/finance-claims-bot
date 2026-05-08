import asyncio
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel as PydanticBaseModel
from supabase import Client

from app.auth import require_auth, require_director, require_finance_team
from app.config import settings
from app.database import get_supabase
from app.models import ClaimCreate, ClaimStatus, ClaimUpdate, WBSAccount
from app.routers.bot import send_bot_notification
from app.services import r2 as r2_service


class BulkStatusUpdate(PydanticBaseModel):
    claim_ids: list[str]
    status: ClaimStatus


class RejectReviewRequest(PydanticBaseModel):
    comment: str


class AttachmentRequestBody(PydanticBaseModel):
    message: str

router = APIRouter(prefix="/claims", tags=["claims"])

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
    "partial_amount",
}


def _slug(text: str) -> str:
    """Upper-case and replace spaces with hyphens."""
    return text.upper().replace(" ", "-")


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


# ---------------------------------------------------------------------------
# GET /claims
# ---------------------------------------------------------------------------

@router.get("")
async def list_claims(
    status: Optional[str] = Query(default=None),
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

    if status:
        query = query.eq("status", status)

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

    return {
        "items": resp.data,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------------------------------
# GET /claims/counts  — must be before /{claim_id} to avoid path conflict
# ---------------------------------------------------------------------------

@router.get("/counts")
async def get_claim_counts(
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = (
        db.table("claims")
        .select("status")
        .is_("deleted_at", "null")
        .execute()
    )
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

    return claim


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/line-items — Get all line items with nested receipts
# ---------------------------------------------------------------------------

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
        "other_emails": payload.other_emails,
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
    if payload.is_partial and payload.partial_amount is not None:
        claim_data["partial_amount"] = str(payload.partial_amount)

    create_resp = db.table("claims").insert(claim_data).execute()
    if not create_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create claim")

    return create_resp.data[0]


# ---------------------------------------------------------------------------
# PATCH /claims/bulk
# ---------------------------------------------------------------------------

@router.patch("/bulk")
async def bulk_update_status(
    payload: BulkStatusUpdate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    if not payload.claim_ids:
        raise HTTPException(status_code=422, detail="claim_ids must not be empty")
    resp = db.table("claims").update({"status": payload.status.value}).in_("id", payload.claim_ids).execute()
    return {"updated": len(resp.data) if resp.data else 0}


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
    claim = _get_claim_or_404(db, claim_id)

    if _member.get("role") == "treasurer" and str(claim.get("filled_by")) != str(_member["id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    if _member.get("role") == "treasurer" and claim.get("status") != "draft":
        raise HTTPException(status_code=403, detail="This claim can no longer be edited")

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
            if stale_ids:
                db.table("claim_documents").update({"is_current": False}).in_("id", stale_ids).execute()

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
    """Permanently delete a claim and all associated R2 files."""
    resp = db.table("claims").select("id, status, filled_by").eq("id", claim_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = resp.data[0]
    if _member.get("role") == "treasurer" and str(claim.get("filled_by")) != str(_member["id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    if _member.get("role") == "treasurer" and claim.get("status") != "draft":
        raise HTTPException(status_code=403, detail="This claim can no longer be deleted")

    # Collect all R2 object names across image and document tables
    r2_paths = []

    ri = db.table("receipt_images").select("drive_file_id").eq(
        "receipt_id",
        db.table("receipts").select("id").eq("claim_id", claim_id)
    )
    # Gather via joined queries
    receipts_resp = db.table("receipts").select("id").eq("claim_id", claim_id).execute()
    receipt_ids = [r["id"] for r in (receipts_resp.data or [])]
    if receipt_ids:
        ri_resp = db.table("receipt_images").select("drive_file_id").in_("receipt_id", receipt_ids).execute()
        r2_paths += [r["drive_file_id"] for r in (ri_resp.data or []) if r.get("drive_file_id")]

    bt_resp = db.table("bank_transactions").select("id").eq("claim_id", claim_id).execute()
    bt_ids = [b["id"] for b in (bt_resp.data or [])]
    if bt_ids:
        bti_resp = db.table("bank_transaction_images").select("drive_file_id").in_("bank_transaction_id", bt_ids).execute()
        r2_paths += [r["drive_file_id"] for r in (bti_resp.data or []) if r.get("drive_file_id")]
        btr_resp = db.table("bank_transaction_refunds").select("drive_file_id").in_("bank_transaction_id", bt_ids).execute()
        r2_paths += [r["drive_file_id"] for r in (btr_resp.data or []) if r.get("drive_file_id")]

    docs_resp = db.table("claim_documents").select("drive_file_id").eq("claim_id", claim_id).execute()
    r2_paths += [d["drive_file_id"] for d in (docs_resp.data or []) if d.get("drive_file_id")]

    # Delete R2 files (best-effort)
    for path in r2_paths:
        r2_service.delete_file(path)

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
    if member.get("role") != "treasurer":
        raise HTTPException(403, "Only treasurers can submit for review")
    claim = _get_claim_or_404(db, claim_id)
    if str(claim.get("filled_by")) != str(member["id"]):
        raise HTTPException(403, "You can only submit your own claims")
    # Atomic: only update if still in draft — catches concurrent double-submit
    resp = db.table("claims").update({
        "status": ClaimStatus.PENDING_REVIEW.value,
    }).eq("id", claim_id).eq("status", ClaimStatus.DRAFT.value).execute()
    if not resp.data:
        raise HTTPException(409, "Claim is no longer in draft status")
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
    return {"success": True, "status": "reimbursed"}


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
    claim = _get_claim_or_404(db, claim_id)
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
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Claim is not currently awaiting attachments")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    file_bytes = await file.read()
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    object_name = f"attachments/{claim_id}/{uuid_lib.uuid4()}.{ext}"
    r2_service.upload_file(file_bytes, object_name, file.content_type or "application/octet-stream")

    file_resp = db.table("claim_attachment_files").insert({
        "request_id": current_req["id"],
        "file_url": object_name,
        "original_filename": filename,
    }).execute()
    if not file_resp.data:
        r2_service.delete_file(object_name)
        raise HTTPException(500, "Failed to save file record")

    return file_resp.data[0]


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
    claim = _get_claim_or_404(db, claim_id)
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
    _get_claim_or_404(db, claim_id)

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
    claim = _get_claim_or_404(db, claim_id)
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
    _get_claim_or_404(db, claim_id)

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
