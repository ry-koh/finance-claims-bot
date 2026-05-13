import os
import sys
from datetime import datetime, timezone
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

from app.services import manual_rfp


def test_manual_rfp_generation_inputs_use_custom_payee_and_category_codes():
    payload = manual_rfp.ManualRfpCreate(
        title="Coach payment",
        reference_code="coach-rfp",
        payee_name="Jane Tan",
        payee_matric_no="a1234567b",
        wbs_no="A-000-123",
        line_items=[
            manual_rfp.ManualRfpLineItem(
                category="Meals & Refreshments",
                amount=12.30,
                gst_code="IE",
                dr_cr="DR",
            ),
            manual_rfp.ManualRfpLineItem(
                category="Custom",
                category_code="7654321",
                amount=4.55,
                gst_code="I9",
                dr_cr="CR",
            ),
        ],
    )

    claim, line_items, payee = manual_rfp.build_rfp_generation_inputs(payload)

    assert claim == {
        "reference_code": "COACH-RFP",
        "total_amount": 16.85,
        "wbs_no": "A-000-123",
    }
    assert payee == {"name": "Jane Tan", "matric_no": "A1234567B"}
    assert line_items == [
        {"category_code": "7500106", "total_amount": 12.30, "gst_code": "IE", "dr_cr": "DR"},
        {"category_code": "7654321", "total_amount": 4.55, "gst_code": "I9", "dr_cr": "CR"},
    ]


def test_manual_rfp_generation_inputs_autofills_wbs_from_account():
    payload = manual_rfp.ManualRfpCreate(
        title="Master Fund payment",
        payee_name="Jane Tan",
        payee_matric_no="a1234567b",
        wbs_account="MF",
        wbs_no="",
        line_items=[
            manual_rfp.ManualRfpLineItem(
                category="Professional fees",
                amount=100,
            ),
        ],
    )

    claim, _line_items, _payee = manual_rfp.build_rfp_generation_inputs(payload)

    assert claim["wbs_no"] == "E-404-10-0001-01"


def test_manual_rfp_update_fields_trim_notes_and_mark_completed():
    now = datetime(2026, 5, 13, 12, 30, tzinfo=timezone.utc)
    payload = manual_rfp.ManualRfpUpdate(
        internal_notes="  Confirmed with OSL.  ",
        completed=True,
    )

    fields = manual_rfp.build_rfp_update_fields(payload, now=now)

    assert fields == {
        "internal_notes": "Confirmed with OSL.",
        "completed_at": "2026-05-13T12:30:00+00:00",
    }
