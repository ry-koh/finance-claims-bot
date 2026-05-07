import { useNavigate } from 'react-router-dom'
import { useClaims } from '../api/claims'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_review: 'Under Review',
  email_sent: 'Email Sent',
  screenshot_pending: 'Screenshot Pending',
  screenshot_uploaded: 'Screenshot Uploaded',
  docs_generated: 'Docs Generated',
  compiled: 'Compiled',
  submitted: 'Submitted',
  attachment_requested: 'Attachment Required',
  attachment_uploaded: 'Attachment Submitted',
  reimbursed: 'Reimbursed',
  error: 'Error',
}

const STATUS_BADGE = {
  draft: 'bg-gray-200 text-gray-800',
  pending_review: 'bg-amber-100 text-amber-800',
  email_sent: 'bg-blue-100 text-blue-800',
  screenshot_pending: 'bg-amber-100 text-amber-800',
  screenshot_uploaded: 'bg-orange-100 text-orange-800',
  docs_generated: 'bg-purple-100 text-purple-800',
  compiled: 'bg-indigo-100 text-indigo-800',
  submitted: 'bg-green-100 text-green-800',
  attachment_requested: 'bg-orange-100 text-orange-800',
  attachment_uploaded: 'bg-amber-100 text-amber-800',
  reimbursed: 'bg-teal-100 text-teal-800',
  error: 'bg-red-100 text-red-800',
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatAmount(amount) {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

export default function TreasurerHomePage() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useClaims({ page_size: 200 })
  const claims = data?.items || []

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-900">My Claims</h1>
        <button
          onClick={() => navigate('/claims/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          + New Claim
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-28 mb-3" />
              <div className="flex justify-between">
                <div className="h-3 bg-gray-200 rounded w-20" />
                <div className="h-5 bg-gray-200 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="text-center text-red-500 py-16 text-sm">
          Failed to load claims. Please try again.
        </div>
      ) : claims.length === 0 ? (
        <div className="text-center text-gray-400 py-16 text-sm">
          No claims yet. Tap + New Claim to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <button
              key={claim.id}
              onClick={() => navigate(`/claims/${claim.id}`)}
              className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors"
            >
              {claim.status === 'draft' && claim.rejection_comment && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1 mb-2 font-medium">
                  ⚠ Action required — tap to view feedback
                </div>
              )}
              {claim.status === 'attachment_requested' && (
                <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1 mb-2 font-medium">
                  📎 Action required — additional attachment needed
                </div>
              )}
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900 leading-tight">
                  {claim.reference_code ?? `Claim #${claim.id.slice(0, 8)}`}
                </span>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[claim.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {STATUS_LABELS[claim.status] ?? claim.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate mb-2">{claim.claim_description}</p>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{formatDate(claim.date)}</span>
                <span className="font-medium text-gray-700">{formatAmount(claim.total_amount)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
