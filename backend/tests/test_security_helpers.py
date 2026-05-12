import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "service-role")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:test-token")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
os.environ.setdefault("GMAIL_CLIENT_ID", "client")
os.environ.setdefault("GMAIL_CLIENT_SECRET", "secret")
os.environ.setdefault("GMAIL_REFRESH_TOKEN", "refresh")
os.environ.setdefault("GOOGLE_DRIVE_PARENT_FOLDER_ID", "folder")

pytest.importorskip("fastapi")
from fastapi import HTTPException

from app.routers import claims
from app.routers import receipts
from app.services import image_access


class Result:
    def __init__(self, data):
        self.data = data
        self.count = len(data or [])


class Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def contains(self, *_args, **_kwargs):
        return self

    def execute(self):
        return Result(self.rows)


class Db:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return Query(self.tables.get(name, []))


def test_receipt_rejects_bank_transaction_from_another_claim():
    db = Db({"bank_transactions": [{"id": "bt-1", "claim_id": "claim-other"}]})

    with pytest.raises(HTTPException) as exc:
        receipts._assert_bank_transaction_for_claim(db, "bt-1", "claim-current", {"id": "user-1"})

    assert exc.value.status_code == 422
    assert exc.value.detail == "Bank transaction does not belong to this claim"


def test_receipt_accepts_bank_transaction_from_same_claim(monkeypatch):
    db = Db({"bank_transactions": [{"id": "bt-1", "claim_id": "claim-current"}]})
    calls = []

    def fake_get_claim_for_member(_db, claim_id, member, *, require_treasurer_draft=False):
        calls.append((claim_id, member["id"], require_treasurer_draft))
        return {"id": claim_id}

    monkeypatch.setattr(receipts, "get_claim_for_member", fake_get_claim_for_member)

    receipts._assert_bank_transaction_for_claim(db, "bt-1", "claim-current", {"id": "user-1"})

    assert calls == [("claim-current", "user-1", True)]


def test_image_access_requires_telegram_init_data():
    with pytest.raises(HTTPException) as exc:
        image_access.member_from_init_data(None, Db({}))

    assert exc.value.status_code == 401


def test_image_access_returns_404_when_path_is_not_referenced(monkeypatch):
    monkeypatch.setattr(image_access, "_path_belongs_to_accessible_claim", lambda *_args: False)
    monkeypatch.setattr(image_access, "_path_belongs_to_accessible_help_item", lambda *_args: False)

    with pytest.raises(HTTPException) as exc:
        image_access.assert_can_view_path(Db({}), "missing/path.jpg", {"id": "user-1"})

    assert exc.value.status_code == 404


def test_treasurer_notes_only_update_does_not_require_draft_claim():
    assert claims._claim_update_requires_treasurer_draft({"treasurer_notes": "Treasurer context"}) is False


def test_mixed_treasurer_notes_update_still_requires_draft_claim():
    assert claims._claim_update_requires_treasurer_draft({
        "treasurer_notes": "Treasurer context",
        "claim_description": "Camp",
    }) is True


def test_status_group_filter_normalises_distinct_statuses():
    assert claims._normalise_statuses("submitted,reimbursed,submitted") == ["submitted", "reimbursed"]


def test_status_group_filter_rejects_unknown_status():
    with pytest.raises(HTTPException) as exc:
        claims._normalise_statuses("submitted,unknown")

    assert exc.value.status_code == 422
