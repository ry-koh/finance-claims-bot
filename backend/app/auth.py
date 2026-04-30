from fastapi import Depends, Header, HTTPException
from supabase import Client

from app.database import get_supabase


async def require_auth(
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
) -> dict:
    """
    FastAPI dependency that validates the Telegram user ID against the
    finance_team table and returns the matching member row as a dict.
    Raises HTTP 403 if the user is not found.
    """
    response = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=403, detail="Access denied")
    return response.data[0]


async def require_director(
    member: dict = Depends(require_auth),
) -> dict:
    """
    FastAPI dependency that additionally requires the authenticated user to
    have the 'director' role.  Raises HTTP 403 otherwise.
    """
    if member.get("role") != "director":
        raise HTTPException(status_code=403, detail="Access denied: director role required")
    return member
