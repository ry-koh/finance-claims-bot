# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a director-only analytics page showing total claimed amounts grouped by CCA, portfolio, or fund, with date range and status filters.

**Architecture:** A PostgreSQL RPC function does all aggregation; a new FastAPI router calls it; a TanStack Query hook fetches it; `AnalyticsPage.jsx` renders it with group-by toggle, date range, and status filters.

**Tech Stack:** PostgreSQL (RPC function), FastAPI, Supabase Python client `.rpc()`, React 18 + TanStack Query v5, Tailwind CSS.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/015_analytics_summary_fn.sql` | PostgreSQL function that joins and aggregates claims |
| Create | `backend/app/routers/analytics.py` | FastAPI router, single `GET /analytics/summary` endpoint |
| Modify | `backend/app/main.py` | Register the analytics router |
| Create | `frontend/src/api/analytics.js` | TanStack Query hook wrapping the endpoint |
| Modify | `frontend/src/pages/AnalyticsPage.jsx` | Full UI — replaces "coming soon" placeholder |

---

## Task 1: PostgreSQL analytics_summary function

**Files:**
- Create: `supabase/migrations/015_analytics_summary_fn.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/015_analytics_summary_fn.sql` with this exact content:

```sql
CREATE OR REPLACE FUNCTION analytics_summary(
  p_group_by  text,    -- 'cca' | 'portfolio' | 'fund'
  p_statuses  text[],  -- NULL or empty = all statuses
  p_date_from date,    -- NULL = no lower bound
  p_date_to   date     -- NULL = no upper bound
)
RETURNS TABLE(name text, portfolio text, total numeric)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_group_by = 'cca' THEN
    RETURN QUERY
      SELECT
        ccas.name::text                AS name,
        portfolios.name::text          AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      JOIN claimers    cl  ON cl.id          = c.claimer_id
      JOIN ccas            ON ccas.id        = cl.cca_id
      JOIN portfolios      ON portfolios.id  = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY ccas.name, portfolios.name
      ORDER BY portfolios.name ASC, ccas.name ASC;

  ELSIF p_group_by = 'portfolio' THEN
    RETURN QUERY
      SELECT
        portfolios.name::text          AS name,
        NULL::text                     AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      JOIN claimers    cl  ON cl.id          = c.claimer_id
      JOIN ccas            ON ccas.id        = cl.cca_id
      JOIN portfolios      ON portfolios.id  = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY portfolios.name
      ORDER BY portfolios.name ASC;

  ELSIF p_group_by = 'fund' THEN
    RETURN QUERY
      SELECT
        c.wbs_account::text            AS name,
        NULL::text                     AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      WHERE c.deleted_at IS NULL
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY c.wbs_account
      ORDER BY c.wbs_account ASC;

  ELSE
    RAISE EXCEPTION 'Invalid group_by value: %. Must be cca, portfolio, or fund.', p_group_by;
  END IF;
END;
$$;
```

- [ ] **Step 2: Run the migration in Supabase SQL Editor**

Open the Supabase dashboard → SQL Editor, paste the entire file contents, and click Run.

Expected: no errors. The function `analytics_summary` now exists in the public schema.

- [ ] **Step 3: Smoke-test the function in SQL Editor**

Run this query to verify it returns rows:

```sql
SELECT * FROM analytics_summary('cca', NULL, NULL, NULL);
```

Expected: rows with `name` (CCA name), `portfolio` (portfolio name), `total` (numeric). If the database is empty, zero rows is also correct — no error is the success criterion.

Also test the fund grouping:

```sql
SELECT * FROM analytics_summary('fund', NULL, NULL, NULL);
```

Expected: rows with `name` in `{SA, MBH, MF}`, `portfolio` is NULL.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/015_analytics_summary_fn.sql
git commit -m "feat: add analytics_summary PostgreSQL function"
```

---

## Task 2: Backend analytics router

**Files:**
- Create: `backend/app/routers/analytics.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/routers/analytics.py`**

```python
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_director
from app.database import get_supabase

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
async def get_summary(
    group_by: str = Query(..., pattern="^(cca|portfolio|fund)$"),
    status: List[str] = Query(default=[]),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    params = {
        "p_group_by": group_by,
        "p_statuses": status if status else None,
        "p_date_from": date_from or None,
        "p_date_to": date_to or None,
    }

    try:
        result = db.rpc("analytics_summary", params).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analytics query failed: {exc}")

    rows = [
        {
            "name": r["name"],
            "portfolio": r.get("portfolio"),
            "total": float(r["total"]),
        }
        for r in (result.data or [])
    ]
    grand_total = sum(r["total"] for r in rows)

    return {"rows": rows, "grand_total": grand_total}
```

- [ ] **Step 2: Register the router in `backend/app/main.py`**

Add the import alongside the existing router imports (around line 10):

```python
from app.routers import analytics as analytics_router
```

Add the `include_router` call alongside the others (around line 94):

```python
app.include_router(analytics_router.router)
```

- [ ] **Step 3: Verify the endpoint locally**

Start the backend and run:

```bash
curl "http://localhost:8000/analytics/summary?group_by=cca" \
  -H "X-Telegram-User-Id: <your_director_telegram_id>"
```

Expected response shape:

```json
{
  "rows": [
    {"name": "Badminton", "portfolio": "Sports", "total": 1250.0}
  ],
  "grand_total": 1250.0
}
```

If the database is empty: `{"rows": [], "grand_total": 0.0}`.

Try an invalid `group_by` value:

```bash
curl "http://localhost:8000/analytics/summary?group_by=invalid" \
  -H "X-Telegram-User-Id: <your_director_telegram_id>"
```

