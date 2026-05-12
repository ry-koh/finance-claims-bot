import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClaims, useClaimCounts, useBulkUpdateStatus, exportClaims } from '../api/claims'
import { useSendToTelegram } from '../api/documents'
import { getClaimReadiness } from '../utils/claimReadiness'
import { IconPencil } from '../components/Icons'
import { useScrollReveal } from '../hooks/useScrollReveal'

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

const DASHBOARD_FILTERS = [
  { key: 'all', label: 'Total', statuses: null },
  { key: 'review', label: 'Review', statuses: ['pending_review', 'attachment_uploaded'] },
  { key: 'docs', label: 'Docs', statuses: ['email_sent', 'screenshot_pending', 'screenshot_uploaded', 'docs_generated'] },
  { key: 'compiled', label: 'Compiled', statuses: ['compiled'] },
  { key: 'done', label: 'Done', statuses: ['submitted', 'reimbursed'] },
  { key: 'errors', label: 'Errors', statuses: ['error'] },
]

function isCountsMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function countStatuses(counts, statuses, fallback = 0) {
  if (!counts) return fallback
  if (!statuses) {
    return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
  }
  return statuses.reduce((sum, status) => sum + (Number(counts?.[status]) || 0), 0)
}

function badgeClasses(status) {
  return STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700'
}

