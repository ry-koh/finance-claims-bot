import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from supabase import Client
from telegram import Bot
from telegram.request import HTTPXRequest

from app.auth import require_director
from app.config import settings
from app.database import get_supabase
from app.services.manual_rfp import ManualRfpCreate, ManualRfpUpdate, build_rfp_generation_inputs, build_rfp_update_fields
from app.services import pdf as pdf_service
from app.services.pdf import DriveAuthError
from app.services.storage import insert_file_row
from app.utils.rate_limit import guard

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rfps", tags=["rfps"])


def _drive_url(file_id: str | None) -> str | None:
    if not file_id or "/" in file_id:
        return None
    return f"https://drive.google.com/file/d/{file_id}/view"


def _format_rfp(row: dict) -> dict:
    return {**row, "drive_url": _drive_url(row.get("drive_file_id"))}


def _get_rfp_or_404(db: Client, rfp_id: str) -> dict:
    resp = db.table("manual_rfp_documents").select("*").eq("id", rfp_id).single().execute()
    if not resp.data:
        raise HTTPException(404, "RFP not found")
    return resp.data


def _stored_line_items(payload: ManualRfpCreate, generated_line_items: list[dict]) -> list[dict]:
    stored = []
    for item, generated in zip(payload.line_items, generated_line_items):
        stored.append({
            **item.model_dump(),
            "category_code": generated["category_code"],
            "amount": generated["total_amount"],
        })
    return stored


@router.get("")
async def list_manual_rfps(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    resp = (
        db.table("manual_rfp_documents")
        .select("*")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return [_format_rfp(row) for row in (resp.data or [])]


@router.post("")
async def create_manual_rfp(
    payload: ManualRfpCreate,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    guard(f"manual-rfp:create:{director['id']}", max_calls=5, window_seconds=300)
    claim, line_items, payee = build_rfp_generation_inputs(payload)

    try:
        folder_id = pdf_service.get_or_create_drive_folder("Manual RFPs", settings.GOOGLE_DRIVE_PARENT_FOLDER_ID)
        pdf_bytes = pdf_service.generate_rfp(claim, line_items, payee)
        filename = f"RFP - {claim['reference_code']}.pdf"
        drive_file_id = pdf_service.upload_to_drive(pdf_bytes, filename, folder_id)
    except DriveAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Manual RFP generation failed")
        raise HTTPException(status_code=500, detail=f"Manual RFP generation failed: {str(exc)[:300]}") from exc

    row = {
        "created_by": director["id"],
        "title": payload.title,
        "reference_code": claim["reference_code"],
        "payee_name": payload.payee_name,
        "payee_matric_no": payee["matric_no"],
        "wbs_account": payload.wbs_account,
        "wbs_no": claim["wbs_no"],
        "total_amount": claim["total_amount"],
        "line_items": _stored_line_items(payload, line_items),
        "drive_file_id": drive_file_id,
        "file_size_bytes": len(pdf_bytes),
    }
    inserted = insert_file_row(db, "manual_rfp_documents", row)
    return _format_rfp(inserted.data[0])


@router.get("/{rfp_id}/download")
async def download_manual_rfp(
    rfp_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    row = _get_rfp_or_404(db, rfp_id)

    try:
        file_bytes = pdf_service.download_drive_file(row["drive_file_id"])
    except Exception as exc:
        raise HTTPException(502, "Could not download RFP from Drive") from exc

    filename = f"RFP - {row['reference_code']}.pdf"
    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{rfp_id}/send-telegram")
async def send_manual_rfp_to_telegram(
    rfp_id: str,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    guard(f"manual-rfp:send:{director['id']}", max_calls=10, window_seconds=300)
    telegram_id = director.get("telegram_id")
    if not telegram_id:
        raise HTTPException(400, "Your account has no Telegram ID linked.")

    row = _get_rfp_or_404(db, rfp_id)
    try:
        file_bytes = pdf_service.download_drive_file(row["drive_file_id"])
        bot = Bot(
            token=settings.TELEGRAM_BOT_TOKEN,
            request=HTTPXRequest(connect_timeout=30, read_timeout=300, write_timeout=300),
        )
        try:
            await bot.send_document(
                chat_id=int(telegram_id),
                document=io.BytesIO(file_bytes),
                filename=f"RFP - {row['reference_code']}.pdf",
            )
        finally:
            await bot.close()
    except Exception as exc:
        logger.warning("Failed to send manual RFP %s to Telegram: %s", rfp_id, exc)
        raise HTTPException(502, "Failed to send RFP to Telegram") from exc

    db.table("manual_rfp_documents").update({
        "sent_to_telegram_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", rfp_id).execute()
    return {"success": True}


@router.patch("/{rfp_id}")
async def update_manual_rfp(
    rfp_id: str,
    payload: ManualRfpUpdate,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    guard(f"manual-rfp:update:{director['id']}", max_calls=30, window_seconds=300)
    _get_rfp_or_404(db, rfp_id)
    fields = build_rfp_update_fields(payload)
    if not fields:
        return _format_rfp(_get_rfp_or_404(db, rfp_id))

    resp = db.table("manual_rfp_documents").update(fields).eq("id", rfp_id).execute()
    if not resp.data:
        return _format_rfp(_get_rfp_or_404(db, rfp_id))
    return _format_rfp(resp.data[0])


@router.delete("/{rfp_id}")
async def delete_manual_rfp(
    rfp_id: str,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    guard(f"manual-rfp:delete:{director['id']}", max_calls=15, window_seconds=300)
    row = _get_rfp_or_404(db, rfp_id)

    try:
        pdf_service.delete_drive_file(row["drive_file_id"])
    except DriveAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Failed to delete manual RFP %s from Drive: %s", rfp_id, exc)
        raise HTTPException(502, "Failed to delete RFP from Drive") from exc

    db.table("manual_rfp_documents").delete().eq("id", rfp_id).execute()
    return {"success": True}
