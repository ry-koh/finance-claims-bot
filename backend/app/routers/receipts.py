import base64
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from supabase import Client

from pydantic import BaseModel

from app.auth import get_claim_for_member, require_auth
from app.config import settings
from app.database import get_supabase
from app.models import ReceiptCreate, ReceiptUpdate
from app.services import r2, image
from app.services.storage import insert_file_row

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/receipts", tags=["receipts"])

# ---------------------------------------------------------------------------
# Category → category_code mapping
# ---------------------------------------------------------------------------

CATEGORY_CODES = {
    "Office Supplies": "7100101",
    "Consumables": "7100103",
    "Sports & Cultural Materials": "7100104",
    "Other fees (Others)": "7200108",
    "Professional fees": "7200201",
    "Bank Charges": "7200213",
    "Licensing/Subscription": "7200402",
    "Postage & Telecommunication Charges": "7200412",
    "Maintenance (Equipment)": "7400112",
    "Lease expense (premises)": "7400301",
    "Lease expense (rental of equipment)": "7400301",
    "Furniture": "7400401",
    "Equipment Purchase": "7400401",
    "Publications": "7500104",
    "Meals & Refreshments": "7500106",
    "Local Travel": "7600105",
    "Student awards/prizes": "7650119",
    "Donation/Sponsorship": "7700101",
    "Miscellaneous Expense": "7700701",
    "Other Services": "7700715",
    "Fund Transfer": "7800201",
    "N/A": "",
}

MAX_CATEGORIES = 5


# ---------------------------------------------------------------------------
# Request body models local to this router
# ---------------------------------------------------------------------------

class LineItemUpdate(BaseModel):
    combined_description: Optional[str] = None
    gst_code: Optional[str] = None
    dr_cr: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _get_receipt_or_404(db: Client, receipt_id: str) -> dict:
    resp = (
        db.table("receipts")
        .select("*")
        .eq("id", receipt_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return resp.data[0]


def _get_line_item_for_category(db: Client, claim_id: str, category: str) -> Optional[dict]:
    """Return the existing line item for this category on this claim, or None."""
    resp = (
        db.table("claim_line_items")
        .select("*")
        .eq("claim_id", claim_id)
        .eq("category", category)
        .execute()
    )
    return resp.data[0] if resp.data else None


def _count_line_items(db: Client, claim_id: str) -> int:
    resp = (
        db.table("claim_line_items")
        .select("id", count="exact")
        .eq("claim_id", claim_id)
        .execute()
    )
    return resp.count if resp.count is not None else len(resp.data)


def _create_line_item(db: Client, claim_id: str, category: str, gst_code: str, dr_cr: str, index: int) -> dict:
    """Insert and return a new line item row."""
    data = {
        "claim_id": claim_id,
        "line_item_index": index,
        "category": category,
        "category_code": CATEGORY_CODES.get(category, ""),
        "gst_code": gst_code,
        "dr_cr": dr_cr,
        "total_amount": 0,
    }
    resp = db.table("claim_line_items").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create line item")
    return resp.data[0]


def _delete_line_item_if_empty(db: Client, line_item_id: str) -> None:
    """Delete the line item if no receipts reference it."""
    count_resp = (
        db.table("receipts")
        .select("id", count="exact")
        .eq("line_item_id", line_item_id)
        .execute()
    )
    count = count_resp.count if count_resp.count is not None else len(count_resp.data)
    if count == 0:
        db.table("claim_line_items").delete().eq("id", line_item_id).execute()


def _assert_claim_editable(db: Client, claim_id: str, member: dict) -> None:
    """Raise 403 if a treasurer is trying to mutate a claim that is no longer in draft."""
    get_claim_for_member(db, claim_id, member, require_treasurer_draft=True)


# ---------------------------------------------------------------------------
# POST /receipts/process-image
# ---------------------------------------------------------------------------

@router.post("/process-image")
async def process_image(
    file: UploadFile = File(...),
    auth: dict = Depends(require_auth),
):
    """
    Accept a receipt image (JPEG, PNG, HEIC, WEBP, or single-page PDF),
    process it through the image pipeline (validate → convert → normalise to A4),
    and return the result as a base64-encoded JPEG.
    """
    file_bytes = await file.read()
    content_type = file.content_type or ""
    filename = file.filename or ""

    try:
        result = image.process_receipt_image(file_bytes, content_type, filename)
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})

    return {
        "processed_image": base64.b64encode(result).decode(),
        "content_type": "image/jpeg",
    }


