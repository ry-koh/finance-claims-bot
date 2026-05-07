# Director Navigation Drawer & Settings Page Design

## Goal

Replace the overcrowded bottom tab bar for the finance director role with a left-drawer navigation, add a director-only Settings page for configuring academic year and director profile, and split the Team page into Finance Team and CCA Treasurers.

## Roles in the System

| Role | Description | Navigation |
|------|-------------|------------|
| `director` | Finance director | Left drawer (this feature) |
| `member` | Finance team member | Existing bottom tabs — unchanged |
| `treasurer` | CCA treasurer | Existing bottom tabs — unchanged |

## Architecture

Three independent concerns bundled into one delivery:

1. **Director navigation** — replace the director's 7-tab bottom bar with a top header + left drawer
2. **Settings page** — director-only form for academic year and director profile, stored in DB
3. **Team page split** — separate Finance Team (director + members) from CCA Treasurers (sorted by portfolio, searchable)

The backend adds one new router (`/settings`). Two existing behaviours flip: `claims.py` reads academic year from the `app_settings` DB table instead of the `ACADEMIC_YEAR` env var; `_get_finance_director()` always reads from `finance_team` DB (drops env var priority). The `FD_NAME`, `FD_MATRIC_NO`, `FD_PHONE`, `FD_EMAIL`, and `ACADEMIC_YEAR` GitHub secrets are removed from `deploy.yml` and `config.py`.

---

## 1. Director Navigation

### Layout

Directors get a **top header bar** instead of a bottom tab bar:

- Fixed header: white background, `border-b`, full width, height `h-14`
- Left side: ≡ hamburger button (`text-2xl`, tappable)
- Centre: current page title (e.g. "Home", "Analytics")
- No bottom tab bar rendered for directors

`<main>` gets `pt-14` instead of `pb-16` to clear the fixed header.

### Drawer

Tapping ≡ slides in a left drawer:

- Width: `w-3/4` (75% of screen), full height
- Dark semi-transparent backdrop covers the rest of the screen; tapping it closes the drawer
- Drawer slides in from the left with a CSS transition (`translate-x`)
- Active page link highlighted blue

**Drawer structure:**

```
── Claims ──────────────
  🏠  Home
  ➕  New Claim

── Admin ───────────────
  📊  Analytics
  👤  Approvals  [red badge: pending count]
  🛡️  Finance Team
  👥  CCA Treasurers
  ⚙️  Settings

── Other ───────────────
  💬  Contact
```

Section headers are small uppercase grey labels. Tapping any link navigates and closes the drawer.

### What is unchanged

- Finance members and CCA treasurers keep their existing bottom tab layout
- The `Layout` component renders the drawer header only when `isDirector` is true
- The `Identifiers` page and route remain in the codebase; they are not in the director drawer but are still accessible to members via their bottom tabs

---

## 2. Settings Page

### Route

`/settings` — director-only (guarded in `App.jsx`)

### Form

Two sections on one page, single Save button at the bottom.

**Academic Year**

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| Academic Year | text input | `2526` | Changing AY resets the claim counter to 1 on the next claim created. Warning shown below the input: *"Changing the AY will reset the claim counter to 0001"* |

**Finance Director Profile** *(used in generated documents)*

| Field | Type |
|-------|------|
| Full Name | text |
| Phone Number | text |
| Matric Number | text |
| Personal Email | email |

On load: pre-filled from DB. On save: single `PATCH /settings` call.

### Claim reference code change

Counter format changes from 3 digits to 4 digits:
- Before: `2526-SA-001`
- After: `2526-SA-0001`

This is a `:03d` → `:04d` change in `claims.py`.

---

## 3. Team Page Split

The current `TeamPage.jsx` mixes finance team members and CCA treasurers. It is replaced by two separate pages:

### Finance Team page (`/team`)

