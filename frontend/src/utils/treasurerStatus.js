import { getClaimReadiness } from './claimReadiness'

export const TREASURER_STATUS_ORDER = [
  'needs_action',
  'draft',
  'in_review',
  'awaiting_submission',
  'submitted',
  'reimbursed',
]

export const TREASURER_STATUS_META = {
  needs_action: {
    label: 'Needs Action',
    badge: 'bg-amber-100 text-amber-800',
    border: 'border-l-amber-500',
    panel: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  draft: {
    label: 'Draft',
    badge: 'bg-slate-100 text-slate-700',
    border: 'border-l-slate-300',
    panel: 'bg-slate-50 border-slate-200 text-slate-700',
  },
  in_review: {
    label: 'In Review',
    badge: 'bg-blue-100 text-blue-800',
    border: 'border-l-blue-500',
    panel: 'bg-blue-50 border-blue-200 text-blue-800',
  },
  awaiting_submission: {
    label: 'Awaiting Submission',
    badge: 'bg-indigo-100 text-indigo-800',
    border: 'border-l-indigo-500',
    panel: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  },
  submitted: {
    label: 'Submitted',
    badge: 'bg-emerald-100 text-emerald-800',
    border: 'border-l-emerald-500',
    panel: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  reimbursed: {
    label: 'Reimbursed',
    badge: 'bg-teal-100 text-teal-800',
    border: 'border-l-teal-500',
    panel: 'bg-teal-50 border-teal-200 text-teal-800',
  },
}

const IN_REVIEW_STATUSES = new Set([
  'pending_review',
  'email_sent',
  'screenshot_pending',
  'screenshot_uploaded',
  'docs_generated',
  'attachment_uploaded',
])

export function getTreasurerStatusKey(claim) {
  if (!claim) return 'draft'
  if (claim.status === 'reimbursed') return 'reimbursed'
  if (claim.status === 'submitted') return 'submitted'
  if (claim.status === 'compiled') return 'awaiting_submission'
  if (claim.status === 'attachment_requested' || claim.status === 'error') return 'needs_action'
  if (IN_REVIEW_STATUSES.has(claim.status)) return 'in_review'

  if (claim.status === 'draft') {
    const readiness = getClaimReadiness(claim)
    if (claim.rejection_comment || readiness.firstIssue) return 'needs_action'
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
  const readiness = getClaimReadiness(claim)

  if (key === 'needs_action') {
    if (claim?.status === 'attachment_requested') return 'Upload the requested attachment.'
    if (claim?.status === 'error') return 'Finance needs to retry processing this claim.'
    if (claim?.rejection_comment) return 'Review finance feedback and update the claim.'
    return readiness.firstIssue?.issue ?? 'Action required before finance can process this.'
  }
  if (key === 'draft') return 'Ready to submit for finance review.'
  if (key === 'in_review') return 'Finance is checking this claim.'
  if (key === 'awaiting_submission') return 'Finance has compiled the claim and is preparing submission.'
  if (key === 'submitted') return 'Submitted for reimbursement processing.'
  if (key === 'reimbursed') return 'Reimbursement completed.'
  return ''
}
