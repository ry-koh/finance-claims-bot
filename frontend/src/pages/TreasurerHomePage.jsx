import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClaims } from '../api/claims'
import { IconAlertTriangle, IconPaperclip } from '../components/Icons'
import {
  getTreasurerProgressMessage,
  getTreasurerStatusKey,
  getTreasurerStatusMeta,
  TREASURER_STATUS_META,
} from '../utils/treasurerStatus'

const SECTIONS = [
  { key: 'needs_action', title: 'Needs Action' },
  { key: 'draft', title: 'Draft' },
  { key: 'in_review', title: 'In Review' },
  { key: 'awaiting_submission', title: 'Awaiting Submission' },
  { key: 'submitted', title: 'Submitted' },
  { key: 'reimbursed', title: 'Reimbursed' },
]

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatAmount(amount) {
  if (amount == null) return '-'
  return `$${Number(amount).toFixed(2)}`
}

function SkeletonCard() {
  return (
    <div className="ui-card p-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-28 mb-3" />
      <div className="flex justify-between">
        <div className="h-3 bg-gray-200 rounded w-20" />
        <div className="h-5 bg-gray-200 rounded w-24" />
      </div>
    </div>
  )
}

function ClaimCard({ claim, onClick }) {
  const statusKey = getTreasurerStatusKey(claim)
  const meta = getTreasurerStatusMeta(claim)
  const progressMessage = getTreasurerProgressMessage(claim)
  const isAction = statusKey === 'needs_action'

  return (
    <button
      onClick={onClick}
      className={`ui-card w-full border-l-4 ${meta.border} p-4 text-left active:scale-[0.995]`}
    >
      {claim.status === 'draft' && claim.rejection_comment && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Finance feedback needs your update
        </div>
      )}
      {claim.status === 'attachment_requested' && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700">
          <IconPaperclip className="h-3.5 w-3.5 shrink-0" />
          Additional attachment requested
        </div>
      )}

      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold leading-tight text-gray-900">
          {claim.reference_code ?? `Claim #${claim.id.slice(0, 8)}`}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>
          {meta.label}
        </span>
      </div>

      <p className="mb-2 truncate text-xs text-gray-500">{claim.claim_description || 'No description'}</p>
      {progressMessage && (
        <p className={`mb-2 rounded-lg px-2 py-1 text-xs font-medium ${
          isAction ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'
        }`}>
          {progressMessage}
        </p>
      )}

      <div className="flex items-start justify-between text-xs">
        <span className="text-gray-400">{formatDate(claim.date)}</span>
        <div className="text-right">
          <p className="font-semibold text-gray-800">{formatAmount(claim.total_amount)}</p>
          {claim.submitted_at && (
            <p className="text-emerald-600">Submitted {formatDate(claim.submitted_at)}</p>
          )}
          {claim.reimbursed_at && (
            <p className="text-teal-600">Reimbursed {formatDate(claim.reimbursed_at)}</p>
          )}
        </div>
      </div>
    </button>
  )
}

export default function TreasurerHomePage() {
  const navigate = useNavigate()
  const [showReimbursed, setShowReimbursed] = useState(false)
  const { data, isLoading, isError } = useClaims({ page_size: 200 })
  const claims = data?.items || []

  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(SECTIONS.map((section) => [section.key, []]))
    claims.forEach((claim) => {
      const key = getTreasurerStatusKey(claim)
      ;(buckets[key] ?? buckets.in_review).push(claim)
    })
    return buckets
  }, [claims])

  const needsActionCount = grouped.needs_action.length
  const inReviewCount = grouped.in_review.length + grouped.awaiting_submission.length
  const reimbursedCount = grouped.reimbursed.length

  return (
    <div className="mx-auto max-w-lg p-4">
      <div className="ui-card mb-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">My Claims</h1>
            <p className="text-xs text-gray-500">Draft, review, submission, and reimbursement status.</p>
          </div>
          <button
            onClick={() => navigate('/claims/new')}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white active:bg-blue-700"
          >
            + New Claim
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['Needs Action', needsActionCount, TREASURER_STATUS_META.needs_action.panel],
            ['In Review', inReviewCount, TREASURER_STATUS_META.in_review.panel],
            ['Reimbursed', reimbursedCount, TREASURER_STATUS_META.reimbursed.panel],
          ].map(([label, value, panel]) => (
            <div key={label} className={`rounded-xl border px-3 py-2 ${panel}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-75">{label}</p>
              <p className="text-base font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : isError ? (
        <div className="ui-card px-4 py-12 text-center text-sm text-red-500">
          Failed to load claims. Please try again.
        </div>
      ) : claims.length === 0 ? (
        <div className="ui-card px-4 py-12 text-center">
          <p className="text-sm font-semibold text-gray-700">No claims yet</p>
          <p className="mt-1 text-xs text-gray-500">Tap + New Claim to start your first reimbursement claim.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {SECTIONS.map((section) => {
            const sectionClaims = grouped[section.key] ?? []
            if (sectionClaims.length === 0) return null

            const isReimbursed = section.key === 'reimbursed'
            const isCollapsed = isReimbursed && sectionClaims.length > 3 && !showReimbursed
            const visibleClaims = isCollapsed ? [] : sectionClaims

            return (
              <section key={section.key} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">
                    {section.title}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                    {sectionClaims.length}
                  </span>
                </div>

                {isCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setShowReimbursed(true)}
                    className="ui-card w-full px-4 py-3 text-left text-sm font-semibold text-teal-700 active:bg-teal-50"
                  >
                    Show {sectionClaims.length} reimbursed claims
                  </button>
                ) : (
                  <div className="space-y-2">
                    {visibleClaims.map((claim) => (
                      <ClaimCard
                        key={claim.id}
                        claim={claim}
                        onClick={() => navigate(`/claims/${claim.id}`)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
