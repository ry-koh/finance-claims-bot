from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from app.database import get_supabase
from app.auth import require_auth
from app.services import pdf as pdf_service
from app.services import drive as drive_service
from app.services import image as image_service
from app.config import settings
from fpdf import FPDF
import io, tempfile, os, logging

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TransportTrip(BaseModel):
    from_location: str
    to_location: str
    purpose: str
    distance_km: Optional[float] = None
    mode: str  # taxi, bus_mrt, mileage
    amount: float


class TransportData(BaseModel):
    trips: list[TransportTrip]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_full_claim(claim_id: str, db) -> dict:
    result = db.table("claims").select(
        "*, claimer:claimers(*, cca:ccas(*, portfolio:portfolios(*))), "
        "line_items:claim_line_items(*, receipts(*))"
    ).eq("id", claim_id).is_("deleted_at", "null").single().execute()
    if not result.data:
        raise HTTPException(404, "Claim not found")
    return result.data


def _get_finance_director(db) -> dict:
    result = db.table("finance_team").select("*").eq("role", "director").limit(1).execute()
    if not result.data:
        raise HTTPException(500, "No Finance Director configured")
    return result.data[0]


def _save_document(claim_id: str, doc_type: str, pdf_bytes: bytes, filename: str, folder_id: str, db) -> str:
    # Upload to Google Drive
    file_id = drive_service.upload_file(pdf_bytes, filename, "application/pdf", folder_id)
    # Mark old current docs of this type as stale
    db.table("claim_documents").update({"is_current": False}).eq("claim_id", claim_id).eq("type", doc_type).eq("is_current", True).execute()
    # Insert new document record
    db.table("claim_documents").insert({
        "claim_id": claim_id,
        "type": doc_type,
        "drive_file_id": file_id,
        "is_current": True,
    }).execute()
    return file_id


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/generate/{claim_id}")
async def generate_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Generate LOA, Summary, RFP (and optionally Transport) PDFs for a claim."""
    claim = _get_full_claim(claim_id, db)
    finance_director = _get_finance_director(db)

    allowed_statuses = {"screenshot_uploaded", "docs_generated"}
    if claim.get("status") not in allowed_statuses:
        raise HTTPException(
            400,
            f"Cannot generate documents for claim with status '{claim.get('status')}'. "
            f"Expected one of: {sorted(allowed_statuses)}",
        )

    folder_id = drive_service.get_claim_folder_id(claim["reference_code"])
    all_receipts = [r for item in claim.get("line_items", []) for r in item.get("receipts", [])]

    # Attach receipt images
    if all_receipts:
        receipt_ids = [r["id"] for r in all_receipts]
        ri_resp = db.table("receipt_images").select("*").in_("receipt_id", receipt_ids).order("created_at").execute()
        images_by_receipt: dict = {}
        for img in ri_resp.data:
            images_by_receipt.setdefault(img["receipt_id"], []).append(img)
        for r in all_receipts:
            r["images"] = images_by_receipt.get(r["id"], [])
    else:
        for r in all_receipts:
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

    generated = []

    try:
        # LOA
        loa_bytes = pdf_service.generate_loa(claim, all_receipts, bank_transactions)
        _save_document(claim_id, "loa", loa_bytes, f"LOA - {claim['reference_code']}.pdf", folder_id, db)
        generated.append("loa")

        # Summary
        summary_bytes = pdf_service.generate_summary(claim, claim.get("line_items", []), finance_director, folder_id)
        _save_document(claim_id, "summary", summary_bytes, f"Summary - {claim['reference_code']}.pdf", folder_id, db)
        generated.append("summary")

        # RFP
        rfp_bytes = pdf_service.generate_rfp(claim, claim.get("line_items", []), finance_director, folder_id)
        _save_document(claim_id, "rfp", rfp_bytes, f"RFP - {claim['reference_code']}.pdf", folder_id, db)
        generated.append("rfp")

        # Transport (optional)
        if claim.get("transport_form_needed") and claim.get("transport_data"):
            transport_bytes = pdf_service.generate_transport(
                claim, claim["transport_data"], finance_director, folder_id
            )
            _save_document(
                claim_id, "transport", transport_bytes,
                f"Transport - {claim['reference_code']}.pdf", folder_id, db
            )
            generated.append("transport")

    except Exception as e:
        logger.exception("Document generation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"Document generation failed: {e}")

    db.table("claims").update({"status": "docs_generated", "error_message": None}).eq("id", claim_id).execute()
    return {"success": True, "documents": generated, "claim_status": "docs_generated"}


@router.post("/compile/{claim_id}")
async def compile_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Merge all current documents into a single compiled PDF."""
    claim = _get_full_claim(claim_id, db)

    if claim.get("status") != "docs_generated":
        raise HTTPException(
            400,
            f"Cannot compile claim with status '{claim.get('status')}'. Expected 'docs_generated'.",
        )

    result = db.table("claim_documents").select("*").eq("claim_id", claim_id).eq("is_current", True).execute()
    docs_by_type = {d["type"]: d for d in result.data}

    required = ["loa", "summary", "rfp", "email_screenshot"]
    missing = [t for t in required if t not in docs_by_type]
    if missing:
        raise HTTPException(400, f"Missing required documents: {missing}")

    folder_id = drive_service.get_claim_folder_id(claim["reference_code"])

    try:
        from pypdf import PdfWriter, PdfReader

        writer = PdfWriter()
        total_pages = 0
        for doc_type in ["rfp", "loa", "transport", "email_screenshot", "summary"]:
            if doc_type not in docs_by_type:
                continue
            file_bytes = pdf_service.download_drive_file(docs_by_type[doc_type]["drive_file_id"])
            reader = PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                writer.add_page(page)
                total_pages += 1

        output = io.BytesIO()
        writer.write(output)
        compiled_bytes = output.getvalue()

    except Exception as e:
        logger.exception("PDF compilation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"PDF compilation failed: {e}")

    _save_document(
        claim_id, "compiled", compiled_bytes,
        f"Compiled - {claim['reference_code']}.pdf", folder_id, db
    )
    db.table("claims").update({"status": "compiled", "error_message": None}).eq("id", claim_id).execute()
    return {"success": True, "claim_status": "compiled", "page_count": total_pages}


@router.post("/upload-screenshot/{claim_id}")
async def upload_screenshot(
    claim_id: str,
    file: UploadFile = File(...),
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Upload an email screenshot, convert to PDF, and mark claim as screenshot_uploaded."""
    raw_bytes = await file.read()
    try:
        processed = image_service.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image processing failed: {e}")

    claim = _get_full_claim(claim_id, db)
    folder_id = drive_service.get_claim_folder_id(claim["reference_code"])

    # Convert processed JPEG to single-page A4 PDF
    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_auto_page_break(False)
    pdf.add_page()
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(processed)
        tmp_path = tmp.name
    try:
        pdf.image(tmp_path, x=15, y=15, w=180)
    finally:
        os.unlink(tmp_path)
    screenshot_pdf_bytes = bytes(pdf.output())

    _save_document(
        claim_id, "email_screenshot", screenshot_pdf_bytes,
        f"Screenshot - {claim['reference_code']}.pdf", folder_id, db
    )
    db.table("claims").update({"status": "screenshot_uploaded"}).eq("id", claim_id).execute()
    return {"success": True, "claim_status": "screenshot_uploaded"}


@router.post("/transport-data/{claim_id}")
async def save_transport_data(
    claim_id: str,
    data: TransportData,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Save transport trip data to the claim record."""
    db.table("claims").update({"transport_data": data.model_dump()}).eq("id", claim_id).execute()
    return {"success": True}


@router.get("/{claim_id}")
async def list_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """List all current documents for a claim."""
    result = (
        db.table("claim_documents")
        .select("*")
        .eq("claim_id", claim_id)
        .eq("is_current", True)
        .order("created_at")
        .execute()
    )
    return result.data
