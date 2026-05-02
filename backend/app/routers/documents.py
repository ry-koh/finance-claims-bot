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
import io, tempfile, os, logging, re

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

def _bt_in_half(bt: dict, all_receipts: list, receipts_in_half_ids: set, is_first: bool) -> bool:
    """Return True if this bank transaction belongs to the given half."""
    linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
    if not linked:
        return is_first
    return any(r["id"] in receipts_in_half_ids for r in linked)


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

    # Fetch bank transactions with their images and refunds
    bt_resp = db.table("bank_transactions").select("*").eq("claim_id", claim_id).order("created_at").execute()
    bank_transactions = bt_resp.data
    if bank_transactions:
        bt_ids = [bt["id"] for bt in bank_transactions]
        bti_resp = db.table("bank_transaction_images").select("*").in_("bank_transaction_id", bt_ids).order("created_at").execute()
        images_by_bt: dict = {}
        for img in bti_resp.data:
            images_by_bt.setdefault(img["bank_transaction_id"], []).append(img)
        btr_resp = db.table("bank_transaction_refunds").select("*").in_("bank_transaction_id", bt_ids).order("created_at").execute()
        refunds_by_bt: dict = {}
        for ref in btr_resp.data:
            refunds_by_bt.setdefault(ref["bank_transaction_id"], []).append(ref)
        for bt in bank_transactions:
            bt["images"] = images_by_bt.get(bt["id"], [])
            bt["refunds"] = refunds_by_bt.get(bt["id"], [])

    # Determine split halves
    line_items = claim.get("line_items", [])  # ordered by line_item_index
    base_code = claim["reference_code"]

    if len(line_items) <= 5:
        halves = [(line_items, "")]
    else:
        chunks = [line_items[i:i + 5] for i in range(0, len(line_items), 5)]
        suffixes = ["A", "B", "C"]
        halves = [(chunk, suffixes[idx]) for idx, chunk in enumerate(chunks) if chunk]

    generated = []

    try:
        for half_idx, (half_items, suffix) in enumerate(halves):
            ref_code = base_code + suffix  # e.g. "2526-VPE-HPB-003A" or "2526-VPE-HPB-003"
            is_first_half = (half_idx == 0)

            # Collect receipt IDs in this half
            half_receipt_ids = {
                r["id"]
                for item in half_items
                for r in item.get("receipts", [])
            }

            # Filter all_receipts to this half
            half_receipts = [r for r in all_receipts if r["id"] in half_receipt_ids]

            # BTs relevant to this half:
            # - BTs with NO linked receipts: include only in the first half to avoid duplication
            # - BTs with receipts: include if ANY linked receipt is in this half
            half_bts = [
                bt for bt in bank_transactions
                if _bt_in_half(bt, all_receipts, half_receipt_ids, is_first_half)
            ]

            # Generate LOA
            loa_bytes = pdf_service.generate_loa(claim, half_receipts, half_bts, reference_code_override=ref_code)
            doc_key = f"loa{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, doc_key, loa_bytes, f"LOA - {ref_code}.pdf", folder_id, db)
            generated.append(doc_key)

            # Generate Summary
            summary_bytes = pdf_service.generate_summary(claim, half_items, finance_director, folder_id, reference_code_override=ref_code)
            summary_key = f"summary{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, summary_key, summary_bytes, f"Summary - {ref_code}.pdf", folder_id, db)
            generated.append(summary_key)

            # Generate RFP
            rfp_bytes = pdf_service.generate_rfp(claim, half_items, finance_director, folder_id, reference_code_override=ref_code)
            rfp_key = f"rfp{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, rfp_key, rfp_bytes, f"RFP - {ref_code}.pdf", folder_id, db)
            generated.append(rfp_key)

        # Transport (optional, only for single/no-split claims — always use full line_items)
        if claim.get("transport_form_needed") and claim.get("transport_data"):
            transport_bytes = pdf_service.generate_transport(
                claim, claim["transport_data"], finance_director, folder_id
            )
            _save_document(
                claim_id, "transport", transport_bytes,
                f"Transport - {claim['reference_code']}.pdf", folder_id, db
            )
            generated.append("transport")

        # --- Auto-generate remarks ---
        remarks_lines = []

        # Refund remarks — for each BT with refunds
        for bt in bank_transactions:
            if bt.get("refunds"):
                refund_amounts = [float(r["amount"]) for r in bt["refunds"]]
                total_refunded = sum(refund_amounts)
                net = float(bt["amount"]) - total_refunded
                # Number each refund line, then initial BT, then total
                n = 1
                for amt in refund_amounts:
                    remarks_lines.append(f"{n}. An item was refunded and the amount refunded is ${amt:.2f}")
                    n += 1
                remarks_lines.append(f"{n}. Initial Bank Transaction is ${float(bt['amount']):.2f}")
                n += 1
                formula = " - ".join([f"${float(bt['amount']):.2f}"] + [f"${a:.2f}" for a in refund_amounts])
                remarks_lines.append(f"{n}. Total Amount is {formula} = ${net:.2f}")

        # Cross-split remarks — only when there are multiple halves
        if len(halves) > 1:
            # Build map: line_item_id -> suffix
            li_to_suffix = {}
            for items, suf in halves:
                for item in items:
                    li_to_suffix[item["id"]] = suf

            # Build map: receipt_id -> suffix
            r_to_suffix = {}
            for r in all_receipts:
                if r.get("line_item_id") in li_to_suffix:
                    r_to_suffix[r["id"]] = li_to_suffix[r["line_item_id"]]

            for bt in bank_transactions:
                linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
                if not linked:
                    continue
                half_sums: dict = {}
                for r in linked:
                    s = r_to_suffix.get(r["id"], halves[0][1])
                    half_sums[s] = half_sums.get(s, 0.0) + float(r["amount"])

                if len(half_sums) > 1:
                    for suf, local_sum in half_sums.items():
                        other_parts = [(s, v) for s, v in half_sums.items() if s != suf]
                        other_str = " and ".join(
                            f"Claim ID {base_code}{s} value of ${v:.2f}" for s, v in other_parts
                        )
                        calc_str = " + ".join(
                            f"${v:.2f} ({base_code}{s})" for s, v in sorted(half_sums.items())
                        )
                        remarks_lines.append(
                            f"1. Bank Transaction shows ${float(bt['amount']):.2f} as it includes {other_str} as well"
                        )
                        remarks_lines.append(
                            f"2. {calc_str} = ${float(bt['amount']):.2f} (Bank Transaction)"
                        )

        # Persist remarks (replace AUTO block or append)
        if remarks_lines:
            auto_block = "\n".join(remarks_lines)
            existing = claim.get("remarks") or ""
            sentinel_re = re.compile(r"<!-- AUTO -->.*?<!-- /AUTO -->", re.DOTALL)
            new_block = f"<!-- AUTO -->\n{auto_block}\n<!-- /AUTO -->"
            if sentinel_re.search(existing):
                new_remarks = sentinel_re.sub(new_block, existing)
            else:
                new_remarks = (existing + "\n\n" + new_block).strip()
            db.table("claims").update({"remarks": new_remarks}).eq("id", claim_id).execute()

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
