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
  ['portfolio_fund', 'Portfolio × Fund'],
  ['cca_fund', 'CCA × Fund'],
]

function fmt(amount) {
  return `$${Number(amount).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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

// ─── Regular summary table ────────────────────────────────────────────────────

function SummaryTable({ groupBy, data }) {
  const portfolioGroups = groupBy === 'cca' ? groupRowsByPortfolio(data.rows) : null

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
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

// ─── Fund breakdown table ─────────────────────────────────────────────────────

function FundBreakdownTable({ groupBy, data }) {
  const isCca = groupBy === 'cca_fund'
  const portfolioGroups = isCca ? groupRowsByPortfolio(data.rows) : null

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState('cca')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statuses, setStatuses] = useState([])

  const isFundBreakdown = groupBy === 'portfolio_fund' || groupBy === 'cca_fund'
  const fundGroupBy = groupBy === 'portfolio_fund' ? 'portfolio' : 'cca'

  const summaryQuery = useAnalyticsSummary({
    groupBy,
    statuses,
    dateFrom,
    dateTo,
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
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">Analytics</h1>

      {/* Group-by toggle */}
      <div className="flex flex-wrap gap-2 mb-4">
        {GROUP_BY_OPTIONS.map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setGroupBy(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              groupBy === val
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 active:bg-gray-200'
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
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Status checkboxes */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-5">
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
        isFundBreakdown
          ? <FundBreakdownTable groupBy={groupBy} data={data} />
          : <SummaryTable groupBy={groupBy} data={data} />
      )}
    </div>
  )
}
