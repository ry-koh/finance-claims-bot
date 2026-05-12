import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClaims, useClaimCounts, useBulkUpdateStatus, exportClaims } from '../api/claims'
import { useSendToTelegram } from '../api/documents'
import { getClaimReadiness } from '../utils/claimReadiness'
import { IconPencil } from '../components/Icons'

// Status definitions: [tabLabel, backendValue, tailwind colour classes for badge]
const STATUSES = [
  { label: 'All',                  value: null,                  badge: 'bg-gray-100 text-gray-700' },
  { label: 'Pending Review',       value: 'pending_review',      badge: 'bg-amber-100 text-amber-800' },
  { label: 'Email Sent',           value: 'email_sent',          badge: 'bg-blue-100 text-blue-800' },
  { label: 'Screenshot Pending',   value: 'screenshot_pending',  badge: 'bg-amber-100 text-amber-800' },
  { label: 'Screenshot Uploaded',  value: 'screenshot_uploaded', badge: 'bg-orange-100 text-orange-800' },
  { label: 'Docs Generated',       value: 'docs_generated',      badge: 'bg-purple-100 text-purple-800' },
  { label: 'Compiled',             value: 'compiled',            badge: 'bg-indigo-100 text-indigo-800' },
  { label: 'Submitted',            value: 'submitted',           badge: 'bg-green-100 text-green-800' },
  { label: 'Attach. Requested',    value: 'attachment_requested',  badge: 'bg-orange-100 text-orange-800' },
  { label: 'Attach. Uploaded',     value: 'attachment_uploaded',   badge: 'bg-blue-100 text-blue-800' },
  { label: 'Reimbursed',           value: 'reimbursed',          badge: 'bg-teal-100 text-teal-800' },
]

const STATUS_BADGE = Object.fromEntries(
  STATUSES.filter(s => s.value).map(s => [s.value, s.badge])
)
STATUS_BADGE['error'] = 'bg-red-100 text-red-800'

const STATUS_BORDER = {
  draft: 'border-l-gray-300',
  pending_review: 'border-l-amber-400',
  email_sent: 'border-l-blue-400',
  screenshot_pending: 'border-l-amber-400',
  screenshot_uploaded: 'border-l-orange-400',
  docs_generated: 'border-l-purple-400',
  compiled: 'border-l-indigo-400',
  submitted: 'border-l-green-500',
  attachment_requested: 'border-l-orange-500',
  attachment_uploaded: 'border-l-blue-500',
  reimbursed: 'border-l-teal-500',
  error: 'border-l-red-500',
}

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

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(h)
  }, [value, delay])
  return debounced
}

function DateRangeFilter({ dateFrom, dateTo, onDateFromChange, onDateToChange }) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
      <div className="min-w-0">
        <label className="text-xs text-gray-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={e => onDateFromChange(e.target.value)}
          className="mt-0.5 block min-w-0 w-full max-w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-gray-500">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={e => onDateToChange(e.target.value)}
          className="mt-0.5 block min-w-0 w-full max-w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
        />
      </div>
    </div>
  )
}

