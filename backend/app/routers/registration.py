import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.auth import require_telegram_user
from app.database import get_supabase
from app.routers.bot import send_bot_notification

router = APIRouter(tags=["registration"])


class RegisterRequest(BaseModel):
    name: str
    email: str
    role: str          # "member" or "treasurer"
    cca_ids: list[str] = []
    telegram_username: str = ''
    matric_number: str = ''
    phone_number: str = ''


def _role_label(role: str) -> str:
    if role == "treasurer":
        return "CCA Treasurer"
    if role == "member":
        return "Finance Team Member"
    return role.title()


def _notify_directors_pending_registration(db: Client, member: dict, cca_names: list[str]) -> None:
    try:
        directors_resp = (
            db.table("finance_team")
            .select("telegram_id, status")
            .eq("role", "director")
            .execute()
        )
    except Exception:
        return

    telegram_ids = {
        director.get("telegram_id")
        for director in (directors_resp.data or [])
        if director.get("telegram_id") and director.get("status") != "pending"
    }
    if not telegram_ids:
        return

    lines = [
        "New registration pending approval.",
        "",
        f"Name: {member.get('name') or '-'}",
        f"Role: {_role_label(member.get('role') or '')}",
        f"Email: {member.get('email') or '-'}",
    ]
    if member.get("telegram_username"):
        lines.append(f"Telegram: @{member['telegram_username']}")
    if member.get("matric_number"):
        lines.append(f"Matric: {member['matric_number']}")
    if member.get("phone_number"):
        lines.append(f"Phone: {member['phone_number']}")
    if cca_names:
        lines.append(f"CCA: {', '.join(cca_names)}")
    lines.extend(["", "Open the Claims App > Approvals to review."])

    message = "\n".join(lines)
    for telegram_id in telegram_ids:
        asyncio.create_task(send_bot_notification(telegram_id, message))


@router.get("/me")
async def get_me(
    telegram_user: dict = Depends(require_telegram_user),
    db: Client = Depends(get_supabase),
):
    """
    Returns current user status and data. Always HTTP 200.
    {"status": "unregistered"} if not in DB.
    {...member, "status": "pending", "ccas": [...]} if pending treasurer.
    {...member, "ccas": [...]} if active treasurer.
    {...member} if active member/director.
    """
    tg_id = int(telegram_user["id"])

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
    telegram_user: dict = Depends(require_telegram_user),
    db: Client = Depends(get_supabase),
):
    """Create a pending finance_team registration."""
    tg_id = int(telegram_user["id"])

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

    cca_names: list[str] = []
    if payload.role == "treasurer":
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member["id"], "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()
        try:
            cca_resp = db.table("ccas").select("name").in_("id", payload.cca_ids).execute()
            cca_names = [row["name"] for row in (cca_resp.data or []) if row.get("name")]
        except Exception:
            cca_names = []

    _notify_directors_pending_registration(db, member, cca_names)

    return member


@router.put("/register")
async def update_registration(
    payload: RegisterRequest,
    telegram_user: dict = Depends(require_telegram_user),
    db: Client = Depends(get_supabase),
):
    """Update a pending registration (allows editing before approval)."""
    tg_id = int(telegram_user["id"])

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