function formatAmount(amount) {
  if (amount == null) return '-'
  return `$${Number(amount).toFixed(2)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function apiErrorMessage(err, fallback = 'Please try again.') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => item?.msg || item?.message).filter(Boolean)
    if (messages.length > 0) return messages.join(', ')
  }
  return err?.message || fallback
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
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        <label className="text-xs text-gray-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={e => onDateFromChange(e.target.value)}
          className="toolbar-field mt-1 block min-w-0 w-full max-w-full box-border px-2 text-xs outline-none focus:border-blue-400"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-gray-500">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={e => onDateToChange(e.target.value)}
          className="toolbar-field mt-1 block min-w-0 w-full max-w-full box-border px-2 text-xs outline-none focus:border-blue-400"
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
function ClaimCard({ claim, onClick, selectMode, selected, onToggle, revealDelay = 0 }) {
  const { ref, isVisible } = useScrollReveal()
  const statusLabel = STATUSES.find(s => s.value === claim.status)?.label ?? claim.status
  const readiness = getClaimReadiness(claim)
  const claimTitle = claim.claim_description || claim.claimer?.name || claim.one_off_name || 'Untitled claim'
  const orgLabel = claim.cca?.name || claim.claimer?.name || claim.one_off_name || 'Finance claim'
  return (
    <button
      ref={ref}
      onClick={selectMode ? onToggle : onClick}
      style={{ '--reveal-delay': `${revealDelay}ms` }}
      className={`ui-card reveal-card w-full p-3 text-left transition-colors active:bg-gray-50 ${isVisible ? 'reveal-card-visible' : ''}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="finance-ref block truncate">
            {claim.reference_code ?? `#${claim.id}`}
          </span>
          <h3 className="mt-0.5 truncate text-base font-semibold leading-6 text-gray-900">
            {claimTitle}
          </h3>
        </div>
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
          <span className="finance-amount shrink-0">
            {formatAmount(claim.total_amount)}
          </span>
        )}
      </div>

      <p className="mb-3 flex items-center gap-1.5 truncate text-xs text-gray-500">
        <span className="material-symbols-outlined text-[1rem] text-gray-400">groups</span>
        <span className="truncate">{orgLabel}</span>
      </p>
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

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">
          {formatDate(claim.submitted_at || claim.reimbursed_at || claim.created_at)}
        </span>
        <span className={`status-pill ${badgeClasses(claim.status)}`}>
          {statusLabel}
        </span>
      </div>
    </button>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [activeFilterKey, setActiveFilterKey] = useState('all')

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
  const [actionResultTone, setActionResultTone] = useState('success')

  const debouncedSearch = useDebounce(search, 300)
  const activeFilter = DASHBOARD_FILTERS.find((filter) => filter.key === activeFilterKey) || DASHBOARD_FILTERS[0]

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1) }, [activeFilterKey, debouncedSearch, dateFrom, dateTo, pageSize])

  const sendMutation = useSendToTelegram()
  const bulkStatusMutation = useBulkUpdateStatus()

  // Global per-status counts (not filtered by search/date)
  const { data: countsData } = useClaimCounts()

  // Paginated, server-side filtered fetch
  const queryParams = {
    page,
    page_size: pageSize,
    ...(activeFilter.statuses?.length && { statuses: activeFilter.statuses }),
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
  const showSelectionActionBar = selectMode && !confirmAction && !sendMutation.isPending
  const openReimbursementProcess = () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    navigate(`/reimbursements?claim_ids=${encodeURIComponent(ids.join(','))}`)
  }

  const handleConfirm = async () => {
    const action = confirmAction  // capture before clearing
    const ids = [...selectedIds]
    setConfirmAction(null)
    let shouldExitSelectMode = true
    try {
      if (action === 'send') {
        const result = await sendMutation.mutateAsync({ claim_ids: ids })
        const sent = Number(result.sent || 0)
        const skipped = Number(result.skipped || 0)
        if (sent === 0) {
          setActionResultTone('error')
          setActionResult(
            skipped > 0
              ? `Failed to send. ${skipped} selected claim${skipped !== 1 ? 's' : ''} had no compiled PDF or could not be sent.`
              : 'Failed to send. No PDFs were sent.'
          )
          shouldExitSelectMode = false
        } else if (skipped > 0) {
          setActionResultTone('warning')
          setActionResult(`Sent ${sent} PDF${sent !== 1 ? 's' : ''}. ${skipped} failed or had no compiled PDF.`)
        } else {
          setActionResultTone('success')
          setActionResult(`Sent ${sent} PDF${sent !== 1 ? 's' : ''}`)
        }
      } else if (action === 'submit') {
        const result = await bulkStatusMutation.mutateAsync({ claim_ids: ids, status: 'submitted' })
        setActionResultTone('success')
        setActionResult(`Marked ${result.updated} claim${result.updated !== 1 ? 's' : ''} as submitted${result.skipped ? ` - ${result.skipped} skipped` : ''}`)
      }
    } catch (err) {
      setActionResultTone('error')
      setActionResult(`${action === 'send' ? 'Failed to send' : 'Action failed'}: ${apiErrorMessage(err)}`)
      shouldExitSelectMode = false
    }
    if (shouldExitSelectMode) {
      exitSelectMode()
    }
  }

  useEffect(() => {
    if (!actionResult) return
    const t = setTimeout(() => setActionResult(null), actionResultTone === 'error' ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [actionResult, actionResultTone])

  const counts = isCountsMap(countsData) ? countsData : null
  const dashboardFilters = DASHBOARD_FILTERS.map((filter) => ({
    ...filter,
    count: countStatuses(counts, filter.statuses, filter.key === 'all' || filter.key === activeFilterKey ? total : 0),
  }))

  return (
    <div className="mobile-page flex min-h-full flex-col">
      {/* Header */}
      <div className="mobile-header border-b px-4 py-4">
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
                placeholder="Search..."
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
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="section-eyebrow">Claims Dashboard</p>
                <h1 className="mt-1 text-xl font-bold leading-7 text-gray-900">Finance workflow</h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={isExporting}
                  onClick={async () => {
                    setIsExporting(true)
                    try {
                      await exportClaims({
                        statuses: activeFilter.statuses || undefined,
                        search: debouncedSearch.trim() || undefined,
                        date_from: dateFrom || undefined,
                        date_to: dateTo || undefined,
                      })
                    } finally {
                      setIsExporting(false)
                    }
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-40"
                >
                  {isExporting ? 'Exporting...' : 'Export'}
                </button>
                <button onClick={() => setSelectMode(true)}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Select</button>
              </div>
            </div>
            <div className="-mx-4 mb-2 overflow-x-auto px-4 pb-1 scrollbar-none">
              <div className="flex gap-2">
                {dashboardFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setActiveFilterKey(filter.key)}
                    className={`metric-tile min-w-[92px] text-left transition-colors ${
                      activeFilterKey === filter.key ? 'metric-tile-active' : 'metric-tile-neutral'
                    }`}
                  >
                    <p className="section-eyebrow mb-1 text-[10px]">{filter.label}</p>
                    <p className="finance-amount text-gray-900">{filter.count}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {!selectMode && (
          <>
            <div className="mt-3 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[1.15rem] text-gray-400">search</span>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search claims..."
                  className="toolbar-field w-full pl-10 pr-3 text-sm outline-none focus:border-blue-400"
                />
              </label>
              <button
                onClick={() => {
                  if (filterOpen) { setDateFrom(''); setDateTo('') }
                  setFilterOpen(f => !f)
                }}
                className={`filter-pill ${filterOpen ? 'filter-pill-active' : ''}`}
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
              {debouncedSearch.trim() || dateFrom || dateTo || activeFilterKey !== 'all'
                ? 'No claims match your filters'
                : 'No claims yet'}
            </p>
            {activeFilterKey === 'all' && !debouncedSearch.trim() && !dateFrom && !dateTo && (
              <button
                onClick={() => navigate('/claims/new')}
                className="mt-3 text-sm text-blue-600 font-medium"
              >
                Create your first claim
              </button>
            )}
          </div>
        )}

        {!isLoading && !isError && claims.map((claim, index) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            onClick={() => navigate(`/claims/${claim.id}`)}
            selectMode={selectMode}
            selected={selectedIds.has(claim.id)}
            onToggle={() => toggleSelect(claim.id)}
            revealDelay={(index % 5) * 35}
          />
        ))}
      </div>

      {/* Pagination footer */}
      {!selectMode && !isLoading && !isError && (
        <div className="mobile-footer border-t px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {total === 0 ? 'No results' : `${pageStart}-${pageEnd} of ${total}`}
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
                Prev
              </button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
                className="text-sm text-blue-600 disabled:text-gray-300 font-medium px-3 py-1.5 rounded-lg border border-gray-200 disabled:border-gray-100"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating action bar */}
      {showSelectionActionBar && (
        <div className="mobile-footer fixed bottom-0 left-0 right-0 z-[60] flex gap-2 border-t px-4 py-3">
          <button
            disabled={!canSendSelected || sendMutation.isPending}
            onClick={() => canSendSelected && setConfirmAction('send')}
            className="flex-1 bg-blue-600 disabled:bg-blue-300 text-white text-xs font-semibold py-2.5 rounded-xl"
          >
            {sendMutation.isPending ? 'Sending...' : `Send (${selectedIds.size})`}
          </button>
          <button
            disabled={!canSubmitSelected || bulkStatusMutation.isPending}
            onClick={() => canSubmitSelected && setConfirmAction('submit')}
            className="flex-1 bg-green-600 disabled:bg-green-300 text-white text-xs font-semibold py-2.5 rounded-xl"
          >
            {bulkStatusMutation.isPending ? 'Updating...' : `Submitted (${selectedIds.size})`}
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
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-[80]">
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl px-8 py-6 flex flex-col items-center gap-3 mx-4">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-gray-800">Sending to Telegram...</p>
            <p className="text-xs text-gray-500 text-center">Uploading PDFs - this may take 1-2 minutes</p>
          </div>
        </div>
      )}

      {/* Toast */}
      {actionResult && (
        <div
          className={`fixed top-4 left-4 right-4 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-[90] text-center ${
            actionResultTone === 'error'
              ? 'bg-red-700'
              : actionResultTone === 'warning'
                ? 'bg-amber-700'
                : 'bg-gray-900'
          }`}
        >
          {actionResult}
        </div>
      )}
    </div>
  )
}