// Skeleton placeholder for a single claim card
function SkeletonCard() {
  return (
    <div className="ui-card p-4 animate-pulse">
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
  const borderColor = STATUS_BORDER[claim.status] ?? 'border-l-gray-200'
  const readiness = getClaimReadiness(claim)
  return (
    <button
      onClick={selectMode ? onToggle : onClick}
      className={`ui-card w-full border-l-4 ${borderColor} p-3 text-left active:bg-gray-50 transition-colors`}
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

      <p className="text-xs text-gray-500 mt-0.5 truncate">
        {claim.claimer?.name || claim.one_off_name || 'Unknown claimer'}
      </p>
      {claim.claim_description && (
        <p className="text-xs text-gray-400 truncate">{claim.claim_description}</p>
      )}
      {claim.internal_notes && (
        <p className="mt-1 flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
          <IconPencil className="h-3 w-3 shrink-0" />
          <span className="truncate">{claim.internal_notes}</span>
        </p>
      )}
      {readiness.firstIssue && ['draft', 'pending_review', 'email_sent', 'screenshot_pending'].includes(claim.status) && (
        <p className="mt-1 truncate rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 bg-amber-50">
          Missing: {readiness.firstIssue.issue}
        </p>
      )}

      <div className="flex justify-between items-start mt-2">
        <span className="text-sm font-bold text-gray-800">
          {formatAmount(claim.total_amount)}
        </span>
        <div className="text-right text-xs">
          {claim.submitted_at && (
            <p className="text-green-600">Submitted {formatDate(claim.submitted_at)}</p>
          )}
          {claim.reimbursed_at && (
            <p className="text-teal-600">Reimbursed {formatDate(claim.reimbursed_at)}</p>
          )}
          {!claim.submitted_at && !claim.reimbursed_at && (
            <p className="text-gray-400">{formatDate(claim.created_at)}</p>
          )}
        </div>
      </div>
    </button>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [activeStatus, setActiveStatus] = useState(null)

  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isExporting, setIsExporting] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // 'send' | 'submit' | null
  const [actionResult, setActionResult] = useState(null)

  const tabsRef = useRef(null)

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const onWheel = (e) => {
      if (e.deltaY === 0 && e.deltaX === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const debouncedSearch = useDebounce(search, 300)

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1) }, [activeStatus, debouncedSearch, dateFrom, dateTo, pageSize])

  const sendMutation = useSendToTelegram()
  const bulkStatusMutation = useBulkUpdateStatus()

  // Global per-status counts (not filtered by search/date)
  const { data: countsData } = useClaimCounts()

  // Paginated, server-side filtered fetch
  const queryParams = {
    page,
    page_size: pageSize,
    ...(activeStatus && { status: activeStatus }),
    ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  }
  const { data, isLoading, isError, refetch } = useClaims(queryParams)
  const claims = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, total)

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const selectedClaims = claims.filter((c) => selectedIds.has(c.id))
  const canSendSelected = selectedIds.size > 0
  const canSubmitSelected = selectedClaims.some((c) => c.status === 'compiled')
  const canReimburseSelected = selectedClaims.some((c) => c.status === 'submitted')
  const openReimbursementProcess = () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    navigate(`/reimbursements?claim_ids=${encodeURIComponent(ids.join(','))}`)
  }

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
        setActionResult(`Marked ${result.updated} claim${result.updated !== 1 ? 's' : ''} as submitted${result.skipped ? ` · ${result.skipped} skipped` : ''}`)
      }
    } catch {
      setActionResult('Action failed. Please try again.')
    }
    exitSelectMode()
  }

  useEffect(() => {
    if (!actionResult) return
    const t = setTimeout(() => setActionResult(null), 3000)
    return () => clearTimeout(t)
  }, [actionResult])

  const allCount = Object.values(countsData ?? {}).reduce((a, b) => a + b, 0)
  const reviewQueue = (countsData?.pending_review ?? 0) + (countsData?.attachment_uploaded ?? 0)
  const documentQueue =
    (countsData?.email_sent ?? 0) +
    (countsData?.screenshot_pending ?? 0) +
    (countsData?.screenshot_uploaded ?? 0) +
    (countsData?.docs_generated ?? 0)
  const completedCount = (countsData?.submitted ?? 0) + (countsData?.reimbursed ?? 0)

  return (
    <div className="mobile-page flex min-h-full flex-col">
      {/* Header */}
      <div className="mobile-header border-b px-4 pt-4 pb-3">
        {/* Header row */}
        {selectMode ? (
          <div className="space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
              <div className="flex gap-3">
                <button onClick={() => setSelectedIds(new Set(claims.map(c => c.id)))}
                  className="text-xs text-blue-600 font-medium">Select All</button>
                <button onClick={exitSelectMode}
                  className="text-xs text-gray-500 font-medium">Cancel</button>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
              />
              <button
                onClick={() => {
                  if (filterOpen) { setDateFrom(''); setDateTo('') }
                  setFilterOpen(f => !f)
                }}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterOpen ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'}`}
              >
                Filter
              </button>
            </div>
            {filterOpen && (
              <DateRangeFilter
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-lg font-bold text-gray-900">Claims</h1>
                <p className="text-xs text-gray-400">Finance workflow queue</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  disabled={isExporting}
                  onClick={async () => {
                    setIsExporting(true)
                    try {
                      await exportClaims({
                        status: activeStatus,
                        search: debouncedSearch.trim() || undefined,
                        date_from: dateFrom || undefined,
                        date_to: dateTo || undefined,
                      })
                    } finally {
                      setIsExporting(false)
                    }
                  }}
                  className="text-sm text-gray-500 font-medium disabled:opacity-40"
                >
                  {isExporting ? 'Exporting…' : 'Export'}
                </button>
                <button onClick={() => setSelectMode(true)}
                  className="text-sm text-blue-600 font-medium">Select</button>
              </div>
            </div>
            <div className="-mx-4 mb-2 overflow-x-auto px-4 pb-1 scrollbar-none">
              <div className="flex gap-2">
                {[
                  ['Total', allCount],
                  ['Review', reviewQueue],
                  ['Docs', documentQueue],
                  ['Done', completedCount],
                  ['Errors', countsData?.error ?? 0],
                  ['Compiled', countsData?.compiled ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-[76px] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                    <p className="text-sm font-bold text-gray-900 tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!selectMode && (
          <>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ref code or claimer…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
              />
              <button
                onClick={() => {
                  if (filterOpen) { setDateFrom(''); setDateTo('') }
                  setFilterOpen(f => !f)
                }}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterOpen ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'}`}
              >
                Filter
              </button>
            </div>
            {filterOpen && (
              <div className="mt-2">
                <DateRangeFilter
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                />
              </div>
            )}
          </>
        )}

        {/* Status filter pills */}
        {!selectMode && (
          <div
            ref={tabsRef}
            className="mt-2 -mx-4 px-4 overflow-x-auto flex gap-1.5 pb-1 scrollbar-none"
          >
            {STATUSES.map(({ label, value }) => {
              const isActive = activeStatus === value
              const count = value === null ? allCount : (countsData?.[value] ?? 0)
              return (
                <button
                  key={label}
                  onClick={() => setActiveStatus(value)}
                  className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {label}{countsData ? ` ${count}` : ''}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Claims list */}
      <div className={`flex-1 px-4 py-3 space-y-3${selectMode ? ' pb-24' : ''}`}>
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
              {debouncedSearch.trim() || dateFrom || dateTo || activeStatus
                ? 'No claims match your filters'
                : 'No claims yet'}
            </p>
            {!activeStatus && !debouncedSearch.trim() && !dateFrom && !dateTo && (
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
            selectMode={selectMode}
            selected={selectedIds.has(claim.id)}
            onToggle={() => toggleSelect(claim.id)}
          />
        ))}
      </div>

      {/* Pagination footer */}
      {!selectMode && !isLoading && !isError && (
        <div className="mobile-footer border-t px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {total === 0 ? 'No results' : `${pageStart}–${pageEnd} of ${total}`}
            </span>
            <div className="flex gap-1">
              {[20, 50, 100].map(n => (
                <button
                  key={n}
                  onClick={() => setPageSize(n)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    pageSize === n
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="text-sm text-blue-600 disabled:text-gray-300 font-medium px-3 py-1.5 rounded-lg border border-gray-200 disabled:border-gray-100"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
                className="text-sm text-blue-600 disabled:text-gray-300 font-medium px-3 py-1.5 rounded-lg border border-gray-200 disabled:border-gray-100"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating action bar */}
      {selectMode && (
        <div className="mobile-footer fixed bottom-0 left-0 right-0 z-40 flex gap-2 border-t px-4 py-3">
          <button
            disabled={!canSendSelected || sendMutation.isPending}
            onClick={() => canSendSelected && setConfirmAction('send')}
            className="flex-1 bg-blue-600 disabled:bg-blue-300 text-white text-xs font-semibold py-2.5 rounded-xl"
          >
            {sendMutation.isPending ? 'Sending…' : `Send (${selectedIds.size})`}
          </button>
          <button
            disabled={!canSubmitSelected || bulkStatusMutation.isPending}
            onClick={() => canSubmitSelected && setConfirmAction('submit')}
            className="flex-1 bg-green-600 disabled:bg-green-300 text-white text-xs font-semibold py-2.5 rounded-xl"
          >
            {bulkStatusMutation.isPending ? 'Updating…' : `Submitted (${selectedIds.size})`}
          </button>
          <button
            disabled={!canReimburseSelected}
            onClick={() => canReimburseSelected && openReimbursementProcess()}
            className="flex-1 bg-teal-600 disabled:bg-teal-300 text-white text-xs font-semibold py-2.5 rounded-xl"
          >
            Process ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-5 shadow-xl mb-4 mx-4">
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

      {/* Sending overlay */}
      {sendMutation.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl px-8 py-6 flex flex-col items-center gap-3 mx-4">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-gray-800">Sending to Telegram…</p>
            <p className="text-xs text-gray-500 text-center">Uploading PDFs — this may take 1–2 minutes</p>
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
