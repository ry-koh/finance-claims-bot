import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional
from app.database import get_supabase
from app.auth import get_claim_for_member, require_auth, require_finance_team
from app.services import r2 as r2_service
from app.services.events import log_claim_event
from app.services.storage import insert_file_row
from app.config import settings
from app.utils.rate_limit import guard
from telegram import Bot
from telegram.request import HTTPXRequest
import io, tempfile, os, time, logging, re

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)

_gen_executor = ThreadPoolExecutor(max_workers=settings.DOCGEN_MAX_WORKERS, thread_name_prefix="docgen")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TransportTrip(BaseModel):
    from_location: str
    to_location: str
    purpose: str
    date: Optional[str] = None   # YYYY-MM-DD
    time: Optional[str] = None   # HH:MM
    distance_km: Optional[float] = None
    mode: Optional[str] = None
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
        "*, claimer:finance_team!claims_claimer_id_fkey(id, name, email, matric_number, phone_number), "
        "cca:ccas(name, portfolio:portfolios(name)), "
        "line_items:claim_line_items(*, receipts(*))"
    ).eq("id", claim_id).is_("deleted_at", "null").single().execute()
    if not result.data:
        raise HTTPException(404, "Claim not found")
    claim = result.data
    # Normalize claimer to the shape expected by pdf/gmail services:
    # {name, matric_no, phone, email, cca: {name, portfolio: {name}}}
    raw_claimer = claim.get("claimer") or {}
    claim["claimer"] = {
        "name": claim.get("one_off_name") or raw_claimer.get("name") or "",
        "matric_no": claim.get("one_off_matric_no") or raw_claimer.get("matric_number") or "",
        "phone": claim.get("one_off_phone") or raw_claimer.get("phone_number") or "",
        "email": claim.get("one_off_email") or raw_claimer.get("email") or "",
        "cca": claim.get("cca") or {},
    }
    return claim


