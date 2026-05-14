import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.claim_readiness import evaluate_claim_readiness


def _claim(**overrides):
    return {
        "total_amount": 12.50,
        "remarks": "",
        "wbs_account": "SA",
        "transport_form_needed": False,
        "transport_data": None,
        **overrides,
    }


def _receipt(**overrides):
    return {
        "id": "receipt-1",
        "receipt_no": "INV-1",
        "description": "Master's Gift to Bryan Ong",
        "date": "2026-05-14",
        "amount": 12.50,
        "payer_name": "Bryan Ong",
        "payer_email": "bryan@example.com",
        "images": [{"id": "image-1"}],
        "bank_transaction_id": "bt-1",
        "is_foreign_currency": False,
        **overrides,
    }


def _bank_transaction(**overrides):
    return {
        "id": "bt-1",
        "amount": 12.50,
        "images": [{"id": "bank-image-1"}],
        "refunds": [],
        **overrides,
    }


def _issue_ids(readiness, key="blockers"):
    return {issue["id"] for issue in readiness[key]}


def test_bank_only_claim_can_submit_with_bank_proof_and_no_receipt_explanation():
    readiness = evaluate_claim_readiness(
        _claim(remarks="- Supplier did not provide a receipt."),
        [_receipt(receipt_no="BT1", images=[])],
        [_bank_transaction()],
    )

    assert readiness["can_submit"] is True
    assert "receipt-images" not in _issue_ids(readiness)
    assert "bank-only-explanation" not in _issue_ids(readiness)


def test_bank_only_claim_requires_explanation_when_supplier_gives_no_receipt():
    readiness = evaluate_claim_readiness(
        _claim(),
        [_receipt(receipt_no="BT1", images=[])],
        [_bank_transaction()],
    )

    assert readiness["can_submit"] is False
    assert "bank-only-explanation" in _issue_ids(readiness)


def test_cash_receipt_without_bank_transaction_is_allowed_with_receipt_proof():
    readiness = evaluate_claim_readiness(
        _claim(),
        [_receipt(bank_transaction_id=None)],
        [],
    )

    assert readiness["can_submit"] is True
    assert "bank-links" in _issue_ids(readiness, "warnings")


def test_one_bank_transaction_can_cover_multiple_receipts_when_full_amounts_tally():
    receipts = [
        _receipt(id="receipt-1", amount=7.25, images=[{"id": "r1"}]),
        _receipt(id="receipt-2", amount=5.25, images=[{"id": "r2"}]),
    ]

    readiness = evaluate_claim_readiness(_claim(), receipts, [_bank_transaction(amount=12.50)])

    assert readiness["can_submit"] is True
    assert "amount-mismatch" not in _issue_ids(readiness, "warnings")


def test_bank_transaction_mismatch_is_review_warning_not_submit_blocker():
    readiness = evaluate_claim_readiness(
        _claim(),
        [_receipt(amount=10.00)],
        [_bank_transaction(amount=12.50)],
    )

    assert readiness["can_submit"] is True
    assert "amount-mismatch" in _issue_ids(readiness, "warnings")


def test_missing_mf_approval_is_warning_not_submit_blocker():
    readiness = evaluate_claim_readiness(
        _claim(wbs_account="MF"),
        [_receipt()],
        [_bank_transaction()],
    )

    assert readiness["can_submit"] is True
    assert "mf-approval" in _issue_ids(readiness, "warnings")


def test_transport_claim_requires_complete_trip_details():
    readiness = evaluate_claim_readiness(
        _claim(transport_form_needed=True, transport_data={"trips": [{"from_location": "Hall"}]}),
        [_receipt()],
        [_bank_transaction()],
    )

    assert readiness["can_submit"] is False
    assert "transport-trips" in _issue_ids(readiness)
