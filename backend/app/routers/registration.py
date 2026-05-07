from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.database import get_supabase

router = APIRouter(tags=["registration"])


class RegisterRequest(BaseModel):
    name: str
    email: str
    role: str          # "member" or "treasurer"
    cca_ids: list[str] = []
    telegram_username: str = ''
    matric_number: str = ''
    phone_number: str = ''


@router.get("/me")
async def get_me(
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """
    Returns current user status and data. Always HTTP 200.
    {"status": "unregistered"} if not in DB.
    {...member, "status": "pending", "ccas": [...]} if pending treasurer.
    {...member, "ccas": [...]} if active treasurer.
    {...member} if active member/director.
    """
    try:
        tg_id = int(telegram_id)
    except ValueError:
        raise HTTPException(400, "Invalid Telegram user ID")

    response = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", tg_id)
        .execute()
    )
    if not response.data:
        return {"status": "unregistered"}

    member = response.data[0]

    # Attach CCA details for treasurers (active or pending)
    if member.get("role") == "treasurer":
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id, ccas(id, name)")
            .eq("finance_team_id", member["id"])
            .execute()
        )
        member["ccas"] = [row["ccas"] for row in (cca_links.data or []) if row.get("ccas")]

    return member


@router.post("/register")
async def register(
    payload: RegisterRequest,
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """Create a pending finance_team registration."""
    try:
        tg_id = int(telegram_id)
    except ValueError:
        raise HTTPException(400, "Invalid Telegram user ID")

    if payload.role not in ("member", "treasurer"):
        raise HTTPException(400, "role must be 'member' or 'treasurer'")
    if payload.role == "member" and not payload.email.endswith("@u.nus.edu"):
        raise HTTPException(400, "Finance members must use an @u.nus.edu email address")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must select at least one CCA")
    if payload.role == "treasurer" and not payload.matric_number.strip():
        raise HTTPException(400, "Matric number is required for treasurers")
    if payload.role == "treasurer" and not payload.phone_number.strip():
        raise HTTPException(400, "Phone number is required for treasurers")
    if not payload.name.strip():
        raise HTTPException(400, "Name is required")
    if not payload.telegram_username.strip():
        raise HTTPException(400, "Telegram username is required")

    existing = (
        db.table("finance_team")
        .select("id")
        .eq("telegram_id", tg_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, "Already registered")

    insert_data = {
        "telegram_id": tg_id,
        "name": payload.name.strip(),
        "email": payload.email.strip().lower(),
        "role": payload.role,
        "status": "pending",
    }
    if payload.telegram_username.strip():
        insert_data["telegram_username"] = payload.telegram_username.strip().lstrip('@')
    if payload.role == "treasurer":
        if payload.matric_number.strip():
            insert_data["matric_number"] = payload.matric_number.strip().upper()
        if payload.phone_number.strip():
            insert_data["phone_number"] = payload.phone_number.strip()
    result = db.table("finance_team").insert(insert_data).execute()
    member = result.data[0]

    if payload.role == "treasurer":
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member["id"], "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()

    return member


@router.put("/register")
async def update_registration(
    payload: RegisterRequest,
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """Update a pending registration (allows editing before approval)."""
    try:
        tg_id = int(telegram_id)
    except ValueError:
        raise HTTPException(400, "Invalid Telegram user ID")

    existing = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", tg_id)
        .eq("status", "pending")
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "No pending registration found")
    member = existing.data[0]

    if payload.role not in ("member", "treasurer"):
        raise HTTPException(400, "role must be 'member' or 'treasurer'")
    if payload.role == "member" and not payload.email.endswith("@u.nus.edu"):
        raise HTTPException(400, "Finance members must use an @u.nus.edu email address")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must select at least one CCA")

    update_data = {
        "name": payload.name.strip(),
        "email": payload.email.strip().lower(),
        "role": payload.role,
    }
    if payload.telegram_username.strip():
        update_data["telegram_username"] = payload.telegram_username.strip().lstrip('@')
    if payload.role == "treasurer":
        update_data["matric_number"] = payload.matric_number.strip().upper() if payload.matric_number.strip() else None
        update_data["phone_number"] = payload.phone_number.strip() if payload.phone_number.strip() else None
    db.table("finance_team").update(update_data).eq("id", member["id"]).execute()

    # Replace CCA links entirely
    db.table("treasurer_ccas").delete().eq("finance_team_id", member["id"]).execute()
    if payload.role == "treasurer" and payload.cca_ids:
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member["id"], "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()

    updated = (
        db.table("finance_team")
        .select("*")
        .eq("id", member["id"])
        .single()
        .execute()
    )
    result = updated.data
    if result.get("role") == "treasurer":
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id, ccas(id, name)")
            .eq("finance_team_id", result["id"])
            .execute()
        )
        result["ccas"] = [row["ccas"] for row in (cca_links.data or []) if row.get("ccas")]
    return result