def _get_finance_director(db) -> dict:
    result = (
        db.table("finance_team")
        .select("name,email,matric_number,phone_number")
        .eq("role", "director")
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(500, "No Finance Director configured — update profile in Settings")
    fd = result.data[0]
    return {
        "name": fd.get("name") or "",
        "matric_no": fd.get("matric_number") or "",
        "phone": fd.get("phone_number") or "",
        "email": fd.get("email") or "",
    }


def _download_doc(drive_file_id: str) -> bytes:
    """Download a claim document from R2 (path contains '/') or Drive."""
    if '/' in drive_file_id:
        return r2_service.download_file(drive_file_id)
    from app.services import pdf as pdf_service
    return pdf_service.download_drive_file(drive_file_id)


def _get_claim_folder(reference_code: str) -> str:
    """Get or create a Drive subfolder named after the claim reference code."""
    from app.services import pdf as pdf_service
    return pdf_service.get_or_create_drive_folder(reference_code, settings.GOOGLE_DRIVE_PARENT_FOLDER_ID)


def _save_document(claim_id: str, doc_type: str, pdf_bytes: bytes, filename: str, reference_code: str, db, folder_id: str = None) -> str:
    from app.services import pdf as pdf_service
    drive_file_id = pdf_service.upload_to_drive(pdf_bytes, filename, folder_id or settings.GOOGLE_DRIVE_PARENT_FOLDER_ID)
    db.table("claim_documents").update({"is_current": False}).eq("claim_id", claim_id).eq("type", doc_type).eq("is_current", True).execute()
    insert_file_row(db, "claim_documents", {
        "claim_id": claim_id,
        "type": doc_type,
        "drive_file_id": drive_file_id,
        "is_current": True,
        "file_size_bytes": len(pdf_bytes),
    })
    return drive_file_id


def _do_compile(claim_id: str, reference_code: str, db) -> dict:
    """Merge all current documents into a compiled PDF. Returns page_count."""
    from pypdf import PdfWriter, PdfReader  # lazy import — pypdf is heavy

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
        file_bytes = _download_doc(docs_by_type[doc_type]["drive_file_id"])
        reader = PdfReader(io.BytesIO(file_bytes))
        for page in reader.pages:
            writer.add_page(page)
            total_pages += 1

    output = io.BytesIO()
    writer.write(output)
    compiled_bytes = output.getvalue()

    folder_id = _get_claim_folder(reference_code)
    _save_document(claim_id, "compiled", compiled_bytes, f"Compiled - {reference_code}.pdf", reference_code, db, folder_id=folder_id)
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
    from app.services import pdf as pdf_service  # lazy import — fpdf/google-api-client heavy
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
    claim_folder_id = _get_claim_folder(base_code)

    try:
        for half_idx, (half_items, suffix) in enumerate(halves):
            ref_code = base_code + suffix
            is_first_half = (half_idx == 0)

            half_receipt_ids = {r["id"] for item in half_items for r in item.get("receipts", [])}
            half_receipts = [r for r in all_receipts if r["id"] in half_receipt_ids]
            half_bts = [bt for bt in bank_transactions if _bt_in_half(bt, all_receipts, half_receipt_ids, is_first_half)]

            mf_ids = claim.get("mf_approval_drive_ids") or ([claim["mf_approval_drive_id"]] if claim.get("mf_approval_drive_id") else [])
            loa_bytes = pdf_service.generate_loa(claim, half_receipts, half_bts, reference_code_override=ref_code, mf_approval_drive_ids=mf_ids)
            doc_key = f"loa{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, doc_key, loa_bytes, f"LOA - {ref_code}.pdf", ref_code, db, folder_id=claim_folder_id)
            generated.append(doc_key)
            time.sleep(0.02)  # yield CPU between heavy operations

            summary_bytes = pdf_service.generate_summary(claim, half_items, finance_director, reference_code_override=ref_code)
            summary_key = f"summary{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, summary_key, summary_bytes, f"Summary - {ref_code}.pdf", ref_code, db, folder_id=claim_folder_id)
            generated.append(summary_key)
            time.sleep(0.02)

            rfp_bytes = pdf_service.generate_rfp(claim, half_items, finance_director, reference_code_override=ref_code)
            rfp_key = f"rfp{'_' + suffix.lower() if suffix else ''}"
            _save_document(claim_id, rfp_key, rfp_bytes, f"RFP - {ref_code}.pdf", ref_code, db, folder_id=claim_folder_id)
            generated.append(rfp_key)
            time.sleep(0.02)

        if claim.get("transport_form_needed") and claim.get("transport_data"):
            transport_bytes = pdf_service.generate_transport(claim, claim["transport_data"], finance_director)
            _save_document(claim_id, "transport", transport_bytes, f"Transport - {base_code}.pdf", base_code, db, folder_id=claim_folder_id)
            generated.append("transport")

        # Auto-generate remarks (all lines use "- " prefix per spec)
        auto_remarks: list[str] = []

        # MF line is always first in the AUTO block
        if claim.get("wbs_account") == "MF":
            auto_remarks.append("- Claimed from Master Fund")

        if claim.get("is_partial"):
            partial_lines = [
                f"- {r.get('description') or 'Receipt'}: ${float(r['claimed_amount']):.2f} claimed of ${float(r['amount']):.2f} paid"
                for r in all_receipts if r.get("claimed_amount") is not None
            ]
            if partial_lines:
                auto_remarks.extend(partial_lines)
            else:
                auto_remarks.append("- Partial Claim")

        for bt in bank_transactions:
            if bt.get("refunds"):
                refund_amounts = [float(r["amount"]) for r in bt["refunds"]]
                net = float(bt["amount"]) - sum(refund_amounts)
                for amt in refund_amounts:
                    auto_remarks.append(f"- An item was refunded and the amount refunded is ${amt:.2f}")
                auto_remarks.append(f"- Initial Bank Transaction is ${float(bt['amount']):.2f}")
                formula = " - ".join([f"${float(bt['amount']):.2f}"] + [f"${a:.2f}" for a in refund_amounts])
                auto_remarks.append(f"- Total Amount is {formula} = ${net:.2f}")

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
                        auto_remarks.append(f"- Bank Transaction shows ${float(bt['amount']):.2f} as it includes {other_str} as well")
                        auto_remarks.append(f"- {calc_str} = ${float(bt['amount']):.2f} (Bank Transaction)")

        # Counts of receipts and bank transactions attached
        receipt_count = len(all_receipts)
        bt_count = len(bank_transactions)
        if receipt_count:
            auto_remarks.append(f"- {receipt_count} Receipt{'s' if receipt_count != 1 else ''} Attached")
        if bt_count:
            auto_remarks.append(f"- {bt_count} Bank Transaction{'s' if bt_count != 1 else ''} Attached")

        # Always update remarks block (even if empty, to clear stale sentinels)
        auto_block = "\n".join(auto_remarks)
        existing = claim.get("remarks") or ""
        # Strip AUTO block including surrounding newlines so appended remarks don't create blank lines
        sentinel_re = re.compile(r"\n?<!-- AUTO -->.*?<!-- /AUTO -->\n?", re.DOTALL)
        new_block = f"<!-- AUTO -->\n{auto_block}\n<!-- /AUTO -->"
        # Strip old sentinel (with surrounding newlines) and legacy MF line to get clean user-written portion
        user_portion = sentinel_re.sub("\n", existing).strip()
        user_portion = re.sub(r'\n{2,}', '\n', user_portion)
        mf_line = "- Claimed from Master Fund"
        if user_portion.startswith(mf_line):
            user_portion = user_portion[len(mf_line):].strip()
        new_remarks = (user_portion + "\n" + new_block).strip() if user_portion else new_block
        db.table("claims").update({"remarks": new_remarks}).eq("id", claim_id).execute()

    except Exception as e:
        logger.exception("Document generation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"Document generation failed: {e}")

    # Determine fallback status based on whether a screenshot already exists
    screenshot_check = db.table("claim_documents").select("id").eq("claim_id", claim_id).eq("type", "email_screenshot").eq("is_current", True).execute()
    fallback_status = "screenshot_uploaded" if screenshot_check.data else "docs_generated"
    db.table("claims").update({"status": fallback_status, "error_message": None}).eq("id", claim_id).execute()

    # Auto-compile (screenshot must already be present for this to succeed)
    try:
        compile_result = _do_compile(claim_id, claim["reference_code"], db)
        return {"success": True, "documents": generated, "claim_status": "compiled", "page_count": compile_result["page_count"]}
    except ValueError:
        return {"success": True, "documents": generated, "claim_status": fallback_status}
    except Exception as e:
        logger.exception("Auto-compile failed for claim %s: %s", claim_id, e)
        return {"success": True, "documents": generated, "claim_status": fallback_status}


def _do_screenshot_and_generate(claim_id: str, files_data: list, db) -> None:
    """
    Sync: process screenshot images, save to Drive, then compile or generate docs.
    Runs in _gen_executor so it never blocks the event loop.
    All errors update the claim status to 'error'.
    """
    from PIL import Image as PILImage
    from fpdf import FPDF
    from app.services import image as image_service
    import gc

    A4_W, A4_H = 210.0, 297.0
    MARGIN = 5.0
    avail_w = A4_W - 2 * MARGIN
    avail_h = A4_H - 2 * MARGIN

    try:
        claim = _get_full_claim(claim_id, db)
        pdf = FPDF(orientation='P', unit='mm', format='A4')
        pdf.set_auto_page_break(False)

        tmp_paths = []
        try:
            for raw_bytes, content_type, filename in files_data:
                try:
                    processed = image_service.process_receipt_image(raw_bytes, content_type, filename)
                except Exception as e:
                    raise ValueError(f"Image processing failed: {e}")

                img_info = PILImage.open(io.BytesIO(processed))
                img_w, img_h = img_info.size
                img_info.close()

                scale = min(avail_w / img_w, avail_h / img_h)
                render_w = img_w * scale
                render_h = img_h * scale
                x_pos = (A4_W - render_w) / 2
                y_pos = (A4_H - render_h) / 2

                pdf.add_page()
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                    tmp.write(processed)
                    tmp_paths.append(tmp.name)
                del processed
                pdf.image(tmp_paths[-1], x=x_pos, y=y_pos, w=render_w, h=render_h)
        finally:
            for p in tmp_paths:
                try:
                    os.unlink(p)
                except OSError:
                    pass

        screenshot_pdf_bytes = bytes(pdf.output())
        del pdf
        gc.collect()

        claim_folder_id = _get_claim_folder(claim["reference_code"])
        _save_document(
            claim_id, "email_screenshot", screenshot_pdf_bytes,
            f"Screenshot - {claim['reference_code']}.pdf", claim["reference_code"], db,
            folder_id=claim_folder_id,
        )
        del screenshot_pdf_bytes
        db.table("claims").update({"status": "screenshot_uploaded"}).eq("id", claim_id).execute()

        # Check if docs already exist
        existing_docs = db.table("claim_documents").select("type").eq("claim_id", claim_id).eq("is_current", True).execute()
        existing_types = {d["type"] for d in (existing_docs.data or [])}
        docs_already_generated = any(t == "loa" or t.startswith("loa_") for t in existing_types)

        if docs_already_generated:
            try:
                result = _do_compile(claim_id, claim["reference_code"], db)
                return {"success": True, "claim_status": "compiled", "page_count": result["page_count"]}
            except Exception as e:
                logger.warning("Compile after screenshot upload failed for claim %s: %s", claim_id, e)
                return {"success": True, "claim_status": "screenshot_uploaded"}
        else:
            return _do_generate(claim_id, db)

    except Exception as e:
        logger.exception("Screenshot + generation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise


def _do_generate_in_thread(claim_id: str) -> None:
    """Thread-safe wrapper: creates its own DB client so it never shares connections with the request thread."""
    try:
        os.nice(10)  # lower CPU priority so the event loop stays responsive (Linux/Cloud Run)
    except (AttributeError, OSError):
        pass
    from app.database import get_supabase
    db = get_supabase()
    try:
        return _do_generate(claim_id, db)
    except Exception as e:
        logger.exception("Generation thread failed for claim %s: %s", claim_id, e)
        try:
            db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        except Exception:
            pass
        raise


def _do_screenshot_in_thread(claim_id: str, files_data: list) -> None:
    """Thread-safe wrapper for screenshot + generation pipeline."""
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    from app.database import get_supabase
    db = get_supabase()
    return _do_screenshot_and_generate(claim_id, files_data, db)


@router.post("/generate/{claim_id}")
async def generate_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_finance_team),
):
    """Run document generation in the one-worker executor while the request stays open."""
    guard(f"generate:{claim_id}", max_calls=2, window_seconds=15)
    claim = _get_full_claim(claim_id, db)
    blocked = {"draft", "pending_review"}
    if claim.get("status") in blocked:
        raise HTTPException(400, f"Cannot generate documents for a claim with status '{claim.get('status')}'.")

    lock = db.rpc("claim_start_generation", {"p_claim_id": claim_id}).execute()
    if not lock.data:
        raise HTTPException(409, "Document generation is already in progress for this claim.")

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_gen_executor, _do_generate_in_thread, claim_id)
    log_claim_event(
        db,
        claim_id,
        _auth.get("id"),
        "documents_generated",
        "Documents generated",
        {"documents": result.get("documents", []), "claim_status": result.get("claim_status")},
    )
    if result.get("claim_status") == "compiled":
        log_claim_event(
            db,
            claim_id,
            _auth.get("id"),
            "documents_compiled",
            "Compiled PDF generated",
            {"page_count": result.get("page_count")},
        )
    return result


