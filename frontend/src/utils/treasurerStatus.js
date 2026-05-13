import { getClaimReadiness } from './claimReadiness.js'

export const TREASURER_STATUS_ORDER = [
  'needs_action',
  'draft',
  'in_review',
  'send_email',
  'awaiting_submission',
  'submitted',
  'reimbursed',
]

export const TREASURER_STATUS_META = {
  needs_action: {
    label: 'Needs Action',
    badge: 'treasurer-status-badge bg-amber-100 text-amber-800',
    border: 'border-l-amber-500',
    panel: 'treasurer-status-panel bg-amber-50 border-amber-200 text-amber-800',
  },
  draft: {
    label: 'Not Submitted',
    badge: 'treasurer-status-badge bg-slate-100 text-slate-700',
    border: 'border-l-slate-300',
    panel: 'treasurer-status-panel bg-slate-50 border-slate-200 text-slate-700',
  },
  in_review: {
    label: 'In Review',
    badge: 'treasurer-status-badge bg-blue-100 text-blue-800',
    border: 'border-l-blue-500',
    panel: 'treasurer-status-panel bg-blue-50 border-blue-200 text-blue-800',
  },
  send_email: {
    label: 'Send Email',
    badge: 'treasurer-status-badge bg-orange-100 text-orange-800',
    border: 'border-l-orange-500',
    panel: 'treasurer-status-panel bg-orange-50 border-orange-200 text-orange-800',
  },
  awaiting_submission: {
    label: 'Awaiting Submission',
    badge: 'treasurer-status-badge bg-indigo-100 text-indigo-800',
    border: 'border-l-indigo-500',
    panel: 'treasurer-status-panel bg-indigo-50 border-indigo-200 text-indigo-800',
  },
  submitted: {
    label: 'Submitted',
    badge: 'treasurer-status-badge bg-emerald-100 text-emerald-800',
    border: 'border-l-emerald-500',
    panel: 'treasurer-status-panel bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  reimbursed: {
    label: 'Reimbursed',
    badge: 'treasurer-status-badge bg-teal-100 text-teal-800',
    border: 'border-l-teal-500',
    panel: 'treasurer-status-panel bg-teal-50 border-teal-200 text-teal-800',
  },
}

const TREASURER_BLOCKING_CHECK_IDS = new Set([
  'evidence',
  'receipt-images',
  'bank-images',
  'fx-screenshots',
])

function firstTreasurerBlockingIssue(claim) {
  const readiness = getClaimReadiness(claim)
  return readiness.missing.find((check) => TREASURER_BLOCKING_CHECK_IDS.has(check.id)) ?? null
}

const IN_REVIEW_STATUSES = new Set([
  'pending_review',
  'screenshot_uploaded',
  'docs_generated',
  'attachment_uploaded',
])

const SEND_EMAIL_STATUSES = new Set([
  'email_sent',
  'screenshot_pending',
])

export function getTreasurerStatusKey(claim) {
  if (!claim) return 'draft'
  if (claim.status === 'reimbursed') return 'reimbursed'
  if (claim.status === 'submitted') return 'submitted'
  if (claim.status === 'compiled') return 'awaiting_submission'
  if (claim.status === 'attachment_requested' || claim.status === 'error') return 'needs_action'
  if (SEND_EMAIL_STATUSES.has(claim.status)) return 'send_email'
  if (IN_REVIEW_STATUSES.has(claim.status)) return 'in_review'

  if (claim.status === 'draft') {
    if (claim.rejection_comment || firstTreasurerBlockingIssue(claim)) return 'needs_action'
    return 'draft'
  }

  return 'in_review'
}

export function getTreasurerStatusMeta(claim) {
  return TREASURER_STATUS_META[getTreasurerStatusKey(claim)] ?? TREASURER_STATUS_META.in_review
}

export function getTreasurerStatusLabel(claim) {
  return getTreasurerStatusMeta(claim).label
}

export function getTreasurerProgressMessage(claim) {
  const key = getTreasurerStatusKey(claim)

  if (key === 'needs_action') {
    if (claim?.status === 'attachment_requested') return 'Upload the requested attachment.'
    if (claim?.status === 'error') return 'Finance needs to retry processing this claim.'
    if (claim?.rejection_comment) return 'Review finance feedback and update the claim.'
    return firstTreasurerBlockingIssue(claim)?.issue ?? 'This claim has not been sent to finance yet.'
  }
  if (key === 'draft') return 'This claim has not been sent to finance yet. Submit it for review when ready.'
  if (key === 'in_review') return 'Finance is checking this claim.'
  if (key === 'send_email') return 'Finance approved this claim. Send the confirmation email.'
  if (key === 'awaiting_submission') return 'Finance has compiled the claim and is preparing submission.'
  if (key === 'submitted') return 'Submitted for reimbursement processing.'
  if (key === 'reimbursed') return 'Reimbursement completed.'
  return ''
}
