from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.auth import require_auth
from app.database import get_supabase
from app.routers.bot import send_bot_notification

router = APIRouter(prefix="/messages", tags=["messages"])


class SendMessageRequest(BaseModel):
    telegram_id: int
    message: str


@router.get("/treasurers")
async def list_treasurers(
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return all active treasurers with their CCAs. Accessible to all finance team members."""
    if _member.get("role") == "treasurer":
        raise HTTPException(status_code=403, detail="Treasurers cannot use this endpoint")

    resp = (
        db.table("finance_team")
        .select("id, name, email, telegram_id, telegram_username, role")
        .eq("status", "active")
        .eq("role", "treasurer")
        .order("name")
        .execute()
    )
    members = resp.data or []

    if members:
        member_ids = [m["id"] for m in members]
        cca_links = (
            db.table("treasurer_ccas")
            .select("finance_team_id, ccas(id, name)")
            .in_("finance_team_id", member_ids)
            .execute()
        )
        ccas_by_member: dict = {}
        for row in (cca_links.data or []):
            mid = row["finance_team_id"]
            ccas_by_member.setdefault(mid, [])
            if row.get("ccas"):
                ccas_by_member[mid].append(row["ccas"])
        for m in members:
            m["ccas"] = ccas_by_member.get(m["id"], [])

    return members


@router.post("/send")
async def send_message(
    payload: SendMessageRequest,
    sender: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Send a message to a treasurer via the Telegram bot."""
    if sender.get("role") == "treasurer":
        raise HTTPException(status_code=403, detail="Treasurers cannot send messages via this endpoint")
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    # Verify target is an active treasurer
    target_resp = (
        db.table("finance_team")
        .select("id, name, role, status")
        .eq("telegram_id", payload.telegram_id)
        .execute()
    )
    if not target_resp.data:
        raise HTTPException(status_code=404, detail="Treasurer not found")
    target = target_resp.data[0]
    if target.get("role") != "treasurer" or target.get("status") != "active":
        raise HTTPException(status_code=400, detail="Target is not an active treasurer")

    sender_name = sender.get("name", "Finance Team")
    text = f"\U0001f4ac Message from {sender_name}:\n\n{payload.message.strip()}"

    await send_bot_notification(payload.telegram_id, text)
    return {"sent": True}
