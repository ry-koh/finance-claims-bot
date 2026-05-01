import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClaims } from '../api/claims'

// Status definitions: [tabLabel, backendValue, tailwind colour classes for badge]
const STATUSES = [
  { label: 'All',                  value: null,                  badge: 'bg-gray-100 text-gray-700' },
  { label: 'Draft',                value: 'draft',               badge: 'bg-gray-200 text-gray-800' },
  { label: 'Email Sent',           value: 'email_sent',          badge: 'bg-blue-100 text-blue-800' },
  { label: 'Screenshot Pending',   value: 'screenshot_pending',  badge: 'bg-amber-100 text-amber-800' },
  { label: 'Screenshot Uploaded',  value: 'screenshot_uploaded', badge: 'bg-orange-100 text-orange-800' },
  { label: 'Docs Generated',       value: 'docs_generated',      badge: 'bg-purple-100 text-purple-800' },
  { label: 'Compiled',             value: 'compiled',            badge: 'bg-indigo-100 text-indigo-800' },
  { label: 'Submitted',            value: 'submitted',           badge: 'bg-green-100 text-green-800' },
  { label: 'Reimbursed',           value: 'reimbursed',          badge: 'bg-teal-100 text-teal-800' },
]

// Map backend status value → badge classes (includes fallback for 'error')
const STATUS_BADGE = Object.fromEntries(
  STATUSES.filter(s => s.value).map(s => [s.value, s.badge])
)
STATUS_BADGE['error'] = 'bg-red-100 text-red-800'

function badgeClasses(status) {
  return STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700'
}

function formatAmount(amount) {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Skeleton placeholder for a single claim card
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
      <div className="flex justify-between items-start mb-2">
        <div className="h-4 bg-gray-200 rounded w-40" />
        <div className="h-5 bg-gray-200 rounded w-20" />
      </div>
      <div className="h-3 bg-gray-200 rounded w-28 mb-1" />
      <div className="flex justify-between mt-2">
        <div className="h-3 bg-gray-200 rounded w-16" />
        <div className="h-3 bg-gray-200 rounded w-20" />
      </div>
    </div>
  )
}

// A single claim card
function ClaimCard({ claim, onClick }) {
  const statusLabel = STATUSES.find(s => s.value === claim.status)?.label ?? claim.status
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors"
    >
      <div className="flex justify-between items-start gap-2">
        <span className="text-sm font-semibold text-gray-900 break-all leading-tight">
          {claim.reference_code ?? `#${claim.id}`}
        </span>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${badgeClasses(claim.status)}`}>
          {statusLabel}
        </span>
      </div>

      <p className="text-xs text-gray-500 mt-1 truncate">
        {claim.claimer?.name ?? 'Unknown claimer'}
      </p>

      <div className="flex justify-between items-center mt-2">
        <span className="text-sm font-bold text-gray-800">
          {formatAmount(claim.total_amount)}
        </span>
        <span className="text-xs text-gray-400">
          {formatDate(claim.created_at)}
        </span>
      </div>
    </button>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [activeStatus, setActiveStatus] = useState(null) // null = "All"

  // Single broad fetch for counts (always load, regardless of filter)
  const { data: allData, isLoading: allLoading } = useClaims({ page_size: 50 })
  const allItems = allData?.items ?? []

  // Counts per status derived from the broad fetch
  const counts = useMemo(() => {
    const map = {}
    for (const item of allItems) {
      map[item.status] = (map[item.status] ?? 0) + 1
    }
    return map
  }, [allItems])

  // Filtered fetch — re-runs when activeStatus changes
  const params = activeStatus ? { status: activeStatus, page_size: 50 } : { page_size: 50 }
  const { data, isLoading, isError, refetch } = useClaims(params)
  const claims = data?.items ?? []

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-4 pb-2 border-b border-gray-100">
        <h1 className="text-lg font-bold text-gray-900 mb-3">Claims</h1>

        {/* Summary count chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {STATUSES.map(({ label, value }) => {
            const count = value === null
              ? (allData?.total ?? 0)
              : (counts[value] ?? 0)
            const isActive = activeStatus === value
            return (
              <button
                key={label}
                onClick={() => setActiveStatus(value)}
                className={`shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                {label}
                <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-4 rounded-full text-[10px] font-semibold px-1 ${
                  isActive ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {allLoading ? '—' : count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Claims list */}
      <div className="flex-1 px-4 py-3 space-y-3">
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-gray-500 mb-3">Failed to load claims</p>
            <button
              onClick={() => refetch()}
              className="text-sm text-blue-600 font-medium underline"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !isError && claims.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-gray-400 text-sm">
              {activeStatus
                ? 'No claims with this status'
                : 'No claims yet'}
            </p>
            {!activeStatus && (
              <button
                onClick={() => navigate('/claims/new')}
                className="mt-3 text-sm text-blue-600 font-medium"
              >
                Create your first claim
              </button>
            )}
          </div>
        )}

        {!isLoading && !isError && claims.map(claim => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            onClick={() => navigate(`/claims/${claim.id}`)}
          />
        ))}
      </div>
    </div>
  )
}