@router.post("/compile/{claim_id}")
def compile_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_finance_team),
):
    """Merge all current documents into a single compiled PDF."""
    guard(f"compile:{claim_id}", max_calls=2, window_seconds=15)
    claim = _get_full_claim(claim_id, db)

    if claim.get("status") not in ("docs_generated", "screenshot_uploaded", "compiled"):
        raise HTTPException(
            400,
            f"Cannot compile claim with status '{claim.get('status')}'. Expected 'docs_generated' or 'screenshot_uploaded'.",
        )

    try:
        result = _do_compile(claim_id, claim["reference_code"], db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("PDF compilation failed for claim %s: %s", claim_id, e)
        db.table("claims").update({"status": "error", "error_message": str(e)}).eq("id", claim_id).execute()
        raise HTTPException(500, f"PDF compilation failed: {e}")

    log_claim_event(
        db,
        claim_id,
        _auth.get("id"),
        "documents_compiled",
        "Compiled PDF generated",
        {"page_count": result["page_count"]},
    )
    return {"success": True, "claim_status": "compiled", "page_count": result["page_count"]}


@router.post("/upload-screenshot/{claim_id}")
async def upload_screenshot(
    claim_id: str,
    files: list[UploadFile] = File(...),
    db=Depends(get_supabase),
    _auth=Depends(require_finance_team),
):
    """Upload screenshot(s), save as PDF, then generate/compile docs in the one-worker executor."""
    # Read all bytes while still in async context
    files_data = []
    total_bytes = 0
    for file in files:
        raw = await file.read()
        if len(raw) > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File is too large. Maximum upload size is {settings.MAX_UPLOAD_BYTES // 1_000_000} MB.",
            )
        total_bytes += len(raw)
        if total_bytes > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Combined upload is too large. Maximum total upload size is {settings.MAX_UPLOAD_BYTES // 1_000_000} MB.",
            )
        files_data.append((raw, file.content_type or "", file.filename or ""))

    # Acquire generation lock
    lock = db.rpc("claim_start_generation", {"p_claim_id": claim_id}).execute()
    if not lock.data:
        raise HTTPException(409, "Processing already in progress for this claim.")

    # Keep this request open so Cloud Run keeps CPU allocated for the worker.
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_gen_executor, _do_screenshot_in_thread, claim_id, files_data)
    log_claim_event(
        db,
        claim_id,
        _auth.get("id"),
        "email_screenshot_uploaded",
        "Email screenshot uploaded",
        {"file_count": len(files_data), "claim_status": result.get("claim_status")},
    )
    if result.get("claim_status") == "compiled":
        log_claim_event(
            db,
            claim_id,
            _auth.get("id"),
            "documents_compiled",
            "Compiled PDF generated",
            {"page_count": result.get("page_count")},
        )
    return result


