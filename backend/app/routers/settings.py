from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import require_director
from app.database import get_supabase
from app.services.app_settings import (
    CLAIM_EMAIL_SETTING_KEYS,
    DOCUMENT_FD_SETTING_KEYS,
    get_claim_email_settings,
    get_document_finance_director,
    get_setting,
    upsert_setting,
    upsert_settings,
)

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    academic_year: str
    account_name: str
    account_email: str
    fd_name: str
    fd_phone: str
    fd_matric_no: str
    fd_email: str
    fd_personal_email: str
    fd_salutation: str
    claim_to_email: str
    claim_cc_email: str


class SettingsUpdate(BaseModel):
    academic_year: Optional[str] = None
    account_name: Optional[str] = None
    account_email: Optional[str] = None
    fd_name: Optional[str] = None
    fd_phone: Optional[str] = None
    fd_matric_no: Optional[str] = None
    fd_email: Optional[str] = None
    fd_personal_email: Optional[str] = None
    fd_salutation: Optional[str] = None
    claim_to_email: Optional[str] = None
    claim_cc_email: Optional[str] = None


@router.get("", response_model=SettingsResponse)
async def get_settings(
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    ay = get_setting(db, "academic_year", "")
    fd = get_document_finance_director(db)
    email_settings = get_claim_email_settings(db)

    return {
        "academic_year": ay,
        "account_name": _director.get("name") or "",
        "account_email": _director.get("email") or "",
        "fd_name": fd.get("name") or "",
        "fd_phone": fd.get("phone") or "",
        "fd_matric_no": fd.get("matric_no") or "",
        "fd_email": fd.get("email") or "",
        "fd_personal_email": fd.get("personal_email") or fd.get("email") or "",
        "fd_salutation": fd.get("salutation") or "",
        "claim_to_email": email_settings.get("to_email") or "",
        "claim_cc_email": email_settings.get("cc_email") or "",
    }


@router.patch("")
async def update_settings(
    payload: SettingsUpdate,
    director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    if payload.academic_year is not None:
        upsert_setting(db, "academic_year", payload.academic_year)

    if payload.account_name is not None:
        db.table("finance_team").update({"name": payload.account_name.strip()}).eq("id", director["id"]).execute()
    if payload.account_email is not None:
        db.table("finance_team").update({"email": payload.account_email.strip()}).eq("id", director["id"]).execute()

    fd_settings: dict[str, str] = {}
    if payload.fd_name is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["name"]] = payload.fd_name.strip()
    if payload.fd_phone is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["phone"]] = payload.fd_phone.strip()
    if payload.fd_matric_no is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["matric_no"]] = payload.fd_matric_no.strip()
    if payload.fd_email is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["email"]] = payload.fd_email.strip()
    if payload.fd_personal_email is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["email"]] = payload.fd_personal_email.strip()
    if payload.fd_salutation is not None:
        fd_settings[DOCUMENT_FD_SETTING_KEYS["salutation"]] = payload.fd_salutation.strip()

    email_settings: dict[str, str] = {}
    if payload.claim_to_email is not None:
        email_settings[CLAIM_EMAIL_SETTING_KEYS["to_email"]] = payload.claim_to_email.strip()
    if payload.claim_cc_email is not None:
        email_settings[CLAIM_EMAIL_SETTING_KEYS["cc_email"]] = payload.claim_cc_email.strip()

    upsert_settings(db, {**fd_settings, **email_settings})

    return {"ok": True}
