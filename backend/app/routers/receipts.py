import base64
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from supabase import Client

from app.auth import require_auth
from app.database import get_supabase
from app.services import drive, image

router = APIRouter(prefix="/receipts", tags=["receipts"])


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

    reference_code = claim_resp.data[0].get("reference_code")
    if not reference_code:
        raise HTTPException(status_code=422, detail="Claim has no reference code yet")

    # Resolve / create Drive folders
    claim_folder_id = drive.get_claim_folder_id(reference_code)
    receipts_folder_id = drive.get_or_create_folder("receipts", claim_folder_id)

    # Read file and generate filename
    file_bytes = await file.read()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{image_type}_{timestamp}.jpg"

    # Upload to Drive
    drive_file_id = drive.upload_file(
        file_bytes=file_bytes,
        filename=filename,
        mime_type="image/jpeg",
        parent_folder_id=receipts_folder_id,
    )

    return {"drive_file_id": drive_file_id, "filename": filename}
