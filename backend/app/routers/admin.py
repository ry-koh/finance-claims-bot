import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client
from typing import Optional

from app.auth import require_auth, require_director, require_finance_team
from app.config import settings
from app.database import get_supabase
from app.routers.bot import send_bot_notification
from app.services.pdf import DriveAuthError, check_drive_credentials

router = APIRouter(prefix="/admin", tags=["admin"])


def _normalise_origin(origin: str) -> str:
    return (origin or "").strip().rstrip("/")


def _configured_cors_origins() -> list[str]:
    raw_allowed = settings.ALLOWED_ORIGINS or ""
    parts = [part.strip() for part in raw_allowed.split(",") if part.strip()]
    if "*" in parts or raw_allowed.strip() == "*":
        return ["*"]
    origins: list[str] = []
    for origin in parts:
        normalised = _normalise_origin(origin)
        if normalised and normalised not in origins:
            origins.append(normalised)
    mini_app_origin = _normalise_origin(settings.MINI_APP_URL)
    if mini_app_origin and mini_app_origin not in origins:
        origins.append(mini_app_origin)
    return origins


def _has_value(value: str | None) -> bool:
    return bool((value or "").strip())


def _drive_auth_status() -> dict:
    if not _has_value(settings.DRIVE_REFRESH_TOKEN):
        return {"status": "missing", "error": "DRIVE_REFRESH_TOKEN is not set."}
    try:
        check_drive_credentials()
        return {"status": "ok", "error": None}
    except DriveAuthError as exc:
        return {"status": "error", "error": str(exc)[:300]}
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:300]}


def _approved_treasurer_message(ccas: list[dict]) -> str:
    app_url = (settings.MINI_APP_URL or "").strip()
    cca_names = ", ".join(c.get("name", "") for c in ccas if c.get("name")) or "your assigned CCA"
    lines = [
        f"Hi, your CCA Treasurer access has been approved for {cca_names}.",
        "",
        "Quick guide for submitting claims:",
        "1. Choose the correct CCA for the claim. If you manage multiple CCAs, the app will ask which CCA each claim is for.",
        "2. Please submit within 3 days after all receipt screenshots, completed bank transactions, and proof of payment are ready. Bank transactions cannot still be pending.",
        "3. Upload the receipt screenshots together with the matching proof-of-payment or bank transaction screenshots. Please match each receipt to the corresponding bank transaction.",
        "4. Fill in the payer and reimbursement split details clearly so we know who to reimburse. If the invoice is under someone else's name, add that person's email.",
        "5. Keep the claim description short, around 5 words. For remarks, use one line per point like this: - remark",
        "6. Submit for Finance Team review, then wait for it to be approved.",
        "7. After Finance Team sends you the confirmation email, copy the email block into a new email and send it.",
        "8. If Finance Team rejects the claim, update it based on the feedback and submit it again.",
        "",
        "Things you can use in the app:",
        "- Track where each claim is at: draft, Finance Team review, email, submitted, and reimbursed.",
        "- Use treasurer notes for your own reminders, to-do items, or anything you need to remember about the claim.",
        "- Use Help if you need to ask a claim question or report an app issue.",
        "- Check SOP if you are unsure about reimbursement rules.",
    ]
    if app_url:
        lines.insert(2, f"Open the app: {app_url}")
        lines.insert(3, "")
    return "\n".join(lines)


STORAGE_SOURCES = [
    ("receipt_images", "Receipt images", "r2"),
    ("bank_transaction_images", "Bank transaction images", "r2"),
    ("bank_transaction_refunds", "Refund images", "r2"),
    ("claim_attachment_files", "Attachment files", "r2"),
    ("claim_documents", "Claim documents", "drive"),
    ("manual_rfp_documents", "Manual RFP documents", "drive"),
]


