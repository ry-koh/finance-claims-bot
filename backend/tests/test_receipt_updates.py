import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "service-role")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:test-token")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
os.environ.setdefault("GMAIL_CLIENT_ID", "client")
os.environ.setdefault("GMAIL_CLIENT_SECRET", "secret")
os.environ.setdefault("GMAIL_REFRESH_TOKEN", "refresh")
os.environ.setdefault("GOOGLE_DRIVE_PARENT_FOLDER_ID", "folder")

from app.models import ReceiptUpdate
from app.routers import receipts


def test_receipt_update_detects_attachment_only_changes():
    payload = ReceiptUpdate(receipt_image_drive_ids=["new-receipt-file"])

    assert receipts._receipt_update_has_related_updates(payload) is True


def test_receipt_update_detects_bank_link_changes():
    payload = ReceiptUpdate(clear_bank_transaction=True)

    assert receipts._receipt_update_has_related_updates(payload) is True


def test_receipt_update_ignores_plain_receipt_field_changes():
    payload = ReceiptUpdate(description="Lunch")

    assert receipts._receipt_update_has_related_updates(payload) is False