@router.post("/transport-data/{claim_id}")
async def save_transport_data(
    claim_id: str,
    data: TransportData,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """Save transport trip data to the claim record."""
    get_claim_for_member(db, claim_id, _auth, require_treasurer_draft=True)
    db.table("claims").update({"transport_data": data.model_dump()}).eq("id", claim_id).execute()
    return {"success": True}


@router.post("/mf-approval/{claim_id}")
async def upload_mf_approval(
    claim_id: str,
    file: UploadFile = File(...),
    db=Depends(get_supabase),
    _auth=Depends(require_finance_team),
):
    """Upload Master's Fund approval screenshot for a claim."""
    from app.services import image as image_service
    raw_bytes = await file.read()
    try:
        processed = image_service.process_receipt_image(raw_bytes, file.content_type, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image processing failed: {e}")

    claim = _get_full_claim(claim_id, db)
    from datetime import datetime as _dt
    timestamp = _dt.now().strftime("%Y%m%d_%H%M%S_%f")
    object_name = f"mf_approval/{claim_id}_{timestamp}.jpg"
    drive_file_id = r2_service.upload_file(processed, object_name, "image/jpeg")

    # Append to the array column; also keep legacy single-ID column as first entry
    existing = claim.get("mf_approval_drive_ids") or []
    new_ids = existing + [drive_file_id]
    db.table("claims").update({
        "mf_approval_drive_id": new_ids[0],
        "mf_approval_drive_ids": new_ids,
    }).eq("id", claim_id).execute()
    log_claim_event(db, claim_id, _auth.get("id"), "mf_approval_uploaded", "Master Fund approval uploaded")
    return {"success": True, "drive_file_id": drive_file_id}


@router.post("/send-telegram")
async def send_to_telegram(
    payload: SendTelegramPayload,
    member: dict = Depends(require_finance_team),
    db=Depends(get_supabase),
):
    """Send compiled PDFs for the given claim IDs to the requesting user via Telegram."""
    telegram_id = member.get("telegram_id")
    if not telegram_id:
        raise HTTPException(400, "Your account has no Telegram ID linked.")

    bot = Bot(
        token=settings.TELEGRAM_BOT_TOKEN,
        request=HTTPXRequest(connect_timeout=30, read_timeout=300, write_timeout=300),
    )
    sent = 0
    skipped_ids: list[str] = []

    try:
        for claim_id in payload.claim_ids:
            try:
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
                if not claim_resp.data:
                    skipped_ids.append(claim_id)
                    continue
                reference_code = claim_resp.data["reference_code"]

                file_bytes = _download_doc(doc["drive_file_id"])
                await bot.send_document(
                    chat_id=int(telegram_id),
                    document=io.BytesIO(file_bytes),
                    filename=f"{reference_code}.pdf",
                )
                sent += 1
            except Exception as e:
                logger.warning("Failed to send Telegram document for claim %s: %s", claim_id, e)
                skipped_ids.append(claim_id)
    finally:
        try:
            await bot.close()
        except Exception:
            pass

    return {"sent": sent, "skipped": len(skipped_ids), "skipped_ids": skipped_ids}


@router.get("/{claim_id}")
async def list_documents(
    claim_id: str,
    db=Depends(get_supabase),
    _auth=Depends(require_auth),
):
    """List all current documents for a claim."""
    get_claim_for_member(db, claim_id, _auth)
    result = (
        db.table("claim_documents")
        .select("*")
        .eq("claim_id", claim_id)
        .eq("is_current", True)
        .order("created_at")
        .execute()
    )
    return result.data
