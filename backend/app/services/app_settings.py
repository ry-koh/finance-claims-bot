from datetime import datetime, timezone


DOCUMENT_FD_SETTING_KEYS = {
    "name": "document_fd_name",
    "phone": "document_fd_phone",
    "matric_no": "document_fd_matric_no",
    "email": "document_fd_email",
    "salutation": "document_fd_salutation",
}


def get_setting(db, key: str, default: str = "") -> str:
    try:
        resp = db.table("app_settings").select("value").eq("key", key).single().execute()
        return (resp.data or {}).get("value") or default
    except Exception:
        return default


def upsert_setting(db, key: str, value: str) -> None:
    db.table("app_settings").upsert(
        {
            "key": key,
            "value": value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="key",
    ).execute()


def upsert_settings(db, values: dict[str, str]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    rows = [{"key": key, "value": value or "", "updated_at": now} for key, value in values.items()]
    if rows:
        db.table("app_settings").upsert(rows, on_conflict="key").execute()


def _get_director_fallback(db) -> dict:
    try:
        resp = (
            db.table("finance_team")
            .select("name,email,matric_number,phone_number")
            .eq("role", "director")
            .limit(1)
            .execute()
        )
        fd = resp.data[0] if resp.data else {}
    except Exception:
        fd = {}
    return {
        "name": fd.get("name") or "",
        "phone": fd.get("phone_number") or "",
        "matric_no": fd.get("matric_number") or "",
        "email": fd.get("email") or "",
        "salutation": "",
    }


def get_document_finance_director(db) -> dict:
    fallback = _get_director_fallback(db)
    profile = {}
    for field, key in DOCUMENT_FD_SETTING_KEYS.items():
        profile[field] = get_setting(db, key, fallback.get(field, ""))

    if not profile.get("salutation"):
        profile["salutation"] = profile.get("name") or fallback.get("name") or "Finance Director"
    return profile
