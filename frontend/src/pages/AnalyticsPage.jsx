import { useMemo, useState } from 'react'
import { useAnalyticsSummary, useAnalyticsFundBreakdown } from '../api/analytics'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  email_sent: 'Email Sent',
  screenshot_pending: 'Screenshot Pending',
  screenshot_uploaded: 'Screenshot Uploaded',
  docs_generated: 'Docs Generated',
  compiled: 'Compiled',
  submitted: 'Submitted',
  reimbursed: 'Reimbursed',
  error: 'Error',
}

const ALL_STATUSES = Object.keys(STATUS_LABELS)

const GROUP_BY_OPTIONS = [
  ['cca', 'CCA', 'Treasurer-facing spend by CCA'],
  ['portfolio', 'Portfolio', 'Portfolio totals'],
  ['fund', 'Fund', 'SA, MF, and other funds'],
  ['portfolio_fund', 'Portfolio + Fund', 'SA/MF by portfolio'],
  ['cca_fund', 'CCA + Fund', 'SA/MF by CCA'],
]

function fmt(amount) {
  return `$${Number(amount || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtRaw(amount) {
  return Number(amount || 0).toFixed(2)
}

function escapeCSV(val) {
  const s = String(val ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCSV(groupBy, isFundBreakdown, data) {
  const rows = []
  if (isFundBreakdown) {
    const hasPortfolio = groupBy === 'cca_fund'
    rows.push(hasPortfolio ? ['Name', 'Portfolio', 'SA', 'MF', 'Total'] : ['Name', 'SA', 'MF', 'Total'])
    data.rows.forEach((r) => {
      rows.push(hasPortfolio
        ? [r.name, r.portfolio ?? '', fmtRaw(r.sa_total), fmtRaw(r.mf_total), fmtRaw((r.sa_total ?? 0) + (r.mf_total ?? 0))]
        : [r.name, fmtRaw(r.sa_total), fmtRaw(r.mf_total), fmtRaw((r.sa_total ?? 0) + (r.mf_total ?? 0))])
    })
    rows.push(hasPortfolio
      ? ['Grand Total', '', fmtRaw(data.sa_total), fmtRaw(data.mf_total), fmtRaw(data.grand_total)]
      : ['Grand Total', fmtRaw(data.sa_total), fmtRaw(data.mf_total), fmtRaw(data.grand_total)])
  } else {
    const hasPortfolio = groupBy === 'cca'
    rows.push(hasPortfolio ? ['Name', 'Portfolio', 'Total'] : ['Name', 'Total'])
    data.rows.forEach((r) => {
      rows.push(hasPortfolio ? [r.name, r.portfolio ?? '', fmtRaw(r.total)] : [r.name, fmtRaw(r.total)])
    })
    rows.push(hasPortfolio ? ['Grand Total', '', fmtRaw(data.grand_total)] : ['Grand Total', fmtRaw(data.grand_total)])
  }
  return rows.map((r) => r.map(escapeCSV).join(',')).join('\r\n')
}

function downloadCSV(groupBy, isFundBreakdown, data, dateFrom, dateTo) {
  const csv = buildCSV(groupBy, isFundBreakdown, data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const label = GROUP_BY_OPTIONS.find(([v]) => v === groupBy)?.[1] ?? groupBy
  const datePart = dateFrom || dateTo ? `_${dateFrom || ''}_${dateTo || ''}` : ''
  a.href = url
  a.download = `analytics_${label.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${datePart}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function rowTotal(row, isFundBreakdown) {
  if (isFundBreakdown) return Number(row.sa_total || 0) + Number(row.mf_total || 0)
  return Number(row.total || 0)
}

function groupRowsByPortfolio(rows, isFundBreakdown) {
  const map = {}
  rows.forEach((row) => {
    const key = row.portfolio ?? '(No Portfolio)'
    if (!map[key]) {
      map[key] = { portfolio: key, rows: [], subtotal: 0, sa_subtotal: 0, mf_subtotal: 0 }
    }
    map[key].rows.push(row)
    map[key].subtotal += rowTotal(row, isFundBreakdown)
    map[key].sa_subtotal += Number(row.sa_total || 0)
    map[key].mf_subtotal += Number(row.mf_total || 0)
  })
  return Object.values(map)
}

function analyticsStats(data, isFundBreakdown) {
  const rows = data?.rows ?? []
  const grandTotal = Number(data?.grand_total || 0)
  const ranked = [...rows].sort((a, b) => rowTotal(b, isFundBreakdown) - rowTotal(a, isFundBreakdown))
  const top = ranked[0] ?? null
  const average = rows.length ? grandTotal / rows.length : 0
  const saTotal = isFundBreakdown ? Number(data?.sa_total || 0) : 0
  const mfTotal = isFundBreakdown ? Number(data?.mf_total || 0) : 0

  return {
    rows,
    ranked,
    grandTotal,
    rowCount: rows.length,
    top,
    topTotal: top ? rowTotal(top, isFundBreakdown) : 0,
    average,
    saTotal,
    mfTotal,
    maxTotal: ranked.length ? rowTotal(ranked[0], isFundBreakdown) : 0,
  }
}

function KpiTile({ label, value, note, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'border-gray-200 bg-white',
    accent: 'border-blue-200 bg-blue-50',
    good: 'border-green-200 bg-green-50',
    warn: 'border-amber-200 bg-amber-50',
  }[tone]

  return (
    <div className={`min-w-0 rounded-xl border p-3 ${toneClass}`}>
      <p className="section-eyebrow text-[10px]">{label}</p>
      <p className="finance-amount mt-2 truncate text-lg text-gray-900">{value}</p>
      {note && <p className="mt-1 truncate text-[11px] font-medium text-gray-500">{note}</p>}
    </div>
  )
}

function SplitBar({ saTotal, mfTotal }) {
  const total = saTotal + mfTotal
  const saPct = total > 0 ? (saTotal / total) * 100 : 0
  const mfPct = total > 0 ? (mfTotal / total) * 100 : 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-700">Fund split</p>
        <p className="text-xs font-semibold text-gray-500">{fmt(total)}</p>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
        <div className="bg-blue-600" style={{ width: `${saPct}%` }} />
        <div className="bg-emerald-500" style={{ width: `${mfPct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-blue-50 p-2">
          <p className="font-semibold text-blue-700">SA</p>
          <p className="finance-amount text-sm text-gray-900">{fmt(saTotal)}</p>
          <p className="text-[11px] text-blue-700">{saPct.toFixed(0)}%</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2">
          <p className="font-semibold text-emerald-700">MF</p>
          <p className="finance-amount text-sm text-gray-900">{fmt(mfTotal)}</p>
          <p className="text-[11px] text-emerald-700">{mfPct.toFixed(0)}%</p>
        </div>
      </div>
    </div>
  )
}

function GroupByPicker({ value, onChange }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="flex gap-2">
        {GROUP_BY_OPTIONS.map(([val, label, description]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`min-w-[8.25rem] rounded-xl border p-3 text-left transition-colors ${
              value === val
                ? 'border-blue-600 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-white active:bg-gray-50'
            }`}
          >
            <p className={`text-sm font-bold ${value === val ? 'text-blue-700' : 'text-gray-900'}`}>{label}</p>
            <p className="mt-1 text-[11px] leading-4 text-gray-500">{description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function DateFilters({ dateFrom, dateTo, setDateFrom, setDateTo }) {
  const hasDate = Boolean(dateFrom || dateTo)

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className="min-w-0">
        <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="toolbar-field w-full min-w-0 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="toolbar-field w-full min-w-0 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>
      {hasDate && (
        <button
          type="button"
          onClick={() => { setDateFrom(''); setDateTo('') }}
          className="col-span-2 rounded-lg border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600 active:bg-gray-50"
        >
          Clear Date Range
        </button>
      )}
    </div>
  )
}

function StatusFilters({ statuses, toggleStatus, clearStatuses }) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3">
        <div>
          <p className="text-sm font-bold text-gray-900">Status filter</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {statuses.length ? `${statuses.length} selected` : 'All claim statuses'}
          </p>
        </div>
        <span className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-600">Edit</span>
      </summary>
      <div className="border-t border-gray-100 p-3">
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((status) => {
            const active = statuses.includes(status)
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-3 py-2 text-xs font-bold ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
                }`}
              >
                {STATUS_LABELS[status]}
              </button>
            )
          })}
        </div>
        {statuses.length > 0 && (
          <button
            type="button"
            onClick={clearStatuses}
            className="mt-3 w-full rounded-lg border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600 active:bg-gray-50"
          >
            Clear Statuses
          </button>
        )}
      </div>
    </details>
  )
}

