from fastapi import Depends, Header, HTTPException
from supabase import Client

from app.database import get_supabase
from app.models import UserRole


async def require_auth(
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
) -> dict:
    """
    Validates the Telegram user ID against the finance_team table.
    Returns the member row as a dict.
    Raises 401 if unregistered, 403 if pending approval.
    """
    response = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=401, detail="unregistered")
    member = response.data[0]
    if member.get("status") == "pending":
        raise HTTPException(status_code=403, detail="pending")
    return member


async def require_finance_team(
    member: dict = Depends(require_auth),
) -> dict:
    """
    Requires the authenticated user to be a finance member or director.
    Treasurers are rejected with 403.
    """
    if member.get("role") == UserRole.TREASURER:
        raise HTTPException(status_code=403, detail="Finance team access required")
    return member


async def require_director(
    member: dict = Depends(require_auth),
) -> dict:
    """
    Requires the authenticated user to have the 'director' role.
    """
    if member.get("role") != UserRole.DIRECTOR:
        raise HTTPException(status_code=403, detail="Access denied: director role required")
    return member