@router.get("/pending-registrations")
async def list_pending(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """List all pending registration requests (director only)."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .execute()
    )
    members = resp.data or []

    for member in members:
        if member.get("role") == "treasurer":
            cca_resp = (
                db.table("treasurer_ccas")
                .select("cca_id, ccas(id, name)")
                .eq("finance_team_id", member["id"])
                .execute()
            )
            member["ccas"] = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]

    return members


@router.get("/pending-registrations/count")
async def pending_count(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Return count of pending registrations for the badge."""
    resp = (
        db.table("finance_team")
        .select("id", count="exact")
        .eq("status", "pending")
        .execute()
    )
    return {"count": resp.count or 0}


@router.get("/system-status")
async def system_status(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Return a director-only operational snapshot without exposing secrets."""
    drive_auth = _drive_auth_status()
    db_status = "ok"
    db_error = None
    try:
        db.table("finance_team").select("count", count="exact").limit(0).execute()
    except Exception as exc:
        db_status = "error"
        db_error = str(exc)[:300]

    def safe_claims_query(builder):
        try:
            return builder.execute().data or []
        except Exception:
            return []

    stuck_generations = safe_claims_query(
        db.table("claims")
        .select("id, reference_code, status, updated_at, error_message")
        .eq("error_message", "__generating__")
        .is_("deleted_at", "null")
        .order("updated_at", desc=False)
        .limit(10)
    )
    error_claims = safe_claims_query(
        db.table("claims")
        .select("id, reference_code, status, updated_at, error_message")
        .eq("status", "error")
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .limit(10)
    )

    return {
        "status": "ok" if db_status == "ok" and drive_auth["status"] == "ok" else "degraded",
        "database": {"status": db_status, "error": db_error},
        "config": {
            "app_url_set": _has_value(settings.APP_URL),
            "mini_app_url_set": _has_value(settings.MINI_APP_URL),
            "allowed_origins": _configured_cors_origins(),
            "telegram_bot_token_set": _has_value(settings.TELEGRAM_BOT_TOKEN),
            "telegram_webhook_secret_set": _has_value(settings.telegram_webhook_secret),
            "telegram_webhook_secret_explicit": _has_value(settings.TELEGRAM_WEBHOOK_SECRET_TOKEN),
            "google_service_account_set": _has_value(settings.GOOGLE_SERVICE_ACCOUNT_JSON),
            "gmail_refresh_token_set": _has_value(settings.GMAIL_REFRESH_TOKEN),
            "drive_refresh_token_set": _has_value(settings.DRIVE_REFRESH_TOKEN),
            "drive_auth_status": drive_auth["status"],
            "drive_auth_error": drive_auth["error"],
            "google_drive_parent_folder_set": _has_value(settings.GOOGLE_DRIVE_PARENT_FOLDER_ID),
            "r2_config_set": all(
                _has_value(v)
                for v in [
                    settings.R2_ACCOUNT_ID,
                    settings.R2_ACCESS_KEY_ID,
                    settings.R2_SECRET_ACCESS_KEY,
                    settings.R2_BUCKET_NAME,
                ]
            ),
        },
        "limits": {
            "max_upload_bytes": settings.MAX_UPLOAD_BYTES,
            "max_pdf_pages": settings.MAX_PDF_PAGES,
            "docgen_max_workers": settings.DOCGEN_MAX_WORKERS,
            "r2_storage_limit_bytes": settings.R2_STORAGE_LIMIT_BYTES,
            "max_receipt_images_per_receipt": settings.MAX_RECEIPT_IMAGES_PER_RECEIPT,
            "max_bank_images_per_transaction": settings.MAX_BANK_IMAGES_PER_TRANSACTION,
            "max_refund_files_per_refund": settings.MAX_REFUND_FILES_PER_REFUND,
            "max_attachment_files_per_request": settings.MAX_ATTACHMENT_FILES_PER_REQUEST,
        },
        "documents": {
            "stuck_generations": stuck_generations,
            "stuck_generation_count": len(stuck_generations),
        },
        "claims": {
            "error_claims": error_claims,
            "error_claim_count": len(error_claims),
        },
    }


@router.get("/storage-summary")
async def storage_summary(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Estimate tracked storage usage from DB file_size_bytes columns."""
    rows = []
    total_known = 0
    r2_known = 0
    unknown_sources = []

    for table_name, label, storage_kind in STORAGE_SOURCES:
        try:
            resp = db.table(table_name).select("file_size_bytes").execute()
            values = [row.get("file_size_bytes") for row in (resp.data or [])]
            known_values = [int(v) for v in values if v is not None]
            source_total = sum(known_values)
            total_known += source_total
            if storage_kind == "r2":
                r2_known += source_total
            unknown_count = len(values) - len(known_values)
            rows.append({
                "table": table_name,
                "label": label,
                "storage": storage_kind,
                "known_bytes": source_total,
                "known_file_count": len(known_values),
                "unknown_file_count": unknown_count,
            })
        except Exception:
            unknown_sources.append(table_name)
            rows.append({
                "table": table_name,
                "label": label,
                "storage": storage_kind,
                "known_bytes": 0,
                "known_file_count": 0,
                "unknown_file_count": None,
            })

    return {
        "known_bytes": total_known,
        "r2_known_bytes": r2_known,
        "limit_bytes": settings.R2_STORAGE_LIMIT_BYTES,
        "usage_ratio": r2_known / settings.R2_STORAGE_LIMIT_BYTES if settings.R2_STORAGE_LIMIT_BYTES else None,
        "sources": rows,
        "unknown_sources": unknown_sources,
    }


def _row_file_ids(table_name: str, row: dict) -> list[str]:
    if table_name == "bank_transaction_refunds":
        ids = []
        if row.get("drive_file_id"):
            ids.append(row["drive_file_id"])
        ids.extend([fid for fid in (row.get("extra_drive_file_ids") or []) if fid])
        return ids
    return [row["drive_file_id"]] if row.get("drive_file_id") else []


def _lookup_file_size(file_id: str, storage_kind: str) -> int:
    if storage_kind == "drive" and "/" not in file_id:
        from app.services import pdf as pdf_service

        return pdf_service.get_drive_file_size(file_id)

    from app.services import r2 as r2_service

    return r2_service.get_file_size(file_id)


@router.post("/storage-summary/backfill")
async def backfill_storage_sizes(
    limit: int = Query(default=50, ge=1, le=200),
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Backfill missing file_size_bytes using R2/Drive metadata only."""
    updated = 0
    failed: list[dict] = []
    remaining = limit

    for table_name, _label, storage_kind in STORAGE_SOURCES:
        if remaining <= 0:
            break

        select_cols = "id, drive_file_id, file_size_bytes"
        if table_name == "bank_transaction_refunds":
            select_cols = "id, drive_file_id, extra_drive_file_ids, file_size_bytes"

        try:
            resp = (
                db.table(table_name)
                .select(select_cols)
                .is_("file_size_bytes", "null")
                .limit(remaining)
                .execute()
            )
        except Exception as exc:
            failed.append({"table": table_name, "id": None, "error": str(exc)[:180]})
            continue

        for row in resp.data or []:
            file_ids = _row_file_ids(table_name, row)
            if not file_ids:
                failed.append({"table": table_name, "id": row.get("id"), "error": "No file id stored"})
                continue
            try:
                size = sum(_lookup_file_size(file_id, storage_kind) for file_id in file_ids)
                db.table(table_name).update({"file_size_bytes": size}).eq("id", row["id"]).execute()
                updated += 1
                remaining -= 1
            except Exception as exc:
                failed.append({"table": table_name, "id": row.get("id"), "error": str(exc)[:180]})

            if remaining <= 0:
                break

    return {
        "updated": updated,
        "failed": len(failed),
        "failures": failed[:10],
        "limit": limit,
    }


@router.post("/approve/{member_id}")
async def approve_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Approve a pending registration."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "pending")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")

    member = resp.data[0]
    db.table("finance_team").update({"status": "active"}).eq("id", member_id).execute()
    if member.get("role") == "treasurer" and member.get("telegram_id"):
        cca_resp = (
            db.table("treasurer_ccas")
            .select("cca_id, ccas(id, name)")
            .eq("finance_team_id", member_id)
            .execute()
        )
        ccas = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]
        asyncio.create_task(send_bot_notification(member["telegram_id"], _approved_treasurer_message(ccas)))
    return {"success": True}


@router.delete("/reject/{member_id}")
async def reject_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Reject and delete a pending registration."""
    resp = db.table("finance_team").delete().eq("id", member_id).eq("status", "pending").execute()
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")
    return {"success": True}


# ---------------------------------------------------------------------------
# Team management (active members)
# ---------------------------------------------------------------------------

def _attach_ccas(db, members: list[dict]) -> None:
    """Mutate each treasurer in-place by attaching their CCA list."""
    for member in members:
        if member.get("role") == "treasurer":
            cca_resp = (
                db.table("treasurer_ccas")
                .select("cca_id, ccas(id, name)")
                .eq("finance_team_id", member["id"])
                .execute()
            )
            member["ccas"] = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]
        else:
            member.setdefault("ccas", [])


@router.get("/team")
async def list_team_members(
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """List all active non-director members."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("status", "active")
        .neq("role", "director")
        .order("name")
        .execute()
    )
    members = resp.data or []
    _attach_ccas(db, members)
    return members


@router.get("/treasurers")
async def list_treasurer_profiles(
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """List active CCA treasurers for finance-team profile lookup."""
    resp = (
        db.table("finance_team")
        .select("id, name, email, matric_number, phone_number, telegram_username, role, status")
        .eq("status", "active")
        .eq("role", "treasurer")
        .order("name")
        .execute()
    )
    members = resp.data or []
    _attach_ccas(db, members)
    return members


@router.get("/treasurer-options")
async def list_treasurer_options(
    cca_id: str = Query(...),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return active finance_team treasurers linked to a given CCA, for the new claim form."""
    links_resp = (
        db.table("treasurer_ccas")
        .select("finance_team_id")
        .eq("cca_id", cca_id)
        .execute()
    )
    ft_ids = [row["finance_team_id"] for row in (links_resp.data or [])]
    if not ft_ids:
        return []
    members_resp = (
        db.table("finance_team")
        .select("id, name, email")
        .in_("id", ft_ids)
        .eq("status", "active")
        .order("name")
        .execute()
    )
    return members_resp.data or []


class UpdateMemberRequest(BaseModel):
    role: Optional[str] = None
    cca_ids: list[str] = []
    name: Optional[str] = None
    email: Optional[str] = None
    matric_number: Optional[str] = None
    phone_number: Optional[str] = None


@router.patch("/team/{member_id}")
async def update_team_member(
    member_id: str,
    payload: UpdateMemberRequest,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Update role, name, email, matric_number, phone_number (and CCAs for treasurers) for an active member."""
    if payload.role is not None and payload.role not in ("member", "treasurer"):
        raise HTTPException(400, "role must be 'member' or 'treasurer'")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must have at least one CCA")

    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "active")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Active member not found")
    member = resp.data[0]
    if member.get("role") == "director":
        raise HTTPException(403, "Cannot modify a director")

    update_fields: dict = {}
    if payload.role is not None:
        update_fields["role"] = payload.role
    if payload.name is not None:
        update_fields["name"] = payload.name.strip()
    if payload.email is not None:
        update_fields["email"] = payload.email.strip()
    if payload.matric_number is not None:
        update_fields["matric_number"] = payload.matric_number.strip()
    if payload.phone_number is not None:
        update_fields["phone_number"] = payload.phone_number.strip()

    if update_fields:
        db.table("finance_team").update(update_fields).eq("id", member_id).execute()

    # Replace treasurer_ccas entirely if CCA list provided (or role is changing)
    effective_role = update_fields.get("role", member.get("role"))
    if payload.cca_ids or (payload.role is not None):
        db.table("treasurer_ccas").delete().eq("finance_team_id", member_id).execute()
        if effective_role == "treasurer":
            db.table("treasurer_ccas").insert([
                {"finance_team_id": member_id, "cca_id": cca_id}
                for cca_id in payload.cca_ids
            ]).execute()

    updated = db.table("finance_team").select("*").eq("id", member_id).single().execute()
    result = updated.data
    _attach_ccas(db, [result])
    return result


@router.delete("/team/{member_id}")
async def remove_team_member(
    member_id: str,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Remove an active member. Cannot remove yourself."""
    if str(director["id"]) == str(member_id):
        raise HTTPException(400, "Cannot remove yourself")

    resp = (
        db.table("finance_team")
        .select("role")
        .eq("id", member_id)
        .eq("status", "active")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Active member not found")
    if resp.data[0].get("role") == "director":
        raise HTTPException(403, "Cannot remove a director")

    db.table("finance_team").delete().eq("id", member_id).execute()
    return {"success": True}
