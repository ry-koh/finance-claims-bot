from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from app.auth import require_auth
from app.database import get_supabase
from app.models import UserRole


router = APIRouter(prefix="/payers", tags=["payers"])


class PayerCreate(BaseModel):
    owner_treasurer_id: Optional[str] = None
    name: str
    email: str


class PayerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


def _clean_name(name: Optional[str]) -> str:
    return (name or "").strip()


def _clean_email(email: Optional[str]) -> str:
    return (str(email or "")).strip().lower()


def _require_email(email: str) -> str:
    clean = _clean_email(email)
    if "@" not in clean or "." not in clean.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=422, detail="Valid payer email is required")
    return clean


def _is_finance(member: dict) -> bool:
    return member.get("role") in {UserRole.DIRECTOR.value, UserRole.MEMBER.value}


def _fetch_treasurer(db: Client, treasurer_id: str) -> dict:
    resp = (
        db.table("finance_team")
        .select("id, name, email, role, status")
        .eq("id", treasurer_id)
        .eq("role", UserRole.TREASURER.value)
        .eq("status", "active")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Treasurer not found")
    treasurer = resp.data[0]
    if not _clean_email(treasurer.get("email")):
        raise HTTPException(status_code=422, detail="Treasurer account has no email")
    return treasurer


def _resolve_owner_id(member: dict, requested_owner_id: Optional[str]) -> str:
    if member.get("role") == UserRole.TREASURER.value:
        if requested_owner_id and str(requested_owner_id) != str(member.get("id")):
            raise HTTPException(status_code=403, detail="Access denied")
        return str(member["id"])
    if not _is_finance(member):
        raise HTTPException(status_code=403, detail="Access denied")
    if not requested_owner_id:
        raise HTTPException(status_code=422, detail="treasurer_id is required")
    return str(requested_owner_id)


def _payer_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "owner_treasurer_id": row["owner_treasurer_id"],
        "name": row["name"],
        "email": row["email"],
        "is_self": False,
        "is_saved": True,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _assert_no_duplicate_email(db: Client, owner_id: str, email: str, exclude_id: Optional[str] = None) -> None:
    query = (
        db.table("treasurer_payers")
        .select("id")
        .eq("owner_treasurer_id", owner_id)
        .eq("email", email)
        .is_("deleted_at", "null")
    )
    if exclude_id:
        query = query.neq("id", exclude_id)
    resp = query.execute()
    if resp.data:
        raise HTTPException(status_code=409, detail="A saved payer with this email already exists")


@router.get("")
async def list_payers(
    treasurer_id: Optional[str] = Query(default=None),
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    owner_id = _resolve_owner_id(member, treasurer_id)
    treasurer = _fetch_treasurer(db, owner_id)
    saved_resp = (
        db.table("treasurer_payers")
        .select("*")
        .eq("owner_treasurer_id", owner_id)
        .is_("deleted_at", "null")
        .order("name")
        .execute()
    )
    self_payer = {
        "id": f"self:{owner_id}",
        "owner_treasurer_id": owner_id,
        "name": treasurer.get("name") or "CCA Treasurer",
        "email": _clean_email(treasurer.get("email")),
        "is_self": True,
        "is_saved": False,
    }
    return [self_payer] + [_payer_row(row) for row in (saved_resp.data or [])]


@router.post("")
async def create_payer(
    payload: PayerCreate,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    owner_id = _resolve_owner_id(member, payload.owner_treasurer_id)
    _fetch_treasurer(db, owner_id)
    name = _clean_name(payload.name)
    email = _require_email(payload.email)
    if not name:
        raise HTTPException(status_code=422, detail="Payer name is required")
    _assert_no_duplicate_email(db, owner_id, email)

    resp = (
        db.table("treasurer_payers")
        .insert({"owner_treasurer_id": owner_id, "name": name, "email": email})
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create payer")
    return _payer_row(resp.data[0])


@router.patch("/{payer_id}")
async def update_payer(
    payer_id: str,
    payload: PayerUpdate,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = (
        db.table("treasurer_payers")
        .select("*")
        .eq("id", payer_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Payer not found")
    row = resp.data[0]
    owner_id = str(row["owner_treasurer_id"])
    if member.get("role") == UserRole.TREASURER.value and owner_id != str(member.get("id")):
        raise HTTPException(status_code=403, detail="Access denied")
    if not _is_finance(member) and member.get("role") != UserRole.TREASURER.value:
        raise HTTPException(status_code=403, detail="Access denied")

    update_data: dict = {}
    if payload.name is not None:
        name = _clean_name(payload.name)
        if not name:
            raise HTTPException(status_code=422, detail="Payer name is required")
        update_data["name"] = name
    if payload.email is not None:
        email = _require_email(payload.email)
        _assert_no_duplicate_email(db, owner_id, email, exclude_id=payer_id)
        update_data["email"] = email
    if not update_data:
        return _payer_row(row)

    update_resp = db.table("treasurer_payers").update(update_data).eq("id", payer_id).execute()
    if not update_resp.data:
        raise HTTPException(status_code=500, detail="Failed to update payer")
    return _payer_row(update_resp.data[0])


@router.delete("/{payer_id}")
async def delete_payer(
    payer_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    resp = (
        db.table("treasurer_payers")
        .select("*")
        .eq("id", payer_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Payer not found")
    row = resp.data[0]
    owner_id = str(row["owner_treasurer_id"])
    if member.get("role") == UserRole.TREASURER.value and owner_id != str(member.get("id")):
        raise HTTPException(status_code=403, detail="Access denied")
    if not _is_finance(member) and member.get("role") != UserRole.TREASURER.value:
        raise HTTPException(status_code=403, detail="Access denied")

    deleted_at = datetime.now(timezone.utc).isoformat()
    db.table("treasurer_payers").update({"deleted_at": deleted_at}).eq("id", payer_id).execute()
    return {"deleted": True}