- Lists `finance_team` rows where `role in ('director', 'member')`
- Same edit/remove functionality as current Team page for these roles
- Director row shown at top, then members alphabetically

### CCA Treasurers page (`/cca-treasurers`)

- Lists `finance_team` rows where `role = 'treasurer'`
- **Sorted:** by portfolio name ascending, then by member name ascending within each portfolio
- **Search bar** at top: filters by name OR CCA name (case-insensitive, client-side)
- Same edit/remove functionality as current Team page for treasurer role
- Portfolio group headers (grey dividers) — same pattern as analytics page

---

## 4. Data Layer

### New migration: `016_app_settings.sql`

```sql
create table app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

insert into app_settings (key, value) values ('academic_year', '2526')
  on conflict do nothing;
```

### New backend router: `backend/app/routers/settings.py`

- `GET /settings` — director-only; returns `{ academic_year, fd_name, fd_phone, fd_matric_no, fd_email }`
  - Reads `academic_year` from `app_settings` table
  - Reads director fields from `finance_team` where `role = 'director'`
- `PATCH /settings` — director-only; body `{ academic_year?, fd_name?, fd_phone?, fd_matric_no?, fd_email? }`
  - Upserts `academic_year` in `app_settings`
  - Updates matching fields on the director's `finance_team` row

### Changes to existing backend files

**`backend/app/routers/claims.py`**
- Replace `settings.ACADEMIC_YEAR` with a DB read: `db.table("app_settings").select("value").eq("key", "academic_year").single().execute()`
- Change `:03d` → `:04d` in the reference code format string
- Cache the AY value within a single request (read once, reuse)

**`backend/app/routers/documents.py` — `_get_finance_director()`**
- Remove the `if settings.FD_NAME:` branch entirely
- Always query `finance_team` where `role = 'director'`
- Raise `HTTPException(500, "No Finance Director configured — update profile in Settings")` if no row found

**`backend/app/config.py`**
- Remove fields: `FD_NAME`, `FD_MATRIC_NO`, `FD_PHONE`, `FD_EMAIL`, `ACADEMIC_YEAR`

**`.github/workflows/deploy.yml`**
- Remove env entries: `FD_NAME`, `FD_MATRIC_NO`, `FD_PHONE`, `FD_EMAIL`, `ACADEMIC_YEAR`

### New frontend files

| File | Purpose |
|------|---------|
| `frontend/src/api/settings.js` | `useSettings` query + `useUpdateSettings` mutation |
| `frontend/src/pages/SettingsPage.jsx` | Settings form |
| `frontend/src/pages/FinanceTeamPage.jsx` | Finance team members only (split from TeamPage) |
| `frontend/src/pages/CcaTreasurersPage.jsx` | CCA treasurers with sort + search (split from TeamPage) |
| `frontend/src/components/DirectorDrawer.jsx` | Drawer + backdrop + hamburger state |

### Modified frontend files

| File | Change |
|------|--------|
| `frontend/src/components/Layout.jsx` | Add director header + drawer; keep bottom tabs for non-directors |
| `frontend/src/App.jsx` | Add `/settings`, `/cca-treasurers` routes; rename `/team` to use `FinanceTeamPage` |

---

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| Drawer only for directors | Drawer for all, or "More" tab | Directors have 8+ pages; members/treasurers have ≤4 — don't impose drawer on simple cases |
| Store AY in `app_settings` table | Keep in env var, or add column to existing table | Settings page needs to write it at runtime; env vars require redeployment |
| Director profile from `finance_team` | Separate settings table | Fields already exist in `finance_team`; no duplication needed |
| Split Team into two pages | Keep one page with sections | Cleaner mental model; CCA Treasurers page can have dedicated search UI |
| Remove `FD_*` env vars entirely | Keep as fallback | Once settings page is live, env var fallback creates confusing precedence; DB is the single source of truth |
| 4-digit counter | Keep 3-digit | User request; prevents rollover risk if claims exceed 999 in a year |
