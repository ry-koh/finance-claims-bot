import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClaims, useBulkUpdateStatus } from '../api/claims'
import { useSendToTelegram } from '../api/documents'

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
function ClaimCard({ claim, onClick, selectMode, selected, onToggle }) {
  const statusLabel = STATUSES.find(s => s.value === claim.status)?.label ?? claim.status
  return (
    <button
      onClick={selectMode ? onToggle : onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors"
    >
      <div className="flex justify-between items-start gap-2">
        <span className="text-sm font-semibold text-gray-900 break-all leading-tight">
          {claim.reference_code ?? `#${claim.id}`}
        </span>
        {selectMode ? (
          selected ? (
            <div className="shrink-0 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          ) : (
            <div className="shrink-0 w-5 h-5 rounded-full border-2 border-gray-300" />
          )
        ) : (
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${badgeClasses(claim.status)}`}>
            {statusLabel}
          </span>
        )}
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

  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmAction, setConfirmAction] = useState(null) // 'send' | 'submit' | null
  const [actionResult, setActionResult] = useState(null)

  const sendMutation = useSendToTelegram()
  const bulkStatusMutation = useBulkUpdateStatus()

  // Single broad fetch for counts (always load, regardless of filter)
  const { data: allData, isLoading: allLoading } = useClaims({ page_size: 500 })
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
  const params = activeStatus ? { status: activeStatus, page_size: 500 } : { page_size: 500 }
  const { data, isLoading, isError, refetch } = useClaims(params)
  const claims = data?.items ?? []

  const filteredClaims = useMemo(() => {
    let result = claims
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(c =>
        (c.reference_code ?? '').toLowerCase().includes(q) ||
        (c.claimer?.cca?.name ?? '').toLowerCase().includes(q) ||
        (c.claimer?.cca?.portfolio?.name ?? '').toLowerCase().includes(q)
      )
    }
    if (dateFrom) {
      result = result.filter(c => c.created_at >= dateFrom)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setDate(to.getDate() + 1)
      result = result.filter(c => new Date(c.created_at) < to)
    }
    return result
  }, [claims, search, dateFrom, dateTo])

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }

  const handleConfirm = async () => {
    const action = confirmAction  // capture before clearing
    const ids = [...selectedIds]
    setConfirmAction(null)
    try {
      if (action === 'send') {
        const result = await sendMutation.mutateAsync({ claim_ids: ids })
        setActionResult(`Sent ${result.sent} PDF${result.sent !== 1 ? 's' : ''}${result.skipped ? ` · ${result.skipped} skipped` : ''}`)
      } else if (action === 'submit') {
        const result = await bulkStatusMutation.mutateAsync({ claim_ids: ids, status: 'submitted' })
        setActionResult(`Marked ${result.updated} claim${result.updated !== 1 ? 's' : ''} as submitted`)
      }
    } catch (e) {
      setActionResult('Action failed. Please try again.')
    }
    exitSelectMode()
  }

  useEffect(() => {
    if (!actionResult) return
    const t = setTimeout(() => setActionResult(null), 3000)
    return () => clearTimeout(t)
  }, [actionResult])

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-4 pb-2 border-b border-gray-100">
        {/* Header row */}
        {selectMode ? (
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
            <div className="flex gap-3">
              <button onClick={() => setSelectedIds(new Set(filteredClaims.map(c => c.id)))}
                className="text-xs text-blue-600 font-medium">Select All</button>
              <button onClick={exitSelectMode}
                className="text-xs text-gray-500 font-medium">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Claims</h1>
            <button onClick={() => setSelectMode(true)}
              className="text-sm text-blue-600 font-medium">Select</button>
          </div>
        )}

        {!selectMode && (
          <>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ref code, CCA, portfolio…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
              />
              <button
                onClick={() => setFilterOpen(f => !f)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterOpen ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'}`}
              >
                Filter
              </button>
            </div>
            {filterOpen && (
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 mt-0.5" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 mt-0.5" />
                </div>
              </div>
            )}
          </>
        )}

        {/* Summary count chips */}
        {!selectMode && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none mt-2">
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
        )}
      </div>

      {/* Claims list */}
      <div className={`flex-1 px-4 py-3 space-y-3${selectMode ? ' pb-20' : ''}`}>
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

        {!isLoading && !isError && filteredClaims.length === 0 && (
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

        {!isLoading && !isError && filteredClaims.map(claim => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            onClick={() => navigate(`/claims/${claim.id}`)}
            selectMode={selectMode}
            selected={selectedIds.has(claim.id)}
            onToggle={() => toggleSelect(claim.id)}
          />
        ))}
      </div>

      {/* Floating action bar */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3 shadow-lg z-40">
          <button
            disabled={selectedIds.size === 0 || sendMutation.isPending}
            onClick={() => selectedIds.size > 0 && setConfirmAction('send')}
            className="flex-1 bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold py-2.5 rounded-xl"
          >
            {sendMutation.isPending ? 'Sending…' : `Send (${selectedIds.size})`}
          </button>
          <button
            disabled={selectedIds.size === 0 || bulkStatusMutation.isPending}
            onClick={() => selectedIds.size > 0 && setConfirmAction('submit')}
            className="flex-1 bg-green-600 disabled:bg-green-300 text-white text-sm font-semibold py-2.5 rounded-xl"
          >
            {bulkStatusMutation.isPending ? 'Updating…' : `Mark Submitted (${selectedIds.size})`}
          </button>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl mb-4 mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              {confirmAction === 'send' ? 'Send to Telegram?' : 'Mark as Submitted?'}
            </h3>
            <p className="text-sm text-gray-500 mb-5">
              {confirmAction === 'send'
                ? `Send ${selectedIds.size} compiled PDF${selectedIds.size !== 1 ? 's' : ''} to yourself on Telegram. Claims without a compiled PDF will be skipped.`
                : `Mark ${selectedIds.size} claim${selectedIds.size !== 1 ? 's' : ''} as submitted.`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">
                Cancel
              </button>
              <button onClick={handleConfirm}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {actionResult && (
        <div className="fixed top-4 left-4 right-4 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50 text-center">
          {actionResult}
        </div>
      )}
    </div>
  )
}
