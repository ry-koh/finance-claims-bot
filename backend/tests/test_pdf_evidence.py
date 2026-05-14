import os
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class HTTPException(Exception):
    def __init__(self, status_code=None, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class FakeFPDF:
    def __init__(self, *args, **kwargs):
        self.page = 0

    def set_auto_page_break(self, *args, **kwargs):
        pass

    def add_page(self):
        self.page += 1

    def set_font(self, *args, **kwargs):
        pass

    def set_text_color(self, *args, **kwargs):
        pass

    def set_xy(self, *args, **kwargs):
        pass

    def cell(self, *args, **kwargs):
        pass

    def image(self, *args, **kwargs):
        pass

    def output(self):
        return b"%PDF-test"


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "service-role")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:test-token")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
os.environ.setdefault("GMAIL_CLIENT_ID", "client")
os.environ.setdefault("GMAIL_CLIENT_SECRET", "secret")
os.environ.setdefault("GMAIL_REFRESH_TOKEN", "refresh")
os.environ.setdefault("GOOGLE_DRIVE_PARENT_FOLDER_ID", "folder")


def test_generate_loa_fails_when_bank_transaction_image_is_unavailable(monkeypatch):
    monkeypatch.setitem(sys.modules, "fastapi", types.SimpleNamespace(HTTPException=HTTPException))
    monkeypatch.setitem(
        sys.modules,
        "app.config",
        types.SimpleNamespace(
            settings=types.SimpleNamespace(
                R2_ACCOUNT_ID="",
                R2_ACCESS_KEY_ID="",
                R2_SECRET_ACCESS_KEY="",
                R2_BUCKET_NAME="",
                DRIVE_REFRESH_TOKEN="",
                GMAIL_CLIENT_ID="",
                GMAIL_CLIENT_SECRET="",
                GOOGLE_DRIVE_PARENT_FOLDER_ID="",
            )
        ),
    )
    monkeypatch.setitem(sys.modules, "fpdf", types.SimpleNamespace(FPDF=FakeFPDF))

    from app.services import pdf

    def unavailable(_drive_id):
        raise FileNotFoundError("object missing")

    monkeypatch.setattr(pdf.r2_service, "download_file", unavailable)

    with pytest.raises(RuntimeError, match="Bank Transaction"):
        pdf.generate_loa(
            claim={},
            receipts=[],
            bank_transactions=[
                {
                    "id": "bt-1",
                    "images": [{"drive_file_id": "missing/bank-transaction.jpg"}],
                    "refunds": [],
                }
            ],
        )
