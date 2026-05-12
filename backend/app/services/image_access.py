from fastapi import HTTPException
from supabase import Client

from app.auth import get_claim_for_member, verify_telegram_init_data
from app.models import UserRole


def member_from_init_data(init_data: str | None, db: Client) -> dict:
    telegram_user = verify_telegram_init_data(init_data)
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", int(telegram_user["id"]))
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=401, detail="unregistered")
    member = resp.data[0]
    if member.get("status") == "pending":
        raise HTTPException(status_code=403, detail="pending")
    return member


def _claim_id_from_rows(rows: list[dict], relation_key: str | None = None) -> str | None:
    for row in rows or []:
        if relation_key:
            related = row.get(relation_key) or {}
            claim_id = related.get("claim_id")
        else:
            claim_id = row.get("claim_id")
        if claim_id:
            return claim_id
    return None


def _path_belongs_to_accessible_claim(db: Client, path: str, member: dict) -> bool:
    claim_id: str | None = None

    receipt_image_resp = (
        db.table("receipt_images")
        .select("receipt:receipts(claim_id)")
        .eq("drive_file_id", path)
        .limit(1)
        .execute()
    )
    claim_id = _claim_id_from_rows(receipt_image_resp.data or [], "receipt")

    if not claim_id:
        receipt_fields = (
            "claim_id, receipt_image_drive_id, bank_screenshot_drive_id, "
            "exchange_rate_screenshot_drive_id, exchange_rate_screenshot_drive_ids"
        )
        for field in ("receipt_image_drive_id", "bank_screenshot_drive_id", "exchange_rate_screenshot_drive_id"):
            resp = db.table("receipts").select(receipt_fields).eq(field, path).limit(1).execute()
            claim_id = _claim_id_from_rows(resp.data or [])
            if claim_id:
                break
        if not claim_id:
            resp = (
                db.table("receipts")
                .select(receipt_fields)
                .contains("exchange_rate_screenshot_drive_ids", [path])
                .limit(1)
                .execute()
            )
            claim_id = _claim_id_from_rows(resp.data or [])

    if not claim_id:
        bank_image_resp = (
            db.table("bank_transaction_images")
            .select("bank_transaction:bank_transactions(claim_id)")
            .eq("drive_file_id", path)
            .limit(1)
            .execute()
        )
        claim_id = _claim_id_from_rows(bank_image_resp.data or [], "bank_transaction")

    if not claim_id:
        refund_resp = (
            db.table("bank_transaction_refunds")
            .select("bank_transaction:bank_transactions(claim_id)")
            .eq("drive_file_id", path)
            .limit(1)
            .execute()
        )
        claim_id = _claim_id_from_rows(refund_resp.data or [], "bank_transaction")
        if not claim_id:
            refund_extra_resp = (
                db.table("bank_transaction_refunds")
                .select("bank_transaction:bank_transactions(claim_id)")
                .contains("extra_drive_file_ids", [path])
                .limit(1)
                .execute()
            )
            claim_id = _claim_id_from_rows(refund_extra_resp.data or [], "bank_transaction")

    if not claim_id:
        docs_resp = (
            db.table("claim_documents")
            .select("claim_id")
            .eq("drive_file_id", path)
            .limit(1)
            .execute()
        )
        claim_id = _claim_id_from_rows(docs_resp.data or [])

    if not claim_id:
        resp = db.table("claims").select("id").eq("mf_approval_drive_id", path).limit(1).execute()
        if resp.data:
            claim_id = resp.data[0].get("id")
        if not claim_id:
            resp = (
                db.table("claims")
                .select("id")
                .contains("mf_approval_drive_ids", [path])
                .limit(1)
                .execute()
            )
            if resp.data:
                claim_id = resp.data[0].get("id")

    if not claim_id:
        attachment_resp = (
            db.table("claim_attachment_files")
            .select("request:claim_attachment_requests(claim_id)")
            .eq("file_url", path)
            .limit(1)
            .execute()
        )
        claim_id = _claim_id_from_rows(attachment_resp.data or [], "request")

    if not claim_id:
        return False

    try:
        get_claim_for_member(db, claim_id, member)
        return True
    except HTTPException:
        return False


def _path_belongs_to_accessible_help_item(db: Client, path: str, member: dict) -> bool:
    resp = (
        db.table("help_questions")
        .select("id, asker_id")
        .contains("image_urls", [path])
        .limit(1)
        .execute()
    )
    if not resp.data:
        return False

    question = resp.data[0]
    if str(question.get("asker_id")) == str(member.get("id")):
        return True
    return member.get("role") in {UserRole.DIRECTOR.value, UserRole.MEMBER.value}


def assert_can_view_path(db: Client, path: str, member: dict) -> None:
    if _path_belongs_to_accessible_claim(db, path, member):
        return
    if _path_belongs_to_accessible_help_item(db, path, member):
        return
    raise HTTPException(status_code=404, detail="Image not found")
