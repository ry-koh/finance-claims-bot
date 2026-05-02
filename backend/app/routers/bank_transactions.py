from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from supabase import Client
from datetime import datetime

from app.auth import require_auth
from app.database import get_supabase
from app.services import drive, image

router = APIRouter(prefix="/bank-transactions", tags=["bank-transactions"])


@router.post("", status_code=201)
async def create_bank_transaction(
    claim_id: str = Form(...),
    amount: float = Form(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Create an empty bank transaction for a claim."""
    resp = db.table("bank_transactions").insert({"claim_id": claim_id, "amount": amount}).execute()
    if not resp.data:
        raise HTTPException(500, "Failed to create bank transaction")
    return {**resp.data[0], "images": []}


@router.post("/{bt_id}/images", status_code=201)
async def upload_bank_transaction_image(
    bt_id: str,
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Upload an image for a bank transaction, store in Drive, persist Drive ID."""
    # Verify BT exists + get claim reference_code
    bt_resp = db.table("bank_transactions").select("*, claim:claims(reference_code)").eq("id", bt_id).execute()
    if not bt_resp.data:
        raise HTTPException(404, "Bank transaction not found")
    bt = bt_resp.data[0]
    reference_code = bt.get("claim", {}).get("reference_code", bt["claim_id"])

    # Process image
    raw_bytes = await file.read()
    try:
        processed = image.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Upload to Drive
    claim_folder_id = drive.get_claim_folder_id(reference_code)
    receipts_folder_id = drive.get_or_create_folder("receipts", claim_folder_id)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    drive_file_id = drive.upload_file(processed, f"bank_{timestamp}.jpg", "image/jpeg", receipts_folder_id)

    # Persist
    img_resp = db.table("bank_transaction_images").insert({
        "bank_transaction_id": bt_id,
        "drive_file_id": drive_file_id,
    }).execute()
    if not img_resp.data:
        raise HTTPException(500, "Failed to save bank transaction image")
    return img_resp.data[0]


@router.delete("/{bt_id}/images/{image_id}")
async def delete_bank_transaction_image(
    bt_id: str,
    image_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = db.table("bank_transaction_images").select("*").eq("id", image_id).eq("bank_transaction_id", bt_id).execute()
    if not resp.data:
        raise HTTPException(404, "Image not found")
    db.table("bank_transaction_images").delete().eq("id", image_id).execute()
    return {"deleted": True}


@router.post("/{bt_id}/refunds", status_code=201)
async def create_bt_refund(
    bt_id: str,
    amount: float = Form(...),
    file: UploadFile = File(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Create a refund for a bank transaction with receipt image."""
    # Verify BT exists + get claim reference_code
    bt_resp = db.table("bank_transactions").select("*, claim:claims(reference_code)").eq("id", bt_id).execute()
    if not bt_resp.data:
        raise HTTPException(404, "Bank transaction not found")
    bt = bt_resp.data[0]
    reference_code = bt.get("claim", {}).get("reference_code", bt["claim_id"])

    # Process image
    raw_bytes = await file.read()
    try:
        processed = image.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Upload to Drive
    claim_folder_id = drive.get_claim_folder_id(reference_code)
    receipts_folder_id = drive.get_or_create_folder("receipts", claim_folder_id)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    drive_file_id = drive.upload_file(processed, f"refund_{timestamp}.jpg", "image/jpeg", receipts_folder_id)

    # Persist
    refund_resp = db.table("bank_transaction_refunds").insert({
        "bank_transaction_id": bt_id,
        "amount": amount,
        "drive_file_id": drive_file_id,
    }).execute()
    if not refund_resp.data:
        raise HTTPException(500, "Failed to create refund")
    return refund_resp.data[0]


@router.delete("/{bt_id}/refunds/{refund_id}")
async def delete_bt_refund(
    bt_id: str,
    refund_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = db.table("bank_transaction_refunds").select("id").eq("id", refund_id).eq("bank_transaction_id", bt_id).execute()
    if not resp.data:
        raise HTTPException(404, "Refund not found")
    db.table("bank_transaction_refunds").delete().eq("id", refund_id).execute()
    return {"deleted": True}


@router.patch("/{bt_id}")
async def update_bank_transaction(
    bt_id: str,
    amount: float = Form(...),
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = db.table("bank_transactions").update({"amount": amount}).eq("id", bt_id).execute()
    if not resp.data:
        raise HTTPException(404, "Bank transaction not found")
    return resp.data[0]


@router.delete("/{bt_id}")
async def delete_bank_transaction(
    bt_id: str,
    _auth: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Delete a bank transaction; unlinks all receipts (sets their bank_transaction_id to null)."""
    db.table("receipts").update({"bank_transaction_id": None}).eq("bank_transaction_id", bt_id).execute()
    db.table("bank_transactions").delete().eq("id", bt_id).execute()
    return {"deleted": True}
