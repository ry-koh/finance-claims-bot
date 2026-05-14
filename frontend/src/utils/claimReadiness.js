function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function hasAny(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

function hasText(value) {
  return Boolean(String(value ?? '').trim())
}

function toAmount(value) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function isBankOnlyReceipt(receipt) {
  return /^BT\d+$/i.test(receipt?.receipt_no || '') && Boolean(receipt?.bank_transaction_id)
}

function receiptHasImage(receipt) {
  return Boolean(receipt?.receipt_image_drive_id) || hasAny(receipt?.images)
}

function bankTransactionHasImage(bt) {
  return hasAny(bt?.images)
}

function bankTransactionNetAmount(bt) {
  const refundTotal = (bt?.refunds ?? []).reduce((sum, refund) => sum + toAmount(refund.amount), 0)
  return toAmount(bt?.amount) - refundTotal
}

function transportTripComplete(trip) {
  return (
    hasText(trip?.from_location) &&
    hasText(trip?.to_location) &&
    hasText(trip?.purpose) &&
    hasText(trip?.date) &&
    hasText(trip?.time) &&
    toAmount(trip?.amount) > 0 &&
    toAmount(trip?.distance_km) > 0
  )
}

function computeSummary(claim) {
  if (claim?.readiness && !claim?.receipts && !claim?.bank_transactions) return claim.readiness

  const receipts = claim?.receipts ?? []
  const bankTransactions = claim?.bank_transactions ?? []
  const bankTransactionsById = Object.fromEntries(bankTransactions.map((bt) => [bt.id, bt]))
  const linkedBtIds = new Set(receipts.map((receipt) => receipt.bank_transaction_id).filter(Boolean))

  let receiptMissingImages = 0
  let receiptMissingBankLink = 0
  let foreignReceiptMissingFx = 0
  let incompleteReceiptDetails = 0
  let bankOnlyReceiptCount = 0
  const receiptAmountsByBt = {}

  receipts.forEach((receipt) => {
    const bankOnly = isBankOnlyReceipt(receipt)
    if (bankOnly) bankOnlyReceiptCount += 1
    if (!bankOnly && !receiptHasImage(receipt)) receiptMissingImages += 1
    if (!receipt.bank_transaction_id && !receipt.bank_screenshot_drive_id) receiptMissingBankLink += 1
    if (receipt.bank_transaction_id) {
      receiptAmountsByBt[receipt.bank_transaction_id] =
        (receiptAmountsByBt[receipt.bank_transaction_id] ?? 0) + toAmount(receipt.amount)
    }
    if (
      !hasText(receipt.description) ||
      !hasText(receipt.date) ||
      toAmount(receipt.amount) <= 0 ||
      !hasText(receipt.payer_name) ||
      !hasText(receipt.payer_email)
    ) {
      incompleteReceiptDetails += 1
    }
    if (
      receipt.is_foreign_currency &&
      !receipt.exchange_rate_screenshot_drive_id &&
      !hasAny(receipt.exchange_rate_screenshot_drive_ids)
    ) {
      foreignReceiptMissingFx += 1
    }
  })

  const bankTransactionsWithoutReceiptDetails = bankTransactions.filter((bt) => !linkedBtIds.has(bt.id)).length
  const bankTransactionMissingImages = bankTransactions.filter((bt) => !bankTransactionHasImage(bt)).length
  const amountMismatchCount = bankTransactions.filter((bt) => {
    if (receiptAmountsByBt[bt.id] == null) return false
    return Math.abs(receiptAmountsByBt[bt.id] - bankTransactionNetAmount(bankTransactionsById[bt.id])) > 0.01
  }).length
  const mfApprovalMissing =
    claim?.wbs_account === 'MF' &&
    !claim?.mf_approval_drive_id &&
    !hasAny(claim?.mf_approval_drive_ids)
  const trips = claim?.transport_data?.trips ?? []
  const transportTripsMissing =
    Boolean(claim?.transport_form_needed) &&
    (trips.length === 0 || trips.some((trip) => !transportTripComplete(trip)))

  return {
    receipt_count: receipts.length,
    receipt_missing_images_count: receiptMissingImages,
    receipt_missing_bank_link_count: receiptMissingBankLink,
    bank_transaction_count: bankTransactions.length,
    bank_transaction_missing_images_count: bankTransactionMissingImages,
    bank_transactions_without_receipt_details_count: bankTransactionsWithoutReceiptDetails,
    incomplete_receipt_details_count: incompleteReceiptDetails,
    amount_mismatch_count: amountMismatchCount,
    foreign_receipt_missing_fx_count: foreignReceiptMissingFx,
    mf_approval_missing: mfApprovalMissing,
    bank_only_receipt_count: bankOnlyReceiptCount,
    bank_only_explanation_missing: bankOnlyReceiptCount > 0 && !hasText(claim?.remarks),
    transport_trips_missing: transportTripsMissing,
    total_amount_invalid: toAmount(claim?.total_amount) <= 0,
  }
}

function makeCheck({ id, label, ok, issue, severity = 'blocker', hidden = false }) {
  return { id, label, ok, issue, severity, hidden }
}

export function getClaimReadiness(claim) {
  const summary = computeSummary(claim)
  const checks = [
    makeCheck({
      id: 'evidence',
      label: 'Evidence added',
      ok: summary.receipt_count > 0 || summary.bank_transaction_count > 0,
      issue: 'Add at least one receipt or bank transaction.',
    }),
    makeCheck({
      id: 'total',
      label: 'Claim total is above zero',
      ok: !summary.total_amount_invalid,
      issue: 'Claim total must be above $0.00.',
    }),
    makeCheck({
      id: 'receipt-details',
      label: 'Receipt details completed',
      ok: (summary.incomplete_receipt_details_count ?? 0) === 0,
      issue: `${plural(summary.incomplete_receipt_details_count ?? 0, 'receipt item')} missing description, date, amount, payer name, or payer email`,
      hidden: summary.receipt_count === 0,
    }),
    makeCheck({
      id: 'receipt-images',
      label: 'Receipt images attached',
      ok: summary.receipt_missing_images_count === 0,
      issue: `${plural(summary.receipt_missing_images_count, 'receipt')} missing receipt image`,
      hidden: summary.receipt_count === 0,
    }),
    makeCheck({
      id: 'bank-only-details',
      label: 'Bank-only transactions have claim item details',
      ok: (summary.bank_transactions_without_receipt_details_count ?? 0) === 0,
      issue: `${plural(summary.bank_transactions_without_receipt_details_count ?? 0, 'bank transaction')} need receipt-style claim details`,
      hidden: (summary.bank_transactions_without_receipt_details_count ?? 0) === 0,
    }),
    makeCheck({
      id: 'bank-only-explanation',
      label: 'No-receipt explanation added',
      ok: !summary.bank_only_explanation_missing,
      issue: 'Add a remark explaining why the supplier did not provide a receipt.',
      hidden: (summary.bank_only_receipt_count ?? 0) === 0,
    }),
    makeCheck({
      id: 'bank-links',
      label: 'Receipts linked to bank transactions',
      ok: summary.receipt_missing_bank_link_count === 0,
      issue: `${plural(summary.receipt_missing_bank_link_count, 'receipt')} not linked to a bank transaction. This is okay for cash purchases; finance should verify it.`,
      hidden: summary.receipt_count === 0,
      severity: 'warning',
    }),
    makeCheck({
      id: 'bank-images',
      label: 'Bank transaction screenshots attached',
      ok: summary.bank_transaction_missing_images_count === 0,
      issue: `${plural(summary.bank_transaction_missing_images_count, 'bank transaction')} missing screenshot`,
      hidden: summary.bank_transaction_count === 0,
    }),
    makeCheck({
      id: 'amount-mismatch',
      label: 'Receipt totals match bank transactions',
      ok: (summary.amount_mismatch_count ?? 0) === 0,
      issue: `${plural(summary.amount_mismatch_count ?? 0, 'bank transaction')} does not match linked receipt total`,
      hidden: summary.receipt_count === 0 || summary.bank_transaction_count === 0,
      severity: 'warning',
    }),
    makeCheck({
      id: 'mf-approval',
      label: 'Master Fund approval attached',
      ok: !summary.mf_approval_missing,
      issue: 'Master Fund approval is missing. Finance should verify whether it is required.',
      hidden: claim?.wbs_account !== 'MF',
      severity: 'warning',
    }),
    makeCheck({
      id: 'fx-screenshots',
      label: 'Exchange-rate screenshots attached',
      ok: summary.foreign_receipt_missing_fx_count === 0,
      issue: `${plural(summary.foreign_receipt_missing_fx_count, 'foreign-currency receipt')} missing exchange-rate screenshot`,
      hidden: summary.foreign_receipt_missing_fx_count === 0,
    }),
    makeCheck({
      id: 'transport-trips',
      label: 'Transport trip details completed',
      ok: !summary.transport_trips_missing,
      issue: 'Add complete transport trip details.',
      hidden: !claim?.transport_form_needed,
    }),
  ].filter((check) => !check.hidden)

  const missing = checks.filter((check) => !check.ok)
  const blockers = missing.filter((check) => check.severity === 'blocker')
  const warnings = missing.filter((check) => check.severity === 'warning')
  return {
    checks,
    missing,
    blockers,
    warnings,
    firstIssue: missing[0] ?? null,
    firstBlocker: blockers[0] ?? null,
    isReady: missing.length === 0,
    canSubmit: blockers.length === 0,
    canApprove: blockers.length === 0,
  }
}

export function getTreasurerNextStep(claim) {
  const readiness = getClaimReadiness(claim)
  if (claim?.status === 'draft') {
    return readiness.firstBlocker?.issue ?? 'Ready to submit for review'
  }
  if (claim?.status === 'attachment_requested') return 'Upload the requested attachment'
  if (claim?.status === 'pending_review') return 'Waiting for finance review'
  if (claim?.status === 'reimbursed') return 'Reimbursed'
  return null
}
