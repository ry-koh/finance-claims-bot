from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from app.database import get_supabase
from app.auth import require_auth
from app.services import pdf as pdf_service
from app.services import image as image_service
from app.services import r2 as r2_service
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


class SendTelegramPayload(BaseModel):
    claim_ids: list[str]


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
    if settings.FD_NAME:
        return {
            "name": settings.FD_NAME,
            "matric_no": settings.FD_MATRIC_NO,
            "phone": settings.FD_PHONE,
        }
    result = db.table("finance_team").select("*").eq("role", "director").limit(1).execute()
    if not result.data:
        raise HTTPException(500, "No Finance Director configured — set FD_NAME/FD_MATRIC_NO/FD_PHONE env vars")
    return result.data[0]


def _save_document(claim_id: str, doc_type: str, pdf_bytes: bytes, filename: str, reference_code: str, db) -> str:
    object_name = r2_service.make_document_object_name(reference_code, filename)
    r2_service.upload_file(pdf_bytes, object_name, content_type="application/pdf")
    db.table("claim_documents").update({"is_current": False}).eq("claim_id", claim_id).eq("type", doc_type).eq("is_current", True).execute()
    db.table("claim_documents").insert({
        "claim_id": claim_id,
        "type": doc_type,
        "drive_file_id": object_name,
        "is_current": True,
    }).execute()
    return object_name


def _do_compile(claim_id: str, reference_code: str, db) -> dict:
    """Merge all current documents into a compiled PDF. Returns page_count."""
    from pypdf import PdfWriter, PdfReader

    result = db.table("claim_documents").select("*").eq("claim_id", claim_id).eq("is_current", True).execute()
    docs_by_type = {d["type"]: d for d in result.data}

    def has_type_prefix(prefix):
        return any(t == prefix or t.startswith(prefix + "_") for t in docs_by_type)

    missing = [t for t in ["loa", "summary", "rfp", "email_screenshot"] if not has_type_prefix(t)]
    if missing:
        raise ValueError(f"Missing required documents: {missing}")

    writer = PdfWriter()
    total_pages = 0

    ordered_types = (
        ["rfp", "rfp_a", "rfp_b", "rfp_c"]
        + ["loa", "loa_a", "loa_b", "loa_c"]
        + ["transport"]
        + ["email_screenshot"]
        + ["summary", "summary_a", "summary_b", "summary_c"]
    )
    for doc_type in ordered_types:
        if doc_type not in docs_by_type:
            continue
        file_bytes = r2_service.download_file(docs_by_type[doc_type]["drive_file_id"])
        reader = PdfReader(io.BytesIO(file_bytes))
        for page in reader.pages:
            writer.add_page(page)
            total_pages += 1

    output = io.BytesIO()
    writer.write(output)
    compiled_bytes = output.getvalue()

    _save_document(claim_id, "compiled", compiled_bytes, f"Compiled - {reference_code}.pdf", reference_code, db)
    db.table("claims").update({"status": "compiled", "error_message": None}).eq("id", claim_id).execute()
    return {"page_count": total_pages}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _bt_in_half(bt: dict, all_receipts: list, receipts_in_half_ids: set, is_first: bool) -> bool:
    """Return True if this bank transaction belongs to the given half."""
    linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
    if not linked:
        return is_first
    return any(r["id"] in receipts_in_half_ids for r in linked)


