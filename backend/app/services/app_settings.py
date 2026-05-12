from datetime import datetime, timezone


DOCUMENT_FD_SETTING_KEYS = {
    "name": "document_fd_name",
    "phone": "document_fd_phone",
    "matric_no": "document_fd_matric_no",
    "email": "document_fd_email",
    "salutation": "document_fd_salutation",
}

CLAIM_EMAIL_SETTING_KEYS = {
    "to_email": "claim_submission_to_email",
    "cc_email": "claim_submission_cc_email",
}

TESTING_MODE_SETTING_KEYS = {
    "enabled": "testing_mode_enabled",
    "message": "testing_mode_message",
}

DEFAULT_CLAIM_TO_EMAIL = "rh.finance@u.nus.edu"
DEFAULT_CLAIM_CC_EMAIL = "68findirector.rh@gmail.com"
DEFAULT_TESTING_MODE_MESSAGE = (
    "The finance claims app is temporarily down for testing. Please check back later."
)


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
    profile["personal_email"] = profile.get("email") or ""
    return profile


def get_claim_email_settings(db) -> dict:
    return {
        "to_email": get_setting(
            db,
            CLAIM_EMAIL_SETTING_KEYS["to_email"],
            DEFAULT_CLAIM_TO_EMAIL,
        ),
        "cc_email": get_setting(
            db,
            CLAIM_EMAIL_SETTING_KEYS["cc_email"],
            DEFAULT_CLAIM_CC_EMAIL,
        ),
    }


def get_testing_mode(db) -> dict:
    enabled = get_setting(db, TESTING_MODE_SETTING_KEYS["enabled"], "false").lower() == "true"
    message = get_setting(
        db,
        TESTING_MODE_SETTING_KEYS["message"],
        DEFAULT_TESTING_MODE_MESSAGE,
    ).strip() or DEFAULT_TESTING_MODE_MESSAGE
    return {"enabled": enabled, "message": message}


def set_testing_mode(db, enabled: bool, message: str | None = None) -> None:
    values = {TESTING_MODE_SETTING_KEYS["enabled"]: "true" if enabled else "false"}
    if message is not None:
        values[TESTING_MODE_SETTING_KEYS["message"]] = message.strip() or DEFAULT_TESTING_MODE_MESSAGE
    upsert_settings(db, values)