function RowCard({ row, isFundBreakdown, maxTotal, rank }) {
  const total = rowTotal(row, isFundBreakdown)
  const width = maxTotal > 0 ? Math.max(4, (total / maxTotal) * 100) : 0
  const sa = Number(row.sa_total || 0)
  const mf = Number(row.mf_total || 0)
  const saWidth = total > 0 ? (sa / total) * 100 : 0
  const mfWidth = total > 0 ? (mf / total) * 100 : 0

  return (
    <div className="ui-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-gray-400">#{rank}</p>
          <p className="mt-0.5 truncate text-sm font-bold text-gray-900">{row.name}</p>
          {row.portfolio && <p className="mt-0.5 truncate text-xs text-gray-500">{row.portfolio}</p>}
        </div>
        <p className="finance-amount shrink-0 text-sm text-gray-900">{fmt(total)}</p>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} />
      </div>

      {isFundBreakdown && (
        <>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="bg-blue-600" style={{ width: `${saWidth}%` }} />
            <div className="bg-emerald-500" style={{ width: `${mfWidth}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-blue-50 px-2 py-1.5">
              <span className="font-bold text-blue-700">SA</span>
              <span className="float-right font-semibold text-gray-700">{fmt(sa)}</span>
            </div>
            <div className="rounded-lg bg-emerald-50 px-2 py-1.5">
              <span className="font-bold text-emerald-700">MF</span>
              <span className="float-right font-semibold text-gray-700">{fmt(mf)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ResultsList({ groupBy, data, isFundBreakdown, stats }) {
  const shouldGroupByPortfolio = groupBy === 'cca' || groupBy === 'cca_fund'

  if (!data.rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
        <p className="text-sm font-semibold text-gray-700">No claims match these filters.</p>
        <p className="mt-1 text-xs text-gray-500">Try clearing statuses or widening the date range.</p>
      </div>
    )
  }

  if (shouldGroupByPortfolio) {
    const groups = groupRowsByPortfolio(data.rows, isFundBreakdown)
      .sort((a, b) => b.subtotal - a.subtotal)
    let rank = 0
    return (
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.portfolio} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-gray-900">{group.portfolio}</h2>
              <p className="finance-amount text-sm text-gray-900">{fmt(group.subtotal)}</p>
            </div>
            {group.rows
              .slice()
              .sort((a, b) => rowTotal(b, isFundBreakdown) - rowTotal(a, isFundBreakdown))
              .map((row) => {
                rank += 1
                return (
                  <RowCard
                    key={`${group.portfolio}-${row.name}`}
                    row={row}
                    isFundBreakdown={isFundBreakdown}
                    maxTotal={stats.maxTotal}
                    rank={rank}
                  />
                )
              })}
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {stats.ranked.map((row, index) => (
        <RowCard
          key={row.name}
          row={row}
          isFundBreakdown={isFundBreakdown}
          maxTotal={stats.maxTotal}
          rank={index + 1}
        />
      ))}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState('cca')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statuses, setStatuses] = useState([])

  const isFundBreakdown = groupBy === 'portfolio_fund' || groupBy === 'cca_fund'
  const fundGroupBy = groupBy === 'portfolio_fund' ? 'portfolio' : 'cca'
  const activeView = GROUP_BY_OPTIONS.find(([value]) => value === groupBy)

  const summaryQuery = useAnalyticsSummary({
    groupBy: isFundBreakdown ? null : groupBy,
    statuses,
    dateFrom,
    dateTo,
    enabled: !isFundBreakdown,
  })

  const fundQuery = useAnalyticsFundBreakdown({
    groupBy: isFundBreakdown ? fundGroupBy : null,
    statuses,
    dateFrom,
    dateTo,
  })

  const { data, isLoading, isError } = isFundBreakdown ? fundQuery : summaryQuery
  const stats = useMemo(() => analyticsStats(data, isFundBreakdown), [data, isFundBreakdown])
  const hasFilters = statuses.length > 0 || Boolean(dateFrom || dateTo)

  function toggleStatus(status) {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status]
    )
  }

  function resetFilters() {
    setStatuses([])
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="mobile-page min-h-full bg-gray-50 pb-6">
      <div className="mobile-header sticky top-0 z-20 border-b px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="section-eyebrow">Analytics</p>
            <h1 className="mt-1 text-xl font-bold leading-7 text-gray-900">Finance spend view</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {activeView?.[1]}
              </span>
              <span className="text-xs font-semibold text-gray-700">
                {hasFilters ? 'Filters applied' : 'All claims'}
              </span>
            </div>
          </div>
          {data && !isLoading && !isError && (
            <button
              type="button"
              onClick={() => downloadCSV(groupBy, isFundBreakdown, data, dateFrom, dateTo)}
              className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 active:bg-gray-100"
            >
              Export
            </button>
          )}
        </div>
      </div>

      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
        <GroupByPicker value={groupBy} onChange={setGroupBy} />

        <section className="space-y-3">
          <DateFilters dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
          <StatusFilters statuses={statuses} toggleStatus={toggleStatus} clearStatuses={() => setStatuses([])} />
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 text-xs font-bold text-gray-600 active:bg-gray-50"
            >
              Clear All Filters
            </button>
          )}
        </section>

        {isLoading && <LoadingState />}

        {isError && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-5 text-center">
            <p className="text-sm font-bold text-red-700">Failed to load analytics.</p>
            <p className="mt-1 text-xs text-red-600">Check your connection and try again.</p>
          </div>
        )}

        {!isLoading && !isError && data && (
          <>
            <section className="grid grid-cols-2 gap-2">
              <KpiTile label="Total Spend" value={fmt(stats.grandTotal)} note={`${stats.rowCount} row${stats.rowCount === 1 ? '' : 's'}`} tone="accent" />
              <KpiTile label="Average" value={fmt(stats.average)} note="Per visible row" />
              <KpiTile label="Largest" value={fmt(stats.topTotal)} note={stats.top?.name || 'No spend'} tone="good" />
              <KpiTile label="View" value={activeView?.[1] || groupBy} note={statuses.length ? `${statuses.length} statuses` : 'All statuses'} />
            </section>

            {isFundBreakdown && (
              <SplitBar saTotal={stats.saTotal} mfTotal={stats.mfTotal} />
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Ranked spend</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Bars are scaled to the largest visible row.</p>
                </div>
                <p className="text-xs font-bold text-gray-500">{fmt(stats.grandTotal)}</p>
              </div>
              <ResultsList groupBy={groupBy} data={data} isFundBreakdown={isFundBreakdown} stats={stats} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
