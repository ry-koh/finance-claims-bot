import React, { useState } from 'react'
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
  ['cca', 'By CCA'],
  ['portfolio', 'By Portfolio'],
  ['fund', 'By Fund'],
  ['portfolio_fund', 'Portfolio x Fund'],
  ['cca_fund', 'CCA x Fund'],
]

function fmt(amount) {
  return `$${Number(amount).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtRaw(amount) {
  return Number(amount).toFixed(2)
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

function groupRowsByPortfolio(rows) {
  const map = {}
  rows.forEach((row) => {
    const key = row.portfolio ?? '(No Portfolio)'
    if (!map[key]) {
      map[key] = { portfolio: key, rows: [], subtotal: 0, sa_subtotal: 0, mf_subtotal: 0 }
    }
    map[key].rows.push(row)
    map[key].subtotal += (row.total ?? 0)
    map[key].sa_subtotal += (row.sa_total ?? 0)
    map[key].mf_subtotal += (row.mf_total ?? 0)
  })
  return Object.values(map)
}

// Regular summary table

function SummaryTable({ groupBy, data }) {
  const portfolioGroups = groupBy === 'cca' ? groupRowsByPortfolio(data.rows) : null

  return (
    <div className="ui-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2 font-medium text-gray-600">Name</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="text-center text-gray-400 py-8 text-sm">
                No claims match the selected filters.
              </td>
            </tr>
          ) : groupBy === 'cca' ? (
            portfolioGroups.map((group) => (
              <React.Fragment key={`hdr-${group.portfolio}`}>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <td className="px-4 py-1.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">
                    {group.portfolio}
                  </td>
                  <td className="px-4 py-1.5 text-right font-semibold text-gray-700">
                    {fmt(group.subtotal)}
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={`row-${group.portfolio}-${row.name}`} className="border-b border-gray-100">
                    <td className="px-4 py-2 pl-8 text-gray-700">{row.name}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{fmt(row.total)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))
          ) : (
            data.rows.map((row) => (
              <tr key={`row-${row.name}`} className="border-b border-gray-100">
                <td className="px-4 py-2 text-gray-700">{row.name}</td>
                <td className="px-4 py-2 text-right text-gray-700">{fmt(row.total)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50">
            <td className="px-4 py-2.5 font-bold text-gray-800">Grand Total</td>
            <td className="px-4 py-2.5 text-right font-bold text-gray-800">{fmt(data.grand_total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Fund breakdown table

function FundBreakdownTable({ groupBy, data }) {
  const isCca = groupBy === 'cca_fund'
  const portfolioGroups = isCca ? groupRowsByPortfolio(data.rows) : null

  return (
    <div className="ui-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2 font-medium text-gray-600">Name</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">SA</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">MF</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center text-gray-400 py-8 text-sm">
                No claims match the selected filters.
              </td>
            </tr>
          ) : isCca ? (
            portfolioGroups.map((group) => (
              <React.Fragment key={`hdr-${group.portfolio}`}>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <td className="px-4 py-1.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">
                    {group.portfolio}
                  </td>
                  <td className="px-4 py-1.5 text-right font-semibold text-gray-700">
                    {fmt(group.sa_subtotal)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-semibold text-gray-700">
                    {fmt(group.mf_subtotal)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-semibold text-gray-700">
                    {fmt(group.sa_subtotal + group.mf_subtotal)}
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={`row-${group.portfolio}-${row.name}`} className="border-b border-gray-100">
                    <td className="px-4 py-2 pl-8 text-gray-700">{row.name}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{fmt(row.sa_total)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{fmt(row.mf_total)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{fmt(row.sa_total + row.mf_total)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))
          ) : (
            data.rows.map((row) => (
              <tr key={`row-${row.name}`} className="border-b border-gray-100">
                <td className="px-4 py-2 text-gray-700">{row.name}</td>
                <td className="px-4 py-2 text-right text-gray-600">{fmt(row.sa_total)}</td>
                <td className="px-4 py-2 text-right text-gray-600">{fmt(row.mf_total)}</td>
                <td className="px-4 py-2 text-right text-gray-700">{fmt(row.sa_total + row.mf_total)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50">
            <td className="px-4 py-2.5 font-bold text-gray-800">Grand Total</td>
            <td className="px-4 py-2.5 text-right font-bold text-gray-800">{fmt(data.sa_total)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-gray-800">{fmt(data.mf_total)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-gray-800">{fmt(data.grand_total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Main page

export default function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState('cca')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statuses, setStatuses] = useState([])

  const isFundBreakdown = groupBy === 'portfolio_fund' || groupBy === 'cca_fund'
  const fundGroupBy = groupBy === 'portfolio_fund' ? 'portfolio' : 'cca'

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

  function toggleStatus(s) {
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  return (
    <div className="mobile-page mx-auto min-h-full max-w-2xl p-4">
      <div className="mb-4">
        <p className="section-eyebrow">Analytics Overview</p>
        <h1 className="mt-1 text-xl font-bold leading-7 text-gray-900">Portfolio spend</h1>
      </div>

      <div className="ui-card mb-4 p-4">
        {/* Group-by toggle */}
        <div className="flex flex-wrap gap-2 mb-4">
          {GROUP_BY_OPTIONS.map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setGroupBy(val)}
              className={`filter-pill ${
                groupBy === val
                  ? 'filter-pill-active'
                  : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date filters */}
        <div className="flex gap-3 mb-3 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="toolbar-field px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="toolbar-field px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Status checkboxes */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALL_STATUSES.map((s) => (
            <label
              key={s}
              className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={statuses.includes(s)}
                onChange={() => toggleStatus(s)}
                className="rounded border-gray-300"
              />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </div>
      </div>

      {/* Results */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-500 py-4 text-center">
          Failed to load analytics.
        </p>
      )}

      {!isLoading && !isError && data && (
        <>
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => downloadCSV(groupBy, isFundBreakdown, data, dateFrom, dateTo)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 active:bg-gray-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Export CSV
            </button>
          </div>
          {isFundBreakdown
            ? <FundBreakdownTable groupBy={groupBy} data={data} />
            : <SummaryTable groupBy={groupBy} data={data} />}
        </>
      )}
    </div>
  )
}
