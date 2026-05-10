function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function hasAny(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

function isBankOnlyReceipt(receipt) {
  return /^BT\d+$/i.test(receipt?.receipt_no || '') && Boolean(receipt?.bank_transaction_id)
}

function computeSummary(claim) {
  if (claim?.readiness) return claim.readiness

  const receipts = claim?.receipts ?? []
  const bankTransactions = claim?.bank_transactions ?? []
  const bankTransactionHasImages = Object.fromEntries(
    bankTransactions.map((bt) => [bt.id, hasAny(bt.images)])
  )

  let receiptMissingImages = 0
  let receiptMissingBankLink = 0
  let foreignReceiptMissingFx = 0
  const receiptAmountsByBt = {}

  receipts.forEach((receipt) => {
    const bankOnly = isBankOnlyReceipt(receipt)
    const bankOnlyHasProof = bankOnly && bankTransactionHasImages[receipt.bank_transaction_id]
    if (!bankOnlyHasProof && !receipt.receipt_image_drive_id && !hasAny(receipt.images)) receiptMissingImages += 1
    if (!receipt.bank_transaction_id && !receipt.bank_screenshot_drive_id) receiptMissingBankLink += 1
    if (receipt.bank_transaction_id) {
      receiptAmountsByBt[receipt.bank_transaction_id] =
        (receiptAmountsByBt[receipt.bank_transaction_id] ?? 0) + Number(receipt.amount || 0)
    }
    if (
      receipt.is_foreign_currency &&
      !receipt.exchange_rate_screenshot_drive_id &&
      !hasAny(receipt.exchange_rate_screenshot_drive_ids)
    ) {
      foreignReceiptMissingFx += 1
    }
  })

  const bankTransactionMissingImages = bankTransactions.filter((bt) => !hasAny(bt.images)).length
  const amountMismatchCount = bankTransactions.filter((bt) => {
    if (receiptAmountsByBt[bt.id] == null) return false
    const refunds = bt.refunds ?? []
    const refundTotal = refunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)
    const net = Number(bt.amount || 0) - refundTotal
    return Math.abs(receiptAmountsByBt[bt.id] - net) > 0.01
  }).length
  const mfApprovalMissing =
    claim?.wbs_account === 'MF' &&
    !claim?.mf_approval_drive_id &&
    !hasAny(claim?.mf_approval_drive_ids)

  return {
    receipt_count: receipts.length,
    receipt_missing_images_count: receiptMissingImages,
    receipt_missing_bank_link_count: receiptMissingBankLink,
    bank_transaction_count: bankTransactions.length,
    bank_transaction_missing_images_count: bankTransactionMissingImages,
    amount_mismatch_count: amountMismatchCount,
    foreign_receipt_missing_fx_count: foreignReceiptMissingFx,
    mf_approval_missing: mfApprovalMissing,
  }
}

export function getClaimReadiness(claim) {
  const summary = computeSummary(claim)
  const checks = [
    {
      id: 'evidence',
      label: 'Evidence added',
      ok: summary.receipt_count > 0 || summary.bank_transaction_count > 0,
      issue: 'Add at least one receipt or bank transaction',
    },
    {
      id: 'receipt-images',
      label: 'Receipt images attached',
      ok: summary.receipt_missing_images_count === 0,
      issue: `${plural(summary.receipt_missing_images_count, 'receipt')} missing receipt image`,
      hidden: summary.receipt_count === 0,
    },
    {
      id: 'bank-links',
      label: 'Receipts linked to bank transactions',
      ok: summary.receipt_missing_bank_link_count === 0,
      issue: `${plural(summary.receipt_missing_bank_link_count, 'receipt')} not linked to a bank transaction`,
      hidden: summary.receipt_count === 0,
    },
    {
      id: 'bank-images',
      label: 'Bank transaction screenshots attached',
      ok: summary.bank_transaction_missing_images_count === 0,
      issue: `${plural(summary.bank_transaction_missing_images_count, 'bank transaction')} missing screenshot`,
      hidden: summary.bank_transaction_count === 0,
    },
    {
      id: 'amount-mismatch',
      label: 'Receipt totals match bank transactions',
      ok: (summary.amount_mismatch_count ?? 0) === 0,
      issue: `${plural(summary.amount_mismatch_count ?? 0, 'bank transaction')} does not match linked receipt total`,
      hidden: summary.receipt_count === 0 || summary.bank_transaction_count === 0,
    },
    {
      id: 'mf-approval',
      label: 'Master Fund approval attached',
      ok: !summary.mf_approval_missing,
      issue: 'Upload Master Fund approval',
      hidden: claim?.wbs_account !== 'MF',
    },
    {
      id: 'fx-screenshots',
      label: 'Exchange-rate screenshots attached',
      ok: summary.foreign_receipt_missing_fx_count === 0,
      issue: `${plural(summary.foreign_receipt_missing_fx_count, 'foreign-currency receipt')} missing exchange-rate screenshot`,
      hidden: summary.foreign_receipt_missing_fx_count === 0,
    },
  ].filter((check) => !check.hidden)

  const missing = checks.filter((check) => !check.ok)
  return {
    checks,
    missing,
    firstIssue: missing[0] ?? null,
    isReady: missing.length === 0,
  }
}

export function getTreasurerNextStep(claim) {
  const readiness = getClaimReadiness(claim)
  if (claim?.status === 'draft') {
    return readiness.firstIssue?.issue ?? 'Ready to submit for review'
  }
  if (claim?.status === 'attachment_requested') return 'Upload the requested attachment'
  if (claim?.status === 'pending_review') return 'Waiting for finance review'
  if (claim?.status === 'reimbursed') return 'Reimbursed'
  return null
}