# ---------------------------------------------------------------------------
# POST /receipts/process-pdf-pages
# ---------------------------------------------------------------------------

@router.post("/process-pdf-pages")
async def process_pdf_pages(
    file: UploadFile = File(...),
    auth: dict = Depends(require_auth),
):
    """
    Convert a multi-page PDF to an array of base64-encoded JPEG images,
    one per page, each normalised to A4.
    """
    file_bytes = await file.read()
    try:
        pages = image.process_pdf_pages(file_bytes)
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})

    return {
        "pages": [
            {"data": base64.b64encode(p).decode(), "content_type": "image/jpeg"}
            for p in pages
        ],
        "page_count": len(pages),
    }


# ---------------------------------------------------------------------------
# POST /receipts/upload-image
# ---------------------------------------------------------------------------

@router.post("/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    claim_id: str = Form(...),
    image_type: str = Form(...),  # "receipt" or "bank"
    auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """
    Upload a processed receipt or bank screenshot image to Google Drive.

    Creates (or reuses) a per-claim folder, then a 'receipts' sub-folder,
    and saves the file there.  Returns the Drive file ID and filename.
    """
    # Fetch the claim to get its reference_code
    claim_resp = (
        db.table("claims")
        .select("id, reference_code")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not claim_resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    get_claim_for_member(db, claim_id, auth, require_treasurer_draft=True)

    reference_code = claim_resp.data[0].get("reference_code")
    if not reference_code:
        raise HTTPException(status_code=422, detail="Claim has no reference code yet")

    # Validate file type
    try:
        image.validate_mime_type(file.content_type or "", file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Upload to R2
    try:
        file_bytes = await file.read()
        if len(file_bytes) > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File is too large. Maximum upload size is {settings.MAX_UPLOAD_BYTES // 1_000_000} MB.",
            )
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        object_name = r2.make_object_name(reference_code, image_type, timestamp)
        r2.upload_file(file_bytes, object_name)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("R2 upload failed for claim %s: %s", claim_id, exc)
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {str(exc)[:300]}")

    return {
        "drive_file_id": object_name,
        "filename": f"{image_type}_{timestamp}.jpg",
        "file_size_bytes": len(file_bytes),
    }


# ---------------------------------------------------------------------------
# POST /receipts/{receipt_id}/images — Add image to a receipt
# ---------------------------------------------------------------------------

@router.post("/{receipt_id}/images", status_code=201)
async def upload_receipt_image(
    receipt_id: str,
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Upload an image for a specific receipt and persist Drive ID."""
    receipt_resp = db.table("receipts").select("*, claim:claims(reference_code, status, filled_by)").eq("id", receipt_id).execute()
    if not receipt_resp.data:
        raise HTTPException(404, "Receipt not found")
    receipt = receipt_resp.data[0]
    _assert_claim_editable(db, receipt["claim_id"], _auth)
    reference_code = receipt.get("claim", {}).get("reference_code", receipt["claim_id"])
    existing_count = (
        db.table("receipt_images")
        .select("id", count="exact")
        .eq("receipt_id", receipt_id)
        .execute()
        .count
        or 0
    )
    if existing_count >= settings.MAX_RECEIPT_IMAGES_PER_RECEIPT:
        raise HTTPException(
            413,
            f"Maximum {settings.MAX_RECEIPT_IMAGES_PER_RECEIPT} receipt images per receipt.",
        )

    raw_bytes = await file.read()
    try:
        processed = image.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))

    from datetime import datetime as _datetime
    timestamp = _datetime.now().strftime("%Y%m%d_%H%M%S")
    object_name = r2.make_object_name(reference_code, "receipt", timestamp)
    drive_file_id = r2.upload_file(processed, object_name)

    try:
        img_resp = insert_file_row(db, "receipt_images", {
            "receipt_id": receipt_id,
            "drive_file_id": drive_file_id,
            "file_size_bytes": len(processed),
        })
        if not img_resp.data:
            raise RuntimeError("No receipt image row returned")
    except Exception as exc:
        r2.delete_file(drive_file_id)
        logger.exception("Failed to save receipt image row for receipt %s: %s", receipt_id, exc)
        raise HTTPException(500, "Failed to save receipt image")
    return img_resp.data[0]


@router.post("/{receipt_id}/fx-images", status_code=201)
async def upload_receipt_fx_image(
    receipt_id: str,
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Upload an exchange-rate screenshot and persist it on the receipt."""
    receipt_resp = db.table("receipts").select("*, claim:claims(reference_code, status, filled_by)").eq("id", receipt_id).execute()
    if not receipt_resp.data:
        raise HTTPException(404, "Receipt not found")
    receipt = receipt_resp.data[0]
    _assert_claim_editable(db, receipt["claim_id"], _auth)
    reference_code = receipt.get("claim", {}).get("reference_code", receipt["claim_id"])

    existing_ids = [fid for fid in (receipt.get("exchange_rate_screenshot_drive_ids") or []) if fid]
    legacy_id = receipt.get("exchange_rate_screenshot_drive_id")
    if legacy_id and legacy_id not in existing_ids:
        existing_ids.insert(0, legacy_id)
    if len(existing_ids) >= settings.MAX_RECEIPT_IMAGES_PER_RECEIPT:
        raise HTTPException(
            413,
            f"Maximum {settings.MAX_RECEIPT_IMAGES_PER_RECEIPT} exchange-rate screenshots per receipt.",
        )

    raw_bytes = await file.read()
    try:
        processed = image.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))

    from datetime import datetime as _datetime
    timestamp = _datetime.now().strftime("%Y%m%d_%H%M%S")
    object_name = r2.make_object_name(reference_code, "exchange_rate", timestamp)
    drive_file_id = r2.upload_file(processed, object_name)
    next_ids = existing_ids + [drive_file_id]

    try:
        update_resp = (
            db.table("receipts")
            .update({
                "exchange_rate_screenshot_drive_id": next_ids[0],
                "exchange_rate_screenshot_drive_ids": next_ids,
                "is_foreign_currency": True,
            })
            .eq("id", receipt_id)
            .execute()
        )
        if not update_resp.data:
            raise RuntimeError("No receipt row returned")
    except Exception as exc:
        r2.delete_file(drive_file_id)
        logger.exception("Failed to save FX screenshot for receipt %s: %s", receipt_id, exc)
        raise HTTPException(500, "Failed to save exchange-rate screenshot")

    return {
        "drive_file_id": drive_file_id,
        "exchange_rate_screenshot_drive_ids": next_ids,
        "file_size_bytes": len(processed),
    }


@router.delete("/{receipt_id}/images/{image_id}")
async def delete_receipt_image(
    receipt_id: str,
    image_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = db.table("receipt_images").select("*, receipt:receipts(claim_id)").eq("id", image_id).eq("receipt_id", receipt_id).execute()
    if not resp.data:
        raise HTTPException(404, "Image not found")
    claim_id = (resp.data[0].get("receipt") or {}).get("claim_id", "")
    if claim_id:
        _assert_claim_editable(db, claim_id, _auth)
    db.table("receipt_images").delete().eq("id", image_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# POST /receipts — Create receipt with auto-grouping
# ---------------------------------------------------------------------------

@router.post("")
async def create_receipt(
    payload: ReceiptCreate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """
    Create a receipt and auto-assign it to a line item by category.
    Returns split_needed=True if this would create a 6th category.
    """
    # 1. Fetch the claim (404 if not found or soft-deleted)
    _get_claim_or_404(db, payload.claim_id)
    _assert_claim_editable(db, payload.claim_id, _member)
    if len(payload.receipt_image_drive_ids or []) > settings.MAX_RECEIPT_IMAGES_PER_RECEIPT:
        raise HTTPException(
            413,
            f"Maximum {settings.MAX_RECEIPT_IMAGES_PER_RECEIPT} receipt images per receipt.",
        )
    if payload.bank_transaction_drive_ids and len(payload.bank_transaction_drive_ids) > settings.MAX_BANK_IMAGES_PER_TRANSACTION:
        raise HTTPException(
            413,
            f"Maximum {settings.MAX_BANK_IMAGES_PER_TRANSACTION} bank screenshots per transaction.",
        )

    # 2. Check if a line item already exists for this category
    existing_line_item = _get_line_item_for_category(db, payload.claim_id, payload.category)

    if existing_line_item:
        # 3a. Assign to the existing line item
        line_item = existing_line_item
    else:
        # 3b. Check current line item count
        count = _count_line_items(db, payload.claim_id)
        if count >= MAX_CATEGORIES:
            # Would create a 6th category — signal split needed
            return {
                "split_needed": True,
                "reason": "max_categories",
                "receipt": None,
                "line_item": None,
            }
        # Create a new line item
        line_item = _create_line_item(
            db,
            claim_id=payload.claim_id,
            category=payload.category,
            gst_code=payload.gst_code,
            dr_cr=payload.dr_cr,
            index=count + 1,
        )

    # 4. Insert the receipt
    receipt_data: dict = {
        "claim_id": payload.claim_id,
        "line_item_id": line_item["id"],
        "description": payload.description,
        "amount": payload.amount,
    }
    if payload.claimed_amount is not None:
        receipt_data["claimed_amount"] = payload.claimed_amount
    if payload.receipt_no is not None:
        receipt_data["receipt_no"] = payload.receipt_no
    if payload.company is not None:
        receipt_data["company"] = payload.company
    if payload.date:  # treat empty string as absent — empty string is invalid for date column
        receipt_data["date"] = payload.date
    if payload.receipt_image_drive_id is not None:
        receipt_data["receipt_image_drive_id"] = payload.receipt_image_drive_id
    if payload.bank_screenshot_drive_id is not None:
        receipt_data["bank_screenshot_drive_id"] = payload.bank_screenshot_drive_id
    receipt_data["is_foreign_currency"] = payload.is_foreign_currency
    if payload.exchange_rate_screenshot_drive_id is not None:
        receipt_data["exchange_rate_screenshot_drive_id"] = payload.exchange_rate_screenshot_drive_id
    if payload.exchange_rate_screenshot_drive_ids is not None:
        receipt_data["exchange_rate_screenshot_drive_ids"] = payload.exchange_rate_screenshot_drive_ids

    insert_resp = db.table("receipts").insert(receipt_data).execute()
    if not insert_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create receipt")

    receipt = insert_resp.data[0]

    # Insert receipt images
    for drive_id in (payload.receipt_image_drive_ids or []):
        db.table("receipt_images").insert({"receipt_id": receipt["id"], "drive_file_id": drive_id}).execute()

    # Handle bank transaction
    if payload.bank_transaction_drive_ids:
        bt_resp = db.table("bank_transactions").insert({"claim_id": payload.claim_id}).execute()
        if bt_resp.data:
            bt_id = bt_resp.data[0]["id"]
            for drive_id in payload.bank_transaction_drive_ids:
                db.table("bank_transaction_images").insert({"bank_transaction_id": bt_id, "drive_file_id": drive_id}).execute()
            db.table("receipts").update({"bank_transaction_id": bt_id}).eq("id", receipt["id"]).execute()
            receipt["bank_transaction_id"] = bt_id
    elif payload.bank_transaction_id:
        db.table("receipts").update({"bank_transaction_id": payload.bank_transaction_id}).eq("id", receipt["id"]).execute()
        receipt["bank_transaction_id"] = payload.bank_transaction_id

    return {
        "split_needed": False,
        "reason": None,
        "receipt": receipt,
        "line_item": line_item,
    }


# ---------------------------------------------------------------------------
# GET /receipts — List receipts for a claim
# ---------------------------------------------------------------------------

@router.get("")
async def list_receipts(
    claim_id: str = Query(...),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """List all receipts for a claim, ordered by created_at, with line_item info."""
    get_claim_for_member(db, claim_id, _member)

    resp = (
        db.table("receipts")
        .select("*, line_item:claim_line_items(*)")
        .eq("claim_id", claim_id)
        .order("created_at")
        .execute()
    )
    return resp.data


# ---------------------------------------------------------------------------
# GET /receipts/{receipt_id} — Get single receipt with line_item
# ---------------------------------------------------------------------------

@router.get("/{receipt_id}")
async def get_receipt(
    receipt_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = (
        db.table("receipts")
        .select("*, line_item:claim_line_items(*)")
        .eq("id", receipt_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Receipt not found")
    get_claim_for_member(db, resp.data[0]["claim_id"], _member)
    return resp.data[0]


# ---------------------------------------------------------------------------
# PATCH /receipts/line-items/{line_item_id} — Update line item
# ---------------------------------------------------------------------------
# NOTE: This route must be defined BEFORE /{receipt_id} to avoid the path
# parameter swallowing "line-items" as a receipt_id.

@router.patch("/line-items/{line_item_id}")
async def update_line_item(
    line_item_id: str,
    payload: LineItemUpdate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Update only combined_description, gst_code, or dr_cr on a line item."""
    # Verify exists
    check = db.table("claim_line_items").select("id, claim_id").eq("id", line_item_id).execute()
    if not check.data:
        raise HTTPException(status_code=404, detail="Line item not found")
    get_claim_for_member(db, check.data[0]["claim_id"], _member, require_treasurer_draft=True)

    update_data: dict = {}
    if payload.combined_description is not None:
        update_data["combined_description"] = payload.combined_description
    if payload.gst_code is not None:
        update_data["gst_code"] = payload.gst_code
    if payload.dr_cr is not None:
        update_data["dr_cr"] = payload.dr_cr

    if not update_data:
        raise HTTPException(status_code=422, detail="No updatable fields provided")

    resp = (
        db.table("claim_line_items")
        .update(update_data)
        .eq("id", line_item_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to update line item")
    return resp.data[0]


# ---------------------------------------------------------------------------
# PATCH /receipts/{receipt_id} — Update receipt (with category-change logic)
# ---------------------------------------------------------------------------

@router.patch("/{receipt_id}")
async def update_receipt(
    receipt_id: str,
    payload: ReceiptUpdate,
    confirm_category_change: bool = Query(default=False),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """
    Update a receipt.  If the category changes and the current line item has a
    combined_description, a confirmation is required before proceeding.
    Pass ?confirm_category_change=true to confirm.
    """
    receipt = _get_receipt_or_404(db, receipt_id)
    _assert_claim_editable(db, receipt["claim_id"], _member)
    old_line_item_id: Optional[str] = receipt.get("line_item_id")

    # Determine if category is changing
    new_category = payload.category
    category_changing = False

    if new_category is not None and old_line_item_id is not None:
        # Fetch old line item to check combined_description and detect actual change
        old_li_resp = (
            db.table("claim_line_items")
            .select("*")
            .eq("id", old_line_item_id)
            .execute()
        )
        old_line_item = old_li_resp.data[0] if old_li_resp.data else None

        old_category = old_line_item["category"] if old_line_item else None
        category_changing = (old_category is not None) and (new_category != old_category)

        if category_changing and not confirm_category_change:
            # Check if old line item has a combined_description
            if old_line_item and old_line_item.get("combined_description"):
                return {
                    "requires_confirmation": True,
                    "message": (
                        "The combined description for this group will need updating. Proceed?"
                    ),
                    "receipt": None,
                }

    # Build the field update dict for the receipt row
    update_data: dict = {}
    for field in ("receipt_no", "description", "company", "amount",
                  "receipt_image_drive_id", "bank_screenshot_drive_id"):
        value = getattr(payload, field, None)
        if value is not None:
            update_data[field] = value
    if payload.date:  # treat empty string as absent
        update_data["date"] = payload.date
    # claimed_amount uses model_fields_set to allow explicit null (clearing the value)
    if "claimed_amount" in payload.model_fields_set:
        update_data["claimed_amount"] = payload.claimed_amount
    if payload.is_foreign_currency is not None:
        update_data["is_foreign_currency"] = payload.is_foreign_currency
        if not payload.is_foreign_currency:
            update_data["exchange_rate_screenshot_drive_id"] = None
    if payload.exchange_rate_screenshot_drive_id is not None:
        update_data["exchange_rate_screenshot_drive_id"] = payload.exchange_rate_screenshot_drive_id
    if payload.exchange_rate_screenshot_drive_ids is not None:
        update_data["exchange_rate_screenshot_drive_ids"] = payload.exchange_rate_screenshot_drive_ids

    if new_category is not None:
        claim_id: str = receipt["claim_id"]

        if old_line_item_id is None or category_changing:
            # No existing line item, or category is actually changing — find or create one
            new_line_item = _get_line_item_for_category(db, claim_id, new_category)
            if new_line_item is None:
                count = _count_line_items(db, claim_id)
                if count >= MAX_CATEGORIES:
                    return {
                        "split_needed": True,
                        "reason": "max_categories",
                        "receipt": None,
                        "line_item": None,
                    }
                new_line_item = _create_line_item(
                    db,
                    claim_id=claim_id,
                    category=new_category,
                    gst_code=payload.gst_code or "IE",
                    dr_cr=payload.dr_cr or "DR",
                    index=count + 1,
                )
            if new_line_item["id"] != old_line_item_id:
                update_data["line_item_id"] = new_line_item["id"]
        else:
            # Category unchanged — update gst_code/dr_cr on the existing line item
            li_update: dict = {}
            if payload.gst_code is not None:
                li_update["gst_code"] = payload.gst_code
            if payload.dr_cr is not None:
                li_update["dr_cr"] = payload.dr_cr
            if li_update:
                db.table("claim_line_items").update(li_update).eq("id", old_line_item_id).execute()

    if not update_data:
        # Nothing to update on the receipt row — return it as-is
        return receipt

    resp = (
        db.table("receipts")
        .update(update_data)
        .eq("id", receipt_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to update receipt")

    updated_receipt = resp.data[0]

    # Clean up old line item if it has no remaining receipts after the move
    if old_line_item_id and "line_item_id" in update_data and old_line_item_id != update_data["line_item_id"]:
        _delete_line_item_if_empty(db, old_line_item_id)

    # Handle receipt images replacement
    if payload.receipt_image_drive_ids is not None:
        if len(payload.receipt_image_drive_ids) > settings.MAX_RECEIPT_IMAGES_PER_RECEIPT:
            raise HTTPException(
                413,
                f"Maximum {settings.MAX_RECEIPT_IMAGES_PER_RECEIPT} receipt images per receipt.",
            )
        db.table("receipt_images").delete().eq("receipt_id", receipt_id).execute()
        for drive_id in payload.receipt_image_drive_ids:
            db.table("receipt_images").insert({"receipt_id": receipt_id, "drive_file_id": drive_id}).execute()

    # Handle bank transaction changes
    if payload.clear_bank_transaction:
        db.table("receipts").update({"bank_transaction_id": None}).eq("id", receipt_id).execute()
    elif payload.bank_transaction_drive_ids is not None:
        if len(payload.bank_transaction_drive_ids) > settings.MAX_BANK_IMAGES_PER_TRANSACTION:
            raise HTTPException(
                413,
                f"Maximum {settings.MAX_BANK_IMAGES_PER_TRANSACTION} bank screenshots per transaction.",
            )
        bt_resp = db.table("bank_transactions").insert({"claim_id": receipt["claim_id"]}).execute()
        if bt_resp.data:
            bt_id = bt_resp.data[0]["id"]
            for drive_id in payload.bank_transaction_drive_ids:
                db.table("bank_transaction_images").insert({"bank_transaction_id": bt_id, "drive_file_id": drive_id}).execute()
            db.table("receipts").update({"bank_transaction_id": bt_id}).eq("id", receipt_id).execute()
    elif payload.bank_transaction_id is not None:
        db.table("receipts").update({"bank_transaction_id": payload.bank_transaction_id}).eq("id", receipt_id).execute()

    return updated_receipt


# ---------------------------------------------------------------------------
# DELETE /receipts/{receipt_id} — Delete receipt
# ---------------------------------------------------------------------------

@router.delete("/{receipt_id}")
async def delete_receipt(
    receipt_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """
    Delete a receipt from DB.  Also cleans up:
    - Orphaned line_item (if no other receipts remain)
    - Drive files (receipt_image_drive_id, bank_screenshot_drive_id)
    """
    receipt = _get_receipt_or_404(db, receipt_id)
    _assert_claim_editable(db, receipt["claim_id"], _member)
    line_item_id: Optional[str] = receipt.get("line_item_id")

    # Delete from DB
    db.table("receipts").delete().eq("id", receipt_id).execute()

    # Clean up orphaned line item
    if line_item_id:
        _delete_line_item_if_empty(db, line_item_id)

    # Delete GCS files (best-effort — don't fail if GCS is unavailable)
    for drive_field in ("receipt_image_drive_id", "bank_screenshot_drive_id"):
        object_name = receipt.get(drive_field)
        if object_name:
            r2.delete_file(object_name)

    return {"deleted": True}
