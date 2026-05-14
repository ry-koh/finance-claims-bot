import re
from collections import defaultdict


def _has_any(value) -> bool:
    if isinstance(value, list):
        return len(value) > 0
    return bool(value)


def _has_text(value) -> bool:
    return bool(str(value or "").strip())


def _amount(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _has_receipt_image(receipt: dict) -> bool:
    return bool(receipt.get("receipt_image_drive_id")) or _has_any(receipt.get("images"))


def _has_bank_image(bank_transaction: dict) -> bool:
    return _has_any(bank_transaction.get("images"))


def _has_fx_image(receipt: dict) -> bool:
    return bool(receipt.get("exchange_rate_screenshot_drive_id")) or _has_any(
        receipt.get("exchange_rate_screenshot_drive_ids")
    )


def _is_bank_only_receipt(receipt: dict) -> bool:
    receipt_no = str(receipt.get("receipt_no") or "")
    return bool(receipt.get("bank_transaction_id")) and re.fullmatch(r"BT\d+", receipt_no, re.IGNORECASE) is not None


def _bank_transaction_net_amount(bank_transaction: dict) -> float:
    refunds = bank_transaction.get("refunds") or []
    refund_total = sum(_amount(refund.get("amount")) for refund in refunds)
    return _amount(bank_transaction.get("amount")) - refund_total


def _transport_trip_complete(trip: dict) -> bool:
    required_text = ["from_location", "to_location", "purpose", "date", "time"]
    if any(not _has_text(trip.get(field)) for field in required_text):
        return False
    return _amount(trip.get("amount")) > 0 and _amount(trip.get("distance_km")) > 0


def _check(check_id: str, label: str, ok: bool, issue: str, *, severity: str = "blocker") -> dict:
    return {
        "id": check_id,
        "label": label,
        "ok": ok,
        "issue": issue,
        "severity": severity,
    }


def evaluate_claim_readiness(claim: dict, receipts: list[dict] | None, bank_transactions: list[dict] | None) -> dict:
    """
    Evaluate whether a claim is ready to leave draft/review.

    The rules are claim-pattern aware:
    - bank-only claims are represented by BT-number placeholder receipts and do not need receipt images;
    - cash purchases can have receipt proof without bank transactions;
    - one bank transaction can cover multiple receipts;
    - amount mismatches and missing MF approval are review warnings, not submit blockers.
    """
    receipts = receipts or []
    bank_transactions = bank_transactions or []
    bank_transactions_by_id = {bt.get("id"): bt for bt in bank_transactions}
    receipt_amounts_by_bt: dict[str, float] = defaultdict(float)

    bank_only_receipts = [receipt for receipt in receipts if _is_bank_only_receipt(receipt)]
    standard_receipts = [receipt for receipt in receipts if not _is_bank_only_receipt(receipt)]
    linked_receipt_bt_ids = {receipt.get("bank_transaction_id") for receipt in receipts if receipt.get("bank_transaction_id")}
    bank_transactions_without_receipt_details = [
        bt for bt in bank_transactions if bt.get("id") not in linked_receipt_bt_ids
    ]

    missing_receipt_images = [
        receipt for receipt in standard_receipts if not _has_receipt_image(receipt)
    ]
    missing_bank_images = [
        bt for bt in bank_transactions if not _has_bank_image(bt)
    ]
    incomplete_receipts = [
        receipt
        for receipt in receipts
        if (
            not _has_text(receipt.get("description"))
            or not _has_text(receipt.get("date"))
            or _amount(receipt.get("amount")) <= 0
            or not _has_text(receipt.get("payer_name"))
            or not _has_text(receipt.get("payer_email"))
        )
    ]
    unlinked_receipts = [
        receipt
        for receipt in standard_receipts
        if not receipt.get("bank_transaction_id") and not receipt.get("bank_screenshot_drive_id")
    ]
    missing_fx = [
        receipt
        for receipt in receipts
        if receipt.get("is_foreign_currency") and not _has_fx_image(receipt)
    ]

    for receipt in receipts:
        bt_id = receipt.get("bank_transaction_id")
        if bt_id:
            receipt_amounts_by_bt[bt_id] += _amount(receipt.get("amount"))

    amount_mismatches = []
    for bt_id, linked_total in receipt_amounts_by_bt.items():
        bt = bank_transactions_by_id.get(bt_id)
        if not bt:
            continue
        if abs(linked_total - _bank_transaction_net_amount(bt)) > 0.01:
            amount_mismatches.append(bt)

    transport_missing = False
    if claim.get("transport_form_needed"):
        trips = (claim.get("transport_data") or {}).get("trips") or []
        transport_missing = not trips or any(not _transport_trip_complete(trip) for trip in trips)

    mf_approval_missing = (
        claim.get("wbs_account") == "MF"
        and not claim.get("mf_approval_drive_id")
        and not _has_any(claim.get("mf_approval_drive_ids"))
    )

    checks = [
        _check(
            "evidence",
            "Evidence added",
            bool(receipts or bank_transactions),
            "Add at least one receipt or bank transaction.",
        ),
        _check(
            "total",
            "Claim total is above zero",
            _amount(claim.get("total_amount")) > 0,
            "Claim total must be above $0.00.",
        ),
        _check(
            "receipt-details",
            "Receipt details completed",
            len(incomplete_receipts) == 0,
            f"{len(incomplete_receipts)} receipt item{' is' if len(incomplete_receipts) == 1 else 's are'} missing description, date, amount, payer name, or payer email.",
        ),
        _check(
            "receipt-images",
            "Receipt proof attached",
            len(missing_receipt_images) == 0,
            f"{len(missing_receipt_images)} receipt{' is' if len(missing_receipt_images) == 1 else 's are'} missing receipt proof.",
        ),
        _check(
            "bank-images",
            "Bank transaction proof attached",
            len(missing_bank_images) == 0,
            f"{len(missing_bank_images)} bank transaction{' is' if len(missing_bank_images) == 1 else 's are'} missing screenshot/PDF proof.",
        ),
        _check(
            "bank-only-details",
            "Bank-only transactions have claim item details",
            len(bank_transactions_without_receipt_details) == 0,
            f"{len(bank_transactions_without_receipt_details)} bank transaction{' needs' if len(bank_transactions_without_receipt_details) == 1 else 's need'} receipt-style claim details.",
        ),
        _check(
            "bank-only-explanation",
            "No-receipt explanation added",
            len(bank_only_receipts) == 0 or _has_text(claim.get("remarks")),
            "Add a remark explaining why the supplier did not provide a receipt.",
        ),
        _check(
            "fx-screenshots",
            "Exchange-rate proof attached",
            len(missing_fx) == 0,
            f"{len(missing_fx)} foreign-currency receipt{' is' if len(missing_fx) == 1 else 's are'} missing exchange-rate proof.",
        ),
        _check(
            "transport-trips",
            "Transport trip details completed",
            not transport_missing,
            "Add complete transport trip details.",
        ),
        _check(
            "bank-links",
            "Receipts linked to bank transactions",
            len(unlinked_receipts) == 0,
            f"{len(unlinked_receipts)} receipt{' is' if len(unlinked_receipts) == 1 else 's are'} not linked to a bank transaction. This is okay for cash purchases; finance should verify it.",
            severity="warning",
        ),
        _check(
            "amount-mismatch",
            "Receipt totals match bank transactions",
            len(amount_mismatches) == 0,
            f"{len(amount_mismatches)} bank transaction{' does' if len(amount_mismatches) == 1 else 's do'} not match linked receipt totals.",
            severity="warning",
        ),
        _check(
            "mf-approval",
            "Master Fund approval attached",
            not mf_approval_missing,
            "Master Fund approval is missing. Finance should verify whether it is required.",
            severity="warning",
        ),
    ]

    # Avoid noisy warnings/checks for patterns that are not present.
    visible_checks = [
        check
        for check in checks
        if not (
            (check["id"] == "bank-links" and not receipts)
            or (check["id"] == "amount-mismatch" and not receipts)
            or (check["id"] == "mf-approval" and claim.get("wbs_account") != "MF")
            or (check["id"] == "transport-trips" and not claim.get("transport_form_needed"))
            or (check["id"] == "fx-screenshots" and len(missing_fx) == 0)
            or (check["id"] == "bank-only-explanation" and len(bank_only_receipts) == 0)
            or (check["id"] == "bank-only-details" and len(bank_transactions_without_receipt_details) == 0)
        )
    ]
    missing = [check for check in visible_checks if not check["ok"]]
    blockers = [check for check in missing if check["severity"] == "blocker"]
    warnings = [check for check in missing if check["severity"] == "warning"]

    return {
        "checks": visible_checks,
        "missing": missing,
        "blockers": blockers,
        "warnings": warnings,
        "can_submit": len(blockers) == 0,
        "can_approve": len(blockers) == 0,
        "summary": {
            "receipt_count": len(receipts),
            "bank_transaction_count": len(bank_transactions),
            "receipt_missing_images_count": len(missing_receipt_images),
            "receipt_missing_bank_link_count": len(unlinked_receipts),
            "bank_transaction_missing_images_count": len(missing_bank_images),
            "amount_mismatch_count": len(amount_mismatches),
            "foreign_receipt_missing_fx_count": len(missing_fx),
            "mf_approval_missing": mf_approval_missing,
            "bank_only_receipt_count": len(bank_only_receipts),
        },
    }


def fetch_claim_evidence(db, claim_id: str) -> tuple[list[dict], list[dict]]:
    receipts_resp = (
        db.table("receipts")
        .select("*")
        .eq("claim_id", claim_id)
        .execute()
    )
    receipts = receipts_resp.data or []
    if receipts:
        receipt_ids = [receipt["id"] for receipt in receipts]
        image_resp = (
            db.table("receipt_images")
            .select("*")
            .in_("receipt_id", receipt_ids)
            .order("created_at")
            .execute()
        )
        images_by_receipt: dict[str, list[dict]] = defaultdict(list)
        for image in image_resp.data or []:
            images_by_receipt[image["receipt_id"]].append(image)
        for receipt in receipts:
            receipt["images"] = images_by_receipt.get(receipt["id"], [])

    bt_resp = (
        db.table("bank_transactions")
        .select("*")
        .eq("claim_id", claim_id)
        .order("created_at")
        .execute()
    )
    bank_transactions = bt_resp.data or []
    if bank_transactions:
        bt_ids = [bank_transaction["id"] for bank_transaction in bank_transactions]
        image_resp = (
            db.table("bank_transaction_images")
            .select("*")
            .in_("bank_transaction_id", bt_ids)
            .order("created_at")
            .execute()
        )
        images_by_bt: dict[str, list[dict]] = defaultdict(list)
        for image in image_resp.data or []:
            images_by_bt[image["bank_transaction_id"]].append(image)

        refund_resp = (
            db.table("bank_transaction_refunds")
            .select("*")
            .in_("bank_transaction_id", bt_ids)
            .order("created_at")
            .execute()
        )
        refunds_by_bt: dict[str, list[dict]] = defaultdict(list)
        for refund in refund_resp.data or []:
            refunds_by_bt[refund["bank_transaction_id"]].append(refund)

        for bank_transaction in bank_transactions:
            bank_transaction["images"] = images_by_bt.get(bank_transaction["id"], [])
            bank_transaction["refunds"] = refunds_by_bt.get(bank_transaction["id"], [])

    return receipts, bank_transactions


def format_blocking_issues(readiness: dict, action: str = "continue") -> str:
    blockers = readiness.get("blockers") or []
    if not blockers:
        return ""
    issues = " ".join(issue.get("issue", "") for issue in blockers if issue.get("issue"))
    return f"Fix these before you {action}: {issues}".strip()
