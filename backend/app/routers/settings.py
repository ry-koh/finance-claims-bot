from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_director
from app.database import get_supabase

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    academic_year: str
    fd_name: str
    fd_phone: str
    fd_matric_no: str
    fd_email: str


class SettingsUpdate(BaseModel):
    academic_year: Optional[str] = None
    fd_name: Optional[str] = None
    fd_phone: Optional[str] = None
    fd_matric_no: Optional[str] = None
    fd_email: Optional[str] = None


@router.get("", response_model=SettingsResponse)
async def get_settings(
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    ay_resp = db.table("app_settings").select("value").eq("key", "academic_year").single().execute()
    ay = ay_resp.data["value"] if ay_resp.data else ""

    fd_resp = (
        db.table("finance_team")
        .select("name,email,matric_number,phone_number")
        .eq("role", "director")
        .limit(1)
        .execute()
    )
    fd = fd_resp.data[0] if fd_resp.data else {}

    return {
        "academic_year": ay,
        "fd_name": fd.get("name") or "",
        "fd_phone": fd.get("phone_number") or "",
        "fd_matric_no": fd.get("matric_number") or "",
        "fd_email": fd.get("email") or "",
    }


@router.patch("")
async def update_settings(
    payload: SettingsUpdate,
    director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    if payload.academic_year is not None:
        db.table("app_settings").upsert(
            {
                "key": "academic_year",
                "value": payload.academic_year,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="key",
        ).execute()

    fd_update: dict = {}
    if payload.fd_name is not None:
        fd_update["name"] = payload.fd_name
    if payload.fd_phone is not None:
        fd_update["phone_number"] = payload.fd_phone
    if payload.fd_matric_no is not None:
        fd_update["matric_number"] = payload.fd_matric_no
    if payload.fd_email is not None:
        fd_update["email"] = payload.fd_email

    if fd_update:
        db.table("finance_team").update(fd_update).eq("id", director["id"]).execute()

    return {"ok": True}
