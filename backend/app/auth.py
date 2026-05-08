import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException
from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.models import UserRole


def verify_telegram_init_data(init_data: str) -> dict:
    """
    Validate Telegram Mini App initData and return the decoded Telegram user.

    Telegram signs initData using HMAC-SHA256. The unsigned user ID from
    initDataUnsafe must never be trusted by the API.
    """
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing Telegram authentication")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Invalid Telegram authentication")

    data_check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(
        b"WebAppData",
        settings.TELEGRAM_BOT_TOKEN.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram authentication")

    max_age = settings.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS
    if max_age > 0:
        try:
            auth_date = int(pairs.get("auth_date", "0"))
        except ValueError:
            auth_date = 0
        if not auth_date or time.time() - auth_date > max_age:
            raise HTTPException(status_code=401, detail="Telegram session expired")

    try:
        user = json.loads(pairs.get("user", "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=401, detail="Invalid Telegram user") from exc

    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid Telegram user")
    return user


async def require_telegram_user(
    init_data: str = Header(..., alias="X-Telegram-Init-Data"),
) -> dict:
    """Return the verified Telegram user from signed Mini App initData."""
    return verify_telegram_init_data(init_data)


async def require_auth(
    telegram_user: dict = Depends(require_telegram_user),
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
        .eq("telegram_id", int(telegram_user["id"]))
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


def get_claim_for_member(
    db: Client,
    claim_id: str,
    member: dict,
    *,
    require_treasurer_draft: bool = False,
) -> dict:
    """
    Fetch a non-deleted claim and enforce role-based claim visibility.

    Finance members/directors can access all claims. Treasurers can only access
    claims they created (`filled_by`). If `require_treasurer_draft` is true,
    treasurers can only mutate their own draft claims.
    """
    resp = (
        db.table("claims")
        .select("*")
        .eq("id", claim_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    claim = resp.data[0]
    if member.get("role") == UserRole.TREASURER:
        if str(claim.get("filled_by")) != str(member.get("id")):
            raise HTTPException(status_code=403, detail="Access denied")
        if require_treasurer_draft and claim.get("status") != "draft":
            raise HTTPException(status_code=403, detail="This claim can no longer be edited")

    return claim


def assert_finance_team(member: dict) -> None:
    if member.get("role") == UserRole.TREASURER:
        raise HTTPException(status_code=403, detail="Finance team access required")
