import test from 'node:test'
import assert from 'node:assert/strict'

import { getClaimReadiness } from './claimReadiness.js'

function claim(overrides = {}) {
  return {
    total_amount: 12.5,
    remarks: '',
    wbs_account: 'SA',
    transport_form_needed: false,
    receipts: [],
    bank_transactions: [],
    ...overrides,
  }
}

function receipt(overrides = {}) {
  return {
    id: 'receipt-1',
    receipt_no: 'INV-1',
    description: "Master's Gift to Bryan Ong",
    date: '2026-05-14',
    amount: 12.5,
    payer_name: 'Bryan Ong',
    payer_email: 'bryan@example.com',
    images: [{ id: 'image-1' }],
    bank_transaction_id: 'bt-1',
    is_foreign_currency: false,
    ...overrides,
  }
}

function bankTransaction(overrides = {}) {
  return {
    id: 'bt-1',
    amount: 12.5,
    images: [{ id: 'bank-image-1' }],
    refunds: [],
    ...overrides,
  }
}

function issueIds(readiness, key = 'blockers') {
  return new Set(readiness[key].map((issue) => issue.id))
}

test('bank-only claims do not require receipt images when explained', () => {
  const readiness = getClaimReadiness(claim({
    remarks: '- Supplier did not provide a receipt.',
    receipts: [receipt({ receipt_no: 'BT1', images: [] })],
    bank_transactions: [bankTransaction()],
  }))

  assert.equal(readiness.canSubmit, true)
  assert.equal(issueIds(readiness).has('receipt-images'), false)
  assert.equal(issueIds(readiness).has('bank-only-explanation'), false)
})

test('bank-only claims require a no-receipt explanation', () => {
  const readiness = getClaimReadiness(claim({
    receipts: [receipt({ receipt_no: 'BT1', images: [] })],
    bank_transactions: [bankTransaction()],
  }))

  assert.equal(readiness.canSubmit, false)
  assert.equal(issueIds(readiness).has('bank-only-explanation'), true)
})

test('cash receipt without bank transaction is a warning, not a blocker', () => {
  const readiness = getClaimReadiness(claim({
    receipts: [receipt({ bank_transaction_id: null })],
  }))

  assert.equal(readiness.canSubmit, true)
  assert.equal(issueIds(readiness, 'warnings').has('bank-links'), true)
})

test('amount mismatch is a warning, not a blocker', () => {
  const readiness = getClaimReadiness(claim({
    receipts: [receipt({ amount: 10 })],
    bank_transactions: [bankTransaction({ amount: 12.5 })],
  }))

  assert.equal(readiness.canSubmit, true)
  assert.equal(issueIds(readiness, 'warnings').has('amount-mismatch'), true)
})
