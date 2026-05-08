import logging

from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from supabase import Client
from datetime import datetime

from app.auth import get_claim_for_member, require_auth
from app.database import get_supabase
from app.services import r2, image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bank-transactions", tags=["bank-transactions"])


def _get_bt_or_404(bt_id: str, db: Client) -> dict:
    bt_resp = db.table("bank_transactions").select("*").eq("id", bt_id).execute()
    if not bt_resp.data:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    return bt_resp.data[0]


async def _get_bt_and_upload_file(
    bt_id: str, file: UploadFile, db: Client, filename_prefix: str, member: dict
) -> tuple[dict, str]:
    """Verify BT exists, process image, upload to Drive. Returns (bt_row, drive_file_id)."""
    bt_resp = db.table("bank_transactions").select("*, claim:claims(reference_code)").eq("id", bt_id).execute()
    if not bt_resp.data:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    bt = bt_resp.data[0]
    get_claim_for_member(db, bt["claim_id"], member, require_treasurer_draft=True)
    reference_code = bt.get("claim", {}).get("reference_code", bt["claim_id"])

    raw_bytes = await file.read()
    try:
        processed = image.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        object_name = r2.make_object_name(reference_code, filename_prefix, timestamp)
        drive_file_id = r2.upload_file(processed, object_name)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("R2 upload failed for BT %s: %s", bt_id, exc)
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {str(exc)[:300]}")
    return bt, drive_file_id


@router.post("", status_code=201)
async def create_bank_transaction(
    claim_id: str = Form(...),
    amount: float = Form(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Create an empty bank transaction for a claim."""
    get_claim_for_member(db, claim_id, _auth, require_treasurer_draft=True)
    resp = db.table("bank_transactions").insert({"claim_id": claim_id, "amount": amount}).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create bank transaction")
    return {**resp.data[0], "images": []}


@router.post("/{bt_id}/images", status_code=201)
async def upload_bank_transaction_image(
    bt_id: str,
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Upload an image for a bank transaction, store in Drive, persist Drive ID."""
    _bt, drive_file_id = await _get_bt_and_upload_file(bt_id, file, db, "bank", _auth)

    img_resp = db.table("bank_transaction_images").insert({
        "bank_transaction_id": bt_id,
        "drive_file_id": drive_file_id,
    }).execute()
    if not img_resp.data:
        raise HTTPException(status_code=500, detail="Failed to save bank transaction image")
    return img_resp.data[0]


@router.delete("/{bt_id}/images/{image_id}")
async def delete_bank_transaction_image(
    bt_id: str,
    image_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Delete a bank transaction image record and remove the file from Drive."""
    bt = _get_bt_or_404(bt_id, db)
    get_claim_for_member(db, bt["claim_id"], _auth, require_treasurer_draft=True)
    resp = db.table("bank_transaction_images").select("id, drive_file_id").eq("id", image_id).eq("bank_transaction_id", bt_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Image not found")
    row = resp.data[0]
    file_id = row.get("drive_file_id")
    if file_id:
        r2.delete_file(file_id)
    db.table("bank_transaction_images").delete().eq("id", image_id).execute()
    return {"deleted": True}


@router.post("/{bt_id}/refunds", status_code=201)
async def create_bt_refund(
    bt_id: str,
    amount: float = Form(...),
    files: List[UploadFile] = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Create a refund for a bank transaction. Accepts one or more image files."""
    if not files:
        raise HTTPException(status_code=422, detail="At least one file is required")

    drive_file_ids = []
    for f in files:
        _, fid = await _get_bt_and_upload_file(bt_id, f, db, "refund", _auth)
        drive_file_ids.append(fid)

    refund_resp = db.table("bank_transaction_refunds").insert({
        "bank_transaction_id": bt_id,
        "amount": amount,
        "drive_file_id": drive_file_ids[0],
        "extra_drive_file_ids": drive_file_ids[1:] if len(drive_file_ids) > 1 else [],
    }).execute()
    if not refund_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create refund")
    return refund_resp.data[0]


@router.patch("/{bt_id}/refunds/{refund_id}")
async def update_bt_refund_file(
    bt_id: str,
    refund_id: str,
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Replace the file attached to a refund."""
    bt = _get_bt_or_404(bt_id, db)
    get_claim_for_member(db, bt["claim_id"], _auth, require_treasurer_draft=True)
    resp = db.table("bank_transaction_refunds").select("id, drive_file_id").eq("id", refund_id).eq("bank_transaction_id", bt_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Refund not found")
    old_file_id = resp.data[0].get("drive_file_id")

    _bt, new_drive_file_id = await _get_bt_and_upload_file(bt_id, file, db, "refund", _auth)

    db.table("bank_transaction_refunds").update({"drive_file_id": new_drive_file_id}).eq("id", refund_id).execute()

    if old_file_id:
        try:
            r2.delete_file(old_file_id)
        except Exception:
            pass

    return {"drive_file_id": new_drive_file_id}


@router.delete("/{bt_id}/refunds/{refund_id}")
async def delete_bt_refund(
    bt_id: str,
    refund_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Delete a bank transaction refund record and remove the file from GCS."""
    bt = _get_bt_or_404(bt_id, db)
    get_claim_for_member(db, bt["claim_id"], _auth, require_treasurer_draft=True)
    resp = db.table("bank_transaction_refunds").select("id, drive_file_id").eq("id", refund_id).eq("bank_transaction_id", bt_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Refund not found")
    row = resp.data[0]
    file_id = row.get("drive_file_id")
    if file_id:
        r2.delete_file(file_id)
    db.table("bank_transaction_refunds").delete().eq("id", refund_id).execute()
    return {"deleted": True}


@router.patch("/{bt_id}")
async def update_bank_transaction(
    bt_id: str,
    amount: float = Form(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Update a bank transaction's total amount."""
    bt = _get_bt_or_404(bt_id, db)
    get_claim_for_member(db, bt["claim_id"], _auth, require_treasurer_draft=True)
    resp = db.table("bank_transactions").update({"amount": amount}).eq("id", bt_id).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to update bank transaction")
    return resp.data[0]


@router.delete("/{bt_id}")
async def delete_bank_transaction(
    bt_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Delete a bank transaction; unlinks all receipts (sets their bank_transaction_id to null)."""
    bt = _get_bt_or_404(bt_id, db)
    get_claim_for_member(db, bt["claim_id"], _auth, require_treasurer_draft=True)
    db.table("receipts").update({"bank_transaction_id": None}).eq("bank_transaction_id", bt_id).execute()
    db.table("bank_transactions").delete().eq("id", bt_id).execute()
    return {"deleted": True}
