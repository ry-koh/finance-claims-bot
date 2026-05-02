from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from app.auth import require_auth, require_director
from app.config import settings
from app.database import get_supabase
from app.models import ClaimCreate, ClaimStatus, ClaimUpdate, WBSAccount
from app.services import r2 as r2_service

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


# ---------------------------------------------------------------------------
# GET /claims
# ---------------------------------------------------------------------------

@router.get("")
async def list_claims(
    status: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    query = (
        db.table("claims")
        .select("*, claimer:claimers(id, name)", count="exact")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )

    if status:
        query = query.eq("status", status)

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
        .select("*, claimer:claimers(*, cca:ccas(*, portfolio:portfolios(*)))")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_resp.data[0]

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
    # Verify claim exists
    resp = (
        db.table("claims")
        .select("id")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")

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
    academic_year = settings.ACADEMIC_YEAR

    # --- Atomically increment document counter ---
    # Try to update existing row and get new counter
    counter_resp = (
        db.table("document_counters")
        .select("id, counter")
        .eq("academic_year", academic_year)
        .execute()
    )

    if not counter_resp.data:
        # No row yet — insert with counter=1
        insert_resp = (
            db.table("document_counters")
            .insert({"academic_year": academic_year, "counter": 1})
            .execute()
        )
        if not insert_resp.data:
            raise HTTPException(status_code=500, detail="Failed to initialise document counter")
        counter = 1
    else:
        row = counter_resp.data[0]
        new_counter = row["counter"] + 1
        update_resp = (
            db.table("document_counters")
            .update({"counter": new_counter})
            .eq("id", row["id"])
            .execute()
        )
        if not update_resp.data:
            raise HTTPException(status_code=500, detail="Failed to increment document counter")
        counter = new_counter

    # --- Fetch claimer → CCA → portfolio ---
    claimer_resp = (
        db.table("claimers")
        .select("*, cca:ccas(name, portfolio:portfolios(name))")
        .eq("id", str(payload.claimer_id))
        .execute()
    )
    if not claimer_resp.data:
        raise HTTPException(status_code=404, detail="Claimer not found")
    claimer = claimer_resp.data[0]

    cca_name = claimer.get("cca", {}).get("name", "UNKNOWN")
    portfolio_name = claimer.get("cca", {}).get("portfolio", {}).get("name", "UNKNOWN")

    reference_code = (
        f"{academic_year}"
        f"-{_slug(portfolio_name)}"
        f"-{_slug(cca_name)}"
        f"-{counter:03d}"
    )

    # --- Insert claim ---
    claim_data = {
        "reference_code": reference_code,
        "claim_number": counter,
        "claimer_id": str(payload.claimer_id),
        "claim_description": payload.claim_description,
        "total_amount": str(payload.total_amount),
        "date": payload.date.isoformat(),
        "wbs_account": payload.wbs_account.value,
        "transport_form_needed": payload.transport_form_needed,
        "status": ClaimStatus.DRAFT.value,
        "other_emails": payload.other_emails,
    }
    if payload.filled_by is not None:
        claim_data["filled_by"] = str(payload.filled_by)
    if payload.wbs_no is not None:
        claim_data["wbs_no"] = payload.wbs_no
    if payload.remarks is not None:
        claim_data["remarks"] = payload.remarks

    create_resp = db.table("claims").insert(claim_data).execute()
    if not create_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create claim")

    return create_resp.data[0]


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
    _get_claim_or_404(db, claim_id)

    # Build update dict from only provided fields, excluding immutable fields
    immutable = {"reference_code", "claim_number", "created_at"}
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
            stale_document_types = [d["type"] for d in docs_resp.data]
            stale_ids = [d["id"] for d in docs_resp.data]
            # Mark them as stale
            db.table("claim_documents").update({"is_current": False}).in_("id", stale_ids).execute()

    # Perform the update
    update_resp = (
        db.table("claims")
        .update(update_data)
        .eq("id", claim_id)
        .execute()
    )
    if not update_resp.data:
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
    resp = db.table("claims").select("id").eq("id", claim_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")

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