def _do_generate(claim_id: str, db) -> dict:
    """Core document generation logic. Caller is responsible for status checks."""
    claim = _get_full_claim(claim_id, db)
    finance_director = _get_finance_director(db)
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

    line_items = claim.get("line_items", [])
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
            ref_code = base_code + suffix
            is_first_half = (half_idx == 0)

            half_receipt_ids = {r["id"] for item in half_items for r in item.get("receipts", [])}
            half_receipts = [r for r in all_receipts if r["id"] in half_receipt_ids]
            half_bts = [bt for bt in bank_transactions if _bt_in_half(bt, all_receipts, half_receipt_ids, is_first_half)]

            loa_bytes = pdf_service.generate_loa(claim, half_receipts, half_bts, reference_code_override=ref_code)
            doc_key = f"loa{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, doc_key, loa_bytes, f"LOA - {ref_code}.pdf", ref_code, db)
            generated.append(doc_key)

            summary_bytes = pdf_service.generate_summary(claim, half_items, finance_director, reference_code_override=ref_code)
            summary_key = f"summary{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, summary_key, summary_bytes, f"Summary - {ref_code}.pdf", ref_code, db)
            generated.append(summary_key)

            rfp_bytes = pdf_service.generate_rfp(claim, half_items, finance_director, reference_code_override=ref_code)
            rfp_key = f"rfp{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, rfp_key, rfp_bytes, f"RFP - {ref_code}.pdf", ref_code, db)
            generated.append(rfp_key)

        if claim.get("transport_form_needed") and claim.get("transport_data"):
            transport_bytes = pdf_service.generate_transport(claim, claim["transport_data"], finance_director)
            _save_document(claim_id, "transport", transport_bytes, f"Transport - {claim['reference_code']}.pdf", claim["reference_code"], db)
            generated.append("transport")

        # Auto-generate remarks
        remarks_lines = []
        n = 1

        for bt in bank_transactions:
            if bt.get("refunds"):
                refund_amounts = [float(r["amount"]) for r in bt["refunds"]]
                net = float(bt["amount"]) - sum(refund_amounts)
                for amt in refund_amounts:
                    remarks_lines.append(f"{n}. An item was refunded and the amount refunded is ${amt:.2f}")
                    n += 1
                remarks_lines.append(f"{n}. Initial Bank Transaction is ${float(bt['amount']):.2f}")
                n += 1
                formula = " - ".join([f"${float(bt['amount']):.2f}"] + [f"${a:.2f}" for a in refund_amounts])
                remarks_lines.append(f"{n}. Total Amount is {formula} = ${net:.2f}")
                n += 1

        if len(halves) > 1:
            li_to_suffix = {item["id"]: suf for items, suf in halves for item in items}
            r_to_suffix = {r["id"]: li_to_suffix[r["line_item_id"]] for r in all_receipts if r.get("line_item_id") in li_to_suffix}

            for bt in bank_transactions:
                linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
                if not linked:
                    continue
                half_sums: dict = {}
                for r in linked:
                    s = r_to_suffix.get(r["id"], halves[0][1])
                    half_sums[s] = half_sums.get(s, 0.0) + float(r["amount"])

                if len(half_sums) > 1:
                    for suf, _ in half_sums.items():
                        other_parts = [(s, v) for s, v in half_sums.items() if s != suf]
                        other_str = " and ".join(f"Claim ID {base_code}{s} value of ${v:.2f}" for s, v in other_parts)
                        calc_str = " + ".join(f"${v:.2f} ({base_code}{s})" for s, v in sorted(half_sums.items()))
                        remarks_lines.append(f"{n}. Bank Transaction shows ${float(bt['amount']):.2f} as it includes {other_str} as well")
                        n += 1
                        remarks_lines.append(f"{n}. {calc_str} = ${float(bt['amount']):.2f} (Bank Transaction)")
                        n += 1

        if remarks_lines:
            auto_block = "\n".join(remarks_lines)
            existing = claim.get("remarks") or ""
            sentinel_re = re.compile(r"<!-- AUTO -->.*?<!-- /AUTO -->", re.DOTALL)
            new_block = f"<!-- AUTO -->\n{auto_block}\n<!-- /AUTO -->"
            new_remarks = sentinel_re.sub(new_block, existing) if sentinel_re.search(existing) else (existing + "\n\n" + new_block).strip()
            db.table("claims").update({"remarks": new_remarks}).eq("id", claim_id).execute()

    except Exception as e:
        logger.exception("Document generation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"Document generation failed: {e}")

    db.table("claims").update({"status": "docs_generated", "error_message": None}).eq("id", claim_id).execute()

    # Auto-compile (screenshot must already be present for this to succeed)
    try:
        compile_result = _do_compile(claim_id, claim["reference_code"], db)
        return {"success": True, "documents": generated, "claim_status": "compiled", "page_count": compile_result["page_count"]}
    except ValueError:
        return {"success": True, "documents": generated, "claim_status": "docs_generated"}
    except Exception as e:
        logger.exception("Auto-compile failed for claim %s: %s", claim_id, e)
        return {"success": True, "documents": generated, "claim_status": "docs_generated"}


@router.post("/generate/{claim_id}")
async def generate_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Generate LOA, Summary, RFP (and optionally Transport) PDFs for a claim."""
    claim = _get_full_claim(claim_id, db)
    blocked = {"draft"}
    if claim.get("status") in blocked:
        raise HTTPException(400, f"Cannot generate documents for a draft claim.")
    return _do_generate(claim_id, db)


@router.post("/compile/{claim_id}")
async def compile_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Merge all current documents into a single compiled PDF."""
    claim = _get_full_claim(claim_id, db)

    if claim.get("status") not in ("docs_generated", "compiled"):
        raise HTTPException(
            400,
            f"Cannot compile claim with status '{claim.get('status')}'. Expected 'docs_generated'.",
        )

    try:
        result = _do_compile(claim_id, claim["reference_code"], db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("PDF compilation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"PDF compilation failed: {e}")

    return {"success": True, "claim_status": "compiled", "page_count": result["page_count"]}


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
        f"Screenshot - {claim['reference_code']}.pdf", claim["reference_code"], db
    )
    db.table("claims").update({"status": "screenshot_uploaded"}).eq("id", claim_id).execute()

    # Auto-generate and compile documents now that the screenshot is available
    try:
        result = _do_generate(claim_id, db)
        return {"success": True, "claim_status": result["claim_status"], "documents": result.get("documents", [])}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Auto-generation failed after screenshot upload for claim %s: %s", claim_id, e)
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


@router.post("/send-telegram")
async def send_to_telegram(
    payload: SendTelegramPayload,
    member: dict = Depends(require_auth),
    db=Depends(get_supabase),
):
    """Send compiled PDFs for the given claim IDs to the requesting user via Telegram."""
    from telegram import Bot

    telegram_id = member.get("telegram_id")
    if not telegram_id:
        raise HTTPException(400, "Your account has no Telegram ID linked.")

    bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    sent = 0
    skipped_ids: list[str] = []

    try:
        for claim_id in payload.claim_ids:
            doc_resp = (
                db.table("claim_documents")
                .select("*")
                .eq("claim_id", claim_id)
                .eq("type", "compiled")
                .eq("is_current", True)
                .execute()
            )
            docs = doc_resp.data
            if not docs:
                skipped_ids.append(claim_id)
                continue

            doc = docs[0]

            claim_resp = (
                db.table("claims")
                .select("reference_code")
                .eq("id", claim_id)
                .single()
                .execute()
            )
            reference_code = claim_resp.data["reference_code"] if claim_resp.data else claim_id

            file_bytes = r2_service.download_file(doc["drive_file_id"])
            await bot.send_document(
                chat_id=int(telegram_id),
                document=io.BytesIO(file_bytes),
                filename=f"{reference_code}.pdf",
            )
            sent += 1
    finally:
        await bot.close()

    return {"sent": sent, "skipped": len(skipped_ids), "skipped_ids": skipped_ids}


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
