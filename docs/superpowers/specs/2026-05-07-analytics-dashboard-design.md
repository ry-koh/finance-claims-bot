# Analytics Dashboard Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a director-only analytics page showing total claimed amounts grouped by CCA, portfolio, or fund, with date range and status filters.

**Architecture:** New backend endpoint does all aggregation via a single SQL JOIN query. Frontend replaces the existing placeholder `AnalyticsPage.jsx` with controls and a results table. A new TanStack Query hook in `frontend/src/api/analytics.js` connects them.

**Tech Stack:** FastAPI (new router), Supabase PostgREST (raw SQL via `.rpc` or parameterised query), React 18 + TanStack Query v5, Tailwind CSS.

---

## Data Model

Relevant tables and join path:

```
claims.claimer_id → claimers.cca_id → ccas.portfolio_id → portfolios
claims.wbs_account  (SA | MBH | MF)
claims.total_amount (numeric)
claims.date         (date — used for date range filter)
claims.status       (used for status filter)
claims.deleted_at   (must be null)
```

---

## Backend

### Endpoint

`GET /analytics/summary` — director-only (`require_director` dependency).

### Query parameters

| Param | Type | Notes |
|---|---|---|
| `group_by` | `cca` \| `portfolio` \| `fund` | Required |
| `status` | string (repeatable) | Optional; none = all non-deleted |
| `date_from` | ISO date string | Optional; inclusive, filters `claims.date` |
| `date_to` | ISO date string | Optional; inclusive |

### Response schema

```json
{
  "rows": [
    { "name": "Badminton", "portfolio": "Sports", "total": 1250.00 },
    { "name": "SA",        "portfolio": null,     "total": 3100.00 }
  ],
  "grand_total": 4350.00
}
```

`portfolio` field is only populated when `group_by=cca` (used by the frontend for group headers). For other groupings it is `null`.

### SQL logic

The handler builds a parameterised query against Supabase using the Python client. The join path is:

```sql
SELECT
  <group expression>   AS name,
  <portfolio name>     AS portfolio,   -- only for group_by=cca
  SUM(c.total_amount)  AS total
FROM claims c
JOIN claimers cl  ON cl.id  = c.claimer_id
JOIN ccas         ON ccas.id = cl.cca_id
JOIN portfolios   ON portfolios.id = ccas.portfolio_id
WHERE c.deleted_at IS NULL
  [AND c.status IN (...)]
  [AND c.date >= date_from]
  [AND c.date <= date_to]
GROUP BY <group expression> [, portfolio]
ORDER BY <sort expression>
```

Group expressions and sort orders by `group_by` value:

| `group_by` | `name` expression | `portfolio` | Sort |
|---|---|---|---|
| `cca` | `ccas.name` | `portfolios.name` | `portfolios.name ASC, ccas.name ASC` |
| `portfolio` | `portfolios.name` | `null` | `portfolios.name ASC` |
| `fund` | `c.wbs_account` | `null` | `c.wbs_account ASC` |

Implementation uses Supabase's `.rpc()` with a new PostgreSQL function `analytics_summary` that accepts the parameters, to keep raw SQL out of Python and avoid injection risks.

### New files

- `backend/app/routers/analytics.py` — router with the single endpoint
- `supabase/migrations/015_analytics_summary_fn.sql` — PostgreSQL function

### Registration

Add `analytics.router` to `backend/app/main.py`.

---

## Frontend

### New file: `frontend/src/api/analytics.js`

Exports one hook:

```js
useAnalyticsSummary({ groupBy, statuses, dateFrom, dateTo })
```

- TanStack Query `useQuery`, key: `['analytics', 'summary', groupBy, statuses, dateFrom, dateTo]`
- Calls `GET /analytics/summary` with query params
- `statuses` is an array; each element sent as a separate `status=` param
- Returns `{ data, isLoading, isError }`

### Modified file: `frontend/src/pages/AnalyticsPage.jsx`

Replaces the "coming soon" placeholder entirely.

**State:**
- `groupBy`: `'cca'` | `'portfolio'` | `'fund'` — default `'cca'`
- `dateFrom`: string (ISO date) — default `''`
- `dateTo`: string (ISO date) — default `''`
- `statuses`: `string[]` — default `[]` (empty = all)

**Layout (top to bottom):**

1. **Group-by toggle** — three buttons: `By CCA` | `By Portfolio` | `By Fund`. Active button has blue background, inactive grey.

2. **Filters row** — date From input, date To input, status checkboxes. Status options: `draft`, `pending_review`, `email_sent`, `screenshot_pending`, `screenshot_uploaded`, `docs_generated`, `compiled`, `submitted`, `reimbursed`, `error`. Displayed with human-readable labels. None checked = all statuses included.

3. **Results table:**

   - **Fund / Portfolio view** — two-column table: Name | Total Amount

     ```
     Name          Total
     ─────────────────────
     SA            $3,100.00
     MF            $1,250.00
     ─────────────────────
     Grand Total   $4,350.00
     ```

   - **CCA view** — portfolio group header rows (grey background, bold portfolio name + portfolio subtotal), with CCA rows indented beneath:

     ```
     Portfolio: Sports               $2,070.50
       Badminton                     $1,250.00
       Table Tennis                    $820.50
     Portfolio: Welfare              $1,280.00
       Welfare General               $1,280.00
     ─────────────────────────────────────────
     Grand Total                     $3,350.50
     ```

4. **Grand total row** — always visible at table bottom, separated by a divider.

5. **Loading state** — spinner in place of the table.

6. **Empty state** — "No claims match the selected filters" message.

7. **Error state** — "Failed to load analytics" message.

---

## Access Control

- Route already gated to directors in `App.jsx` (`isDirector && <Route path="analytics" .../>`)
- Backend uses `require_director` dependency (already exists in `app/auth.py`)
- No changes needed to routing or auth

---

## Decision Log

| Decision | Alternatives | Reason |
|---|---|---|
| Aggregation in DB via RPC function | Frontend aggregation; raw SQL in Python | DB is faster and safer; RPC keeps SQL out of Python strings |
| `portfolio` field in every CCA row | Separate endpoint for portfolio list | Single response is simpler; frontend groups client-side |
| Empty `statuses` = all statuses | Require explicit "all" value | Less friction; most common case is "show everything" |
| Sorting: CCA view by portfolio then name | Alphabetical flat list | Matches the group-header UI — headers must appear in order |
| Grand total computed backend-side | Sum on frontend | Avoids floating-point drift across large row sets |