Expected: 422 Unprocessable Entity (FastAPI rejects it before the handler runs because of the `pattern` constraint).

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/analytics.py backend/app/main.py
git commit -m "feat: add GET /analytics/summary endpoint"
```

---

## Task 3: Frontend API hook

**Files:**
- Create: `frontend/src/api/analytics.js`

- [ ] **Step 1: Create `frontend/src/api/analytics.js`**

```js
import { useQuery } from '@tanstack/react-query'
import api from './client'

export const fetchAnalyticsSummary = ({ groupBy, statuses, dateFrom, dateTo }) => {
  const params = new URLSearchParams()
  params.set('group_by', groupBy)
  if (statuses?.length) statuses.forEach((s) => params.append('status', s))
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  return api.get(`/analytics/summary?${params}`).then((r) => r.data)
}

export function useAnalyticsSummary({ groupBy, statuses, dateFrom, dateTo }) {
  return useQuery({
    queryKey: ['analytics', 'summary', groupBy, statuses, dateFrom, dateTo],
    queryFn: () => fetchAnalyticsSummary({ groupBy, statuses, dateFrom, dateTo }),
  })
}
```

- [ ] **Step 2: Verify the hook is importable**

In `frontend/src/pages/AnalyticsPage.jsx` (currently the placeholder), temporarily add an import at the top and check the dev console for errors:

```js
import { useAnalyticsSummary } from '../api/analytics'
```

Expected: no import error in the browser console. Revert this temporary import after verifying (the next task will add the real implementation).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/analytics.js
git commit -m "feat: add useAnalyticsSummary TanStack Query hook"
```

---

## Task 4: Analytics page UI

**Files:**
- Modify: `frontend/src/pages/AnalyticsPage.jsx`

- [ ] **Step 1: Replace `frontend/src/pages/AnalyticsPage.jsx` with the full implementation**

```jsx
import { useState } from 'react'
import { useAnalyticsSummary } from '../api/analytics'

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

function fmt(amount) {
  return `$${Number(amount).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function groupRowsByPortfolio(rows) {
  const map = {}
  rows.forEach((row) => {
    if (!map[row.portfolio]) {
      map[row.portfolio] = { portfolio: row.portfolio, rows: [], subtotal: 0 }
    }
    map[row.portfolio].rows.push(row)
    map[row.portfolio].subtotal += row.total
  })
  return Object.values(map)
}

export default function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState('cca')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statuses, setStatuses] = useState([])

  const { data, isLoading, isError } = useAnalyticsSummary({
    groupBy,
    statuses,
    dateFrom,
    dateTo,
  })

  function toggleStatus(s) {
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  const portfolioGroups =
    groupBy === 'cca' && data?.rows ? groupRowsByPortfolio(data.rows) : null

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">Analytics</h1>

      {/* Group-by toggle */}
      <div className="flex gap-2 mb-4">
        {[
          ['cca', 'By CCA'],
          ['portfolio', 'By Portfolio'],
          ['fund', 'By Fund'],
        ].map(([val, label]) => (
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
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Name
                </th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={2}
                    className="text-center text-gray-400 py-8 text-sm"
                  >
                    No claims match the selected filters.
                  </td>
                </tr>
              ) : groupBy === 'cca' ? (
                portfolioGroups.map((group) => (
                  <>
                    <tr
                      key={`hdr-${group.portfolio}`}
                      className="bg-gray-100 border-b border-gray-200"
                    >
                      <td className="px-4 py-1.5 font-semibold text-gray-700 text-xs uppercase tracking-wide">
                        {group.portfolio}
                      </td>
                      <td className="px-4 py-1.5 text-right font-semibold text-gray-700">
                        {fmt(group.subtotal)}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr
                        key={`row-${row.name}`}
                        className="border-b border-gray-100"
                      >
                        <td className="px-4 py-2 pl-8 text-gray-700">
                          {row.name}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          {fmt(row.total)}
                        </td>
                      </tr>
                    ))}
                  </>
                ))
              ) : (
                data.rows.map((row) => (
                  <tr key={`row-${row.name}`} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-700">{row.name}</td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {fmt(row.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-4 py-2.5 font-bold text-gray-800">
                  Grand Total
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-gray-800">
                  {fmt(data.grand_total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Open the analytics page in the browser**

Navigate to the analytics route in the Telegram Mini App (or dev browser). As a director:

- Verify the page loads without a blank screen or console errors
- Verify the group-by toggle shows three buttons: By CCA, By Portfolio, By Fund
- Verify the status checkboxes are all present and labelled correctly
- Click By CCA: confirm portfolio group headers appear (grey rows) with CCA rows indented
- Click By Portfolio: confirm flat alphabetical list of portfolio names
- Click By Fund: confirm rows for SA, MBH, MF (whichever have claims)
- Set a date From/To range and confirm the totals change
- Check one status checkbox and confirm totals filter down
- Verify Grand Total row is always visible at the bottom of the table

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AnalyticsPage.jsx
git commit -m "feat: analytics dashboard — grouped totals by CCA, portfolio, or fund"
```

---

## Self-Review Checklist

- [x] Migration file covers all three `group_by` branches — CCA, portfolio, fund
- [x] Empty `p_statuses` (NULL or zero-length) correctly includes all statuses
- [x] `array_length` NULL-safety handles both `NULL` input and empty array `{}`
- [x] Backend converts Supabase numeric strings to Python `float` before returning
- [x] Frontend `groupRowsByPortfolio` preserves the backend's sort order (portfolio → CCA name)
- [x] Status checkboxes use all 10 statuses matching the DB check constraint
- [x] `require_director` dependency blocks non-directors at the API level
- [x] `group_by` query param uses FastAPI `pattern` to reject invalid values with 422
- [x] Grand total is computed backend-side to avoid floating-point drift
