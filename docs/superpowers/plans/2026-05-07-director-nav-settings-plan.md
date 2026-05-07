# Director Navigation Drawer & Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the finance director's bottom tab bar with a left-drawer navigation, add a director-only Settings page for academic year and director profile, and split the Team page into Finance Team and CCA Treasurers pages.

**Architecture:** A new `app_settings` DB table stores academic year; the director's personal info stays in `finance_team`. A new `/settings` FastAPI router handles reads/writes. The frontend gains a `DirectorDrawer` component and two new pages (`FinanceTeamPage`, `CcaTreasurersPage`). `Layout.jsx` renders a top header + drawer for directors instead of bottom tabs.

**Tech Stack:** PostgreSQL (Supabase), FastAPI + Pydantic, React 18, TanStack Query v5, Tailwind CSS, React Router v6.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/016_app_settings.sql` | `app_settings` key-value table |
| Create | `backend/app/routers/settings.py` | `GET /settings`, `PATCH /settings` |
| Modify | `backend/app/main.py` | Register settings router |
| Modify | `backend/app/routers/claims.py` | Read AY from DB; 4-digit counter |
| Modify | `backend/app/routers/documents.py` | `_get_finance_director()` always reads DB |
| Modify | `backend/app/config.py` | Remove `FD_*` and `ACADEMIC_YEAR` fields |
| Modify | `.github/workflows/deploy.yml` | Remove corresponding secrets |
| Create | `frontend/src/api/settings.js` | `useSettings` + `useUpdateSettings` hooks |
| Create | `frontend/src/pages/SettingsPage.jsx` | AY + director profile form |
| Create | `frontend/src/components/DirectorDrawer.jsx` | Left drawer with groups + backdrop |
| Modify | `frontend/src/components/Layout.jsx` | Director header/drawer; non-director unchanged |
| Create | `frontend/src/pages/FinanceTeamPage.jsx` | Director + member rows only |
| Create | `frontend/src/pages/CcaTreasurersPage.jsx` | Treasurer rows, sorted by portfolio, searchable |
| Modify | `frontend/src/App.jsx` | Add `/settings`, `/cca-treasurers`; `/team` → FinanceTeamPage |

---

## Task 1: app_settings migration (manual Supabase step)

**Files:**
- Create: `supabase/migrations/016_app_settings.sql`

- [ ] **Step 1: Create the migration file**

```sql
create table app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

insert into app_settings (key, value) values ('academic_year', '2526')
  on conflict do nothing;
```

Save to `supabase/migrations/016_app_settings.sql`.

- [ ] **Step 2: Run in Supabase SQL Editor**

Open Supabase dashboard → SQL Editor, paste the full file contents, click Run.

Expected: no errors. `SELECT * FROM app_settings;` returns one row: `key=academic_year`, `value=2526`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/016_app_settings.sql
git commit -m "feat: add app_settings table for DB-backed configuration"
```

---

## Task 2: Backend settings router

**Files:**
- Create: `backend/app/routers/settings.py`
- Modify: `backend/app/main.py:95-107`

- [ ] **Step 1: Create `backend/app/routers/settings.py`**

```python
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_director
from app.database import get_supabase

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    academic_year: str
    fd_name: str
    fd_phone: str
    fd_matric_no: str
    fd_email: str


class SettingsUpdate(BaseModel):
    academic_year: Optional[str] = None
    fd_name: Optional[str] = None
    fd_phone: Optional[str] = None
    fd_matric_no: Optional[str] = None
    fd_email: Optional[str] = None


@router.get("", response_model=SettingsResponse)
async def get_settings(
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    ay_resp = db.table("app_settings").select("value").eq("key", "academic_year").single().execute()
    ay = ay_resp.data["value"] if ay_resp.data else ""

    fd_resp = (
        db.table("finance_team")
        .select("name,email,matric_number,phone_number")
        .eq("role", "director")
        .limit(1)
        .execute()
    )
    fd = fd_resp.data[0] if fd_resp.data else {}

    return {
        "academic_year": ay,
        "fd_name": fd.get("name") or "",
        "fd_phone": fd.get("phone_number") or "",
        "fd_matric_no": fd.get("matric_number") or "",
        "fd_email": fd.get("email") or "",
    }


@router.patch("")
async def update_settings(
    payload: SettingsUpdate,
    director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    if payload.academic_year is not None:
        db.table("app_settings").upsert(
            {
                "key": "academic_year",
                "value": payload.academic_year,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="key",
        ).execute()

    fd_update: dict = {}
    if payload.fd_name is not None:
        fd_update["name"] = payload.fd_name
    if payload.fd_phone is not None:
        fd_update["phone_number"] = payload.fd_phone
    if payload.fd_matric_no is not None:
        fd_update["matric_number"] = payload.fd_matric_no
    if payload.fd_email is not None:
        fd_update["email"] = payload.fd_email

    if fd_update:
        db.table("finance_team").update(fd_update).eq("id", director["id"]).execute()

    return {"ok": True}
```

- [ ] **Step 2: Register in `backend/app/main.py`**

Add the import on line 15 alongside the existing router imports:

```python
from app.routers import settings as settings_router
```

Add the include after line 107 (after `analytics_router`):

```python
app.include_router(settings_router.router)
```

- [ ] **Step 3: Smoke test**

Start the backend. Run:

```bash
curl http://localhost:8000/settings \
  -H "X-Telegram-User-Id: <your_director_telegram_id>"
```

Expected:
```json
{"academic_year":"2526","fd_name":"","fd_phone":"","fd_matric_no":"","fd_email":""}
```

Run a PATCH:

```bash
curl -X PATCH http://localhost:8000/settings \
  -H "X-Telegram-User-Id: <your_director_telegram_id>" \
  -H "Content-Type: application/json" \
  -d '{"academic_year":"2526","fd_name":"Test Director"}'
```

Expected: `{"ok": true}`. Follow-up GET should show the updated values.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/settings.py backend/app/main.py
git commit -m "feat: add GET/PATCH /settings endpoint for director configuration"
```

---

## Task 3: Wire claims.py to read AY from DB and use 4-digit counter

**Files:**
- Modify: `backend/app/routers/claims.py:341-381`

- [ ] **Step 1: Replace `settings.ACADEMIC_YEAR` and fix counter format**

Find lines 341–381 in `backend/app/routers/claims.py`. Replace:

```python
    academic_year = settings.ACADEMIC_YEAR

    # --- Atomically increment document counter (INSERT ... ON CONFLICT DO UPDATE) ---
    counter_resp = db.rpc("increment_document_counter", {"p_year": academic_year}).execute()
```

With:

```python
    # Read academic year from DB
    ay_resp = db.table("app_settings").select("value").eq("key", "academic_year").single().execute()
    if not ay_resp.data:
        raise HTTPException(status_code=500, detail="Academic year not configured — update it in Settings")
    academic_year = ay_resp.data["value"]

    # --- Atomically increment document counter (INSERT ... ON CONFLICT DO UPDATE) ---
    counter_resp = db.rpc("increment_document_counter", {"p_year": academic_year}).execute()
```

Then find line 380 (the reference code format string):

```python
        f"-{counter:03d}"
```

Change to:

```python
        f"-{counter:04d}"
```

- [ ] **Step 2: Verify the reference code format**

Create a test claim via the app or curl. Confirm the `reference_code` field in the response now has a 4-digit counter: e.g. `2526-SPRT-BDMN-0001` instead of `2526-SPRT-BDMN-001`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/claims.py
git commit -m "feat: read academic year from DB; change claim counter to 4 digits"
```

---

## Task 4: Fix `_get_finance_director()` to always read from DB

**Files:**
- Modify: `backend/app/routers/documents.py:59-72`

- [ ] **Step 1: Replace the function**

Find `_get_finance_director` at lines 59–72 in `backend/app/routers/documents.py`. Replace the entire function:

```python
def _get_finance_director(db) -> dict:
    result = (
        db.table("finance_team")
        .select("name,email,matric_number,phone_number")
        .eq("role", "director")
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(500, "No Finance Director configured — update profile in Settings")
    fd = result.data[0]
    return {
        "name": fd.get("name") or "",
        "matric_no": fd.get("matric_number") or "",
        "phone": fd.get("phone_number") or "",
        "email": fd.get("email") or "",
    }
```

Note: the return dict deliberately remaps DB column names (`matric_number` → `matric_no`, `phone_number` → `phone`) to match the keys already used in `pdf.py` template rendering.

- [ ] **Step 2: Verify document generation still works**

Generate any document (Summary, RFP, or Transport) for an existing claim. Confirm the director name/matric/phone/email appear correctly in the generated PDF. If the `finance_team` director row has empty fields, the PDF will show empty strings — that is expected until the Settings page is used to populate them.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/documents.py
git commit -m "fix: _get_finance_director always reads from DB, drops env var fallback"
```

---

## Task 5: Remove FD_* and ACADEMIC_YEAR from config and deploy

**Files:**
- Modify: `backend/app/config.py:15-24`
- Modify: `.github/workflows/deploy.yml:42-57`

- [ ] **Step 1: Remove fields from `backend/app/config.py`**

Remove these four lines from the `Settings` class:

```python
    FD_NAME: str = ""        # Finance Director display name
    FD_MATRIC_NO: str = ""   # Finance Director matric number
    FD_PHONE: str = ""       # Finance Director phone number
    FD_EMAIL: str = ""       # Finance Director personal email (for transport form)
```

Also remove:

```python
    ACADEMIC_YEAR: str
```

The class after removal should go from `GOOGLE_DRIVE_PARENT_FOLDER_ID` directly to `R2_ACCOUNT_ID`.

- [ ] **Step 2: Update `.github/workflows/deploy.yml`**

In the `Write env vars file` step, remove the five env lines:

```yaml
          FD_NAME: ${{ secrets.FD_NAME }}
          FD_MATRIC_NO: ${{ secrets.FD_MATRIC_NO }}
          FD_PHONE: ${{ secrets.FD_PHONE }}
          ACADEMIC_YEAR: ${{ secrets.ACADEMIC_YEAR }}
          FD_EMAIL: ${{ secrets.FD_EMAIL }}
```

In the Python script's `keys` list (line 57), remove `'FD_NAME'`, `'FD_MATRIC_NO'`, `'FD_PHONE'`, `'FD_EMAIL'`, `'ACADEMIC_YEAR'` from the list. The updated list should be:

```python
          keys = [
              'SUPABASE_URL', 'SUPABASE_KEY', 'TELEGRAM_BOT_TOKEN',
              'GOOGLE_SERVICE_ACCOUNT_JSON', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET',
              'GMAIL_REFRESH_TOKEN', 'GOOGLE_DRIVE_PARENT_FOLDER_ID', 'DRIVE_REFRESH_TOKEN',
              'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
              'MINI_APP_URL', 'APP_URL',
          ]
```

- [ ] **Step 3: Verify the backend starts without errors**

```bash
cd backend
uvicorn app.main:app --reload
```

Expected: server starts with no `ValidationError` about missing fields. (Tasks 3 and 4 already removed all usages of these fields from code.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/config.py .github/workflows/deploy.yml
git commit -m "chore: remove FD_* and ACADEMIC_YEAR from config and deploy — now stored in DB"
```

---

## Task 6: Frontend settings API hook

**Files:**
- Create: `frontend/src/api/settings.js`

- [ ] **Step 1: Create `frontend/src/api/settings.js`**

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

const SETTINGS_KEY = ['settings']

export const fetchSettings = () =>
  api.get('/settings').then((r) => r.data)

export const updateSettings = (data) =>
  api.patch('/settings', data).then((r) => r.data)

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function useUpdateSettings(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
    ...options,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/settings.js
git commit -m "feat: add useSettings and useUpdateSettings TanStack Query hooks"
```

---

## Task 7: SettingsPage

**Files:**
- Create: `frontend/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/SettingsPage.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useSettings, useUpdateSettings } from '../api/settings'

export default function SettingsPage() {
  const { data, isLoading } = useSettings()
  const updateMutation = useUpdateSettings()

  const [academicYear, setAcademicYear] = useState('')
  const [fdName, setFdName] = useState('')
  const [fdPhone, setFdPhone] = useState('')
  const [fdMatricNo, setFdMatricNo] = useState('')
  const [fdEmail, setFdEmail] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setAcademicYear(data.academic_year || '')
      setFdName(data.fd_name || '')
      setFdPhone(data.fd_phone || '')
      setFdMatricNo(data.fd_matric_no || '')
      setFdEmail(data.fd_email || '')
    }
  }, [data])

  function handleSave(e) {
    e.preventDefault()
    updateMutation.mutate(
      {
        academic_year: academicYear,
        fd_name: fdName,
        fd_phone: fdPhone,
        fd_matric_no: fdMatricNo,
        fd_email: fdEmail,
      },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        },
      }
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-6">Settings</h1>
      <form onSubmit={handleSave} className="space-y-6">

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Academic Year</h2>
          <label className="block text-xs text-gray-500 mb-1">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="e.g. 2526"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <p className="text-xs text-amber-600 mt-1">
            Changing the AY will reset the claim counter to 0001
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Finance Director Profile</h2>
          <p className="text-xs text-gray-400 mb-3">Used in generated documents (Summary, RFP, Transport form)</p>
          <div className="space-y-3">
            {[
              { label: 'Full Name', value: fdName, set: setFdName, type: 'text', placeholder: 'e.g. Tan Wei Ming' },
              { label: 'Phone Number', value: fdPhone, set: setFdPhone, type: 'text', placeholder: 'e.g. 91234567' },
              { label: 'Matric Number', value: fdMatricNo, set: setFdMatricNo, type: 'text', placeholder: 'e.g. A0123456B' },
              { label: 'Personal Email', value: fdEmail, set: setFdEmail, type: 'email', placeholder: 'e.g. weiming@example.com' },
            ].map(({ label, value, set, type, placeholder }) => (
              <div key={label}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {updateMutation.isPending && (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

        {updateMutation.isError && (
          <p className="text-sm text-red-500 text-center mt-2">
            Failed to save settings. Please try again.
          </p>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/SettingsPage.jsx
git commit -m "feat: add Settings page for academic year and director profile"
```

---

## Task 8: DirectorDrawer component

**Files:**
- Create: `frontend/src/components/DirectorDrawer.jsx`

- [ ] **Step 1: Create `frontend/src/components/DirectorDrawer.jsx`**

```jsx
import { NavLink } from 'react-router-dom'
import { usePendingCount } from '../api/admin'

const NAV_GROUPS = [
  {
    label: 'Claims',
    items: [
      { to: '/', label: 'Home', icon: '🏠', end: true },
      { to: '/claims/new', label: 'New Claim', icon: '➕' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/analytics', label: 'Analytics', icon: '📊' },
      { to: '/pending-registrations', label: 'Approvals', icon: '👤', badge: true },
      { to: '/team', label: 'Finance Team', icon: '🛡️' },
      { to: '/cca-treasurers', label: 'CCA Treasurers', icon: '👥' },
      { to: '/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/contact', label: 'Contact', icon: '💬' },
    ],
  },
]

function PendingBadge() {
  const { data: count = 0 } = usePendingCount()
  if (!count) return null
  return (
    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function DirectorDrawer({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-full w-3/4 max-w-xs bg-white z-40 shadow-xl transform transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="font-bold text-gray-900 text-base">Menu</p>
        </div>
        <nav className="p-3 overflow-y-auto h-[calc(100%-57px)]">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-3 mb-1">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 active:bg-gray-100'
                    }`
                  }
                >
                  <span className="text-lg leading-none">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <PendingBadge />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DirectorDrawer.jsx
git commit -m "feat: add DirectorDrawer left-slide navigation component"
```

---

## Task 9: Layout.jsx — director header and drawer

**Files:**
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Replace `frontend/src/components/Layout.jsx` entirely**

```jsx
import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import DirectorDrawer from './DirectorDrawer'

const PAGE_TITLES = {
  '/': 'Home',
  '/claims/new': 'New Claim',
  '/analytics': 'Analytics',
  '/pending-registrations': 'Approvals',
  '/team': 'Finance Team',
  '/cca-treasurers': 'CCA Treasurers',
  '/settings': 'Settings',
  '/contact': 'Contact',
  '/identifiers': 'Identifiers',
}

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/claims/') ? 'Claim' : 'Home')

  if (isDirector) {
    return (
      <div className="flex flex-col h-screen">
        <header className="fixed top-0 left-0 right-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-2xl text-gray-700 p-1 -ml-1"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="font-semibold text-gray-900 text-base">{pageTitle}</span>
        </header>
        <main className="flex-1 overflow-y-auto pt-14">
          <Outlet />
        </main>
        <DirectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 flex">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">🏠</span>
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/claims/new"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">➕</span>
          <span>New Claim</span>
        </NavLink>
        {!isTreasurer && (
          <NavLink
            to="/identifiers"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }
          >
            <span className="text-xl">👥</span>
            <span>Identifiers</span>
          </NavLink>
        )}
        {!isTreasurer && (
          <NavLink
            to="/contact"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }
          >
            <span className="text-xl">💬</span>
            <span>Contact</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Verify in the browser**

Open the app as a director. Confirm:
- No bottom tab bar visible
- Top header shows ☰ on the left and "Home" in the centre
- Tapping ☰ opens the left drawer with three groups: Claims, Admin, Other
- Tapping the backdrop closes the drawer
- Tapping any drawer item navigates and closes the drawer
- The header title changes to match the current page

Open the app as a member or treasurer. Confirm the bottom tabs are unchanged (Home, New Claim, Identifiers, Contact).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Layout.jsx
git commit -m "feat: director gets top header + left drawer; members/treasurers unchanged"
```

---

## Task 10: FinanceTeamPage

**Files:**
- Create: `frontend/src/pages/FinanceTeamPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/FinanceTeamPage.jsx`**

This page shows only `director` and `member` rows from the team, with director pinned to the top and members sorted alphabetically. The edit form does not include the CCA selector (finance team members don't have CCA assignments).

```jsx
import { useState } from 'react'
import { useTeamMembers, useUpdateTeamMember, useRemoveTeamMember } from '../api/admin'

function RoleBadge({ role }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
      {role === 'director' ? 'Finance Director' : 'Finance Member'}
    </span>
  )
}

function MemberRow({ member, updateMutation, removeMutation }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name || '')
  const [editEmail, setEditEmail] = useState(member.email || '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rowError, setRowError] = useState(null)

  function openEdit() {
    setEditName(member.name || '')
    setEditEmail(member.email || '')
    setRowError(null)
    setEditing(true)
  }

  function handleSave() {
    setRowError(null)
    updateMutation.mutate(
      { id: member.id, role: member.role, cca_ids: [], name: editName.trim() || undefined, email: editEmail.trim() || undefined },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setRowError(err?.response?.data?.detail || 'Update failed.'),
      }
    )
  }

  function handleRemove() {
    setRowError(null)
    removeMutation.mutate(member.id, {
      onSuccess: () => setConfirmRemove(false),
      onError: (err) => setRowError(err?.response?.data?.detail || 'Remove failed.'),
    })
  }

  const isSaving = updateMutation.isPending
  const isRemoving = removeMutation.isPending

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
        </div>
        <RoleBadge role={member.role} />
      </div>

      {rowError && <p className="text-xs text-red-600 mb-2">{rowError}</p>}

      {!editing && !confirmRemove && member.role !== 'director' && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={openEdit}
            className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => { setConfirmRemove(true); setRowError(null) }}
            className="flex-1 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium"
          >
            Remove
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Name</p>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Full name"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Email</p>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Email address"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!editName.trim() || isSaving}
              className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={isSaving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-red-700 mb-2">
            Remove <strong>{member.name}</strong>? They will lose access immediately.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isRemoving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Confirm
            </button>
            <button
              onClick={() => { setConfirmRemove(false); setRowError(null) }}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinanceTeamPage() {
  const { data: allMembers = [], isLoading, isError } = useTeamMembers()
  const updateMutation = useUpdateTeamMember()
  const removeMutation = useRemoveTeamMember()

  const members = allMembers.filter((m) => m.role === 'director' || m.role === 'member')
  const sorted = [
    ...members.filter((m) => m.role === 'director'),
    ...members.filter((m) => m.role === 'member').sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  ]

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <p className="text-center text-red-500 py-12 text-sm">Failed to load team members.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-bold text-gray-900">Finance Team</h1>
        <span className="ml-auto text-xs text-gray-400">{sorted.length} member{sorted.length !== 1 ? 's' : ''}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No team members</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              updateMutation={updateMutation}
              removeMutation={removeMutation}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/FinanceTeamPage.jsx
git commit -m "feat: add FinanceTeamPage showing director and members only"
```

---

## Task 11: CcaTreasurersPage

**Files:**
- Create: `frontend/src/pages/CcaTreasurersPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/CcaTreasurersPage.jsx`**

Treasurers are grouped by portfolio, sorted portfolio-name-ascending then member-name-ascending within each group. A search bar filters by member name OR CCA name (client-side).

```jsx
import { useState, useMemo } from 'react'
import { useTeamMembers, useUpdateTeamMember, useRemoveTeamMember } from '../api/admin'
import { usePublicCcas } from '../api/portfolios'

function TreasurerRow({ member, allCcas, updateMutation, removeMutation }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name || '')
  const [editEmail, setEditEmail] = useState(member.email || '')
  const [editCcaIds, setEditCcaIds] = useState((member.ccas || []).map((c) => c.id))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rowError, setRowError] = useState(null)

  function openEdit() {
    setEditName(member.name || '')
    setEditEmail(member.email || '')
    setEditCcaIds((member.ccas || []).map((c) => c.id))
    setRowError(null)
    setEditing(true)
  }

  function toggleCca(id) {
    setEditCcaIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function handleSave() {
    setRowError(null)
    updateMutation.mutate(
      { id: member.id, role: 'treasurer', cca_ids: editCcaIds, name: editName.trim() || undefined, email: editEmail.trim() || undefined },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setRowError(err?.response?.data?.detail || 'Update failed.'),
      }
    )
  }

  function handleRemove() {
    setRowError(null)
    removeMutation.mutate(member.id, {
      onSuccess: () => setConfirmRemove(false),
      onError: (err) => setRowError(err?.response?.data?.detail || 'Remove failed.'),
    })
  }

  const isSaving = updateMutation.isPending
  const isRemoving = removeMutation.isPending
  const ccaNames = (member.ccas || []).map((c) => c.name).join(', ')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
        </div>
      </div>
      {ccaNames && (
        <p className="text-xs text-gray-400 mb-2">CCAs: {ccaNames}</p>
      )}

      {rowError && <p className="text-xs text-red-600 mb-2">{rowError}</p>}

      {!editing && !confirmRemove && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={openEdit}
            className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => { setConfirmRemove(true); setRowError(null) }}
            className="flex-1 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium"
          >
            Remove
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Name</p>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Full name"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Email</p>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Email address"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">CCAs</p>
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
              {allCcas.map((cca) => (
                <label
                  key={cca.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={editCcaIds.includes(cca.id)}
                    onChange={() => toggleCca(cca.id)}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-800">{cca.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{cca.portfolio?.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!editName.trim() || editCcaIds.length === 0 || isSaving}
              className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={isSaving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-red-700 mb-2">
            Remove <strong>{member.name}</strong>? They will lose access immediately.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isRemoving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Confirm
            </button>
            <button
              onClick={() => { setConfirmRemove(false); setRowError(null) }}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CcaTreasurersPage() {
  const { data: allMembers = [], isLoading, isError } = useTeamMembers()
  const { data: allCcas = [] } = usePublicCcas()
  const updateMutation = useUpdateTeamMember()
  const removeMutation = useRemoveTeamMember()
  const [search, setSearch] = useState('')

  const treasurers = useMemo(() => {
    return allMembers
      .filter((m) => m.role === 'treasurer')
      .sort((a, b) => {
        const pa = a.ccas?.[0]?.portfolio?.name || ''
        const pb = b.ccas?.[0]?.portfolio?.name || ''
        if (pa !== pb) return pa.localeCompare(pb)
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [allMembers])

  const filtered = useMemo(() => {
    if (!search.trim()) return treasurers
    const q = search.toLowerCase()
    return treasurers.filter(
      (m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.ccas || []).some((c) => c.name.toLowerCase().includes(q))
    )
  }, [treasurers, search])

  // Group filtered results by portfolio for display
  const portfolioGroups = useMemo(() => {
    const map = {}
    filtered.forEach((m) => {
      const portfolio = m.ccas?.[0]?.portfolio?.name || 'No Portfolio'
      if (!map[portfolio]) map[portfolio] = []
      map[portfolio].push(m)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <p className="text-center text-red-500 py-12 text-sm">Failed to load treasurers.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-bold text-gray-900">CCA Treasurers</h1>
        <span className="ml-auto text-xs text-gray-400">{treasurers.length} total</span>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or CCA…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">
          {search ? 'No results for that search.' : 'No CCA Treasurers found.'}
        </div>
      ) : (
        <div className="space-y-4">
          {portfolioGroups.map(([portfolio, members]) => (
            <div key={portfolio}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
                {portfolio}
              </p>
              <div className="space-y-3">
                {members.map((member) => (
                  <TreasurerRow
                    key={member.id}
                    member={member}
                    allCcas={allCcas}
                    updateMutation={updateMutation}
                    removeMutation={removeMutation}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/CcaTreasurersPage.jsx
git commit -m "feat: add CcaTreasurersPage with portfolio grouping and search"
```

---

## Task 12: App.jsx — wire up new routes

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Update `frontend/src/App.jsx`**

Replace the file with:

```jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import NewClaimPage from './pages/NewClaimPage'
import ClaimDetailPage from './pages/ClaimDetailPage'
import IdentifierDataPage from './pages/IdentifierDataPage'
import RegistrationPage from './pages/RegistrationPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import TreasurerHomePage from './pages/TreasurerHomePage'
import PendingRegistrationsPage from './pages/PendingRegistrationsPage'
import FinanceTeamPage from './pages/FinanceTeamPage'
import CcaTreasurersPage from './pages/CcaTreasurersPage'
import AnalyticsPage from './pages/AnalyticsPage'
import ApprovalWizardPage from './pages/ApprovalWizardPage'
import ContactPage from './pages/ContactPage'
import SettingsPage from './pages/SettingsPage'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorScreen({ onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
      <p className="text-gray-500 text-sm">The server is busy. Please try again in a moment.</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg active:bg-blue-700"
      >
        Retry
      </button>
    </div>
  )
}

export default function App() {
  const { user, retryAuth } = useAuth()

  if (user === undefined) return <LoadingScreen />
  if (user.status === 'error') return <ErrorScreen onRetry={retryAuth} />
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <Routes>
      {!isTreasurer && (
        <Route path="/claims/:id/approve" element={<ApprovalWizardPage />} />
      )}
      <Route path="/" element={<Layout />}>
        {isTreasurer ? (
          <>
            <Route index element={<TreasurerHomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
          </>
        ) : (
          <>
            <Route index element={<HomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
            <Route path="identifiers" element={<IdentifierDataPage />} />
            <Route path="contact" element={<ContactPage />} />
            {isDirector && (
              <>
                <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                <Route path="team" element={<FinanceTeamPage />} />
                <Route path="cca-treasurers" element={<CcaTreasurersPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </>
            )}
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 2: Verify end-to-end in the browser as director**

Navigate to each drawer item and confirm:
- Home → `HomePage`
- New Claim → `NewClaimPage`
- Analytics → `AnalyticsPage`
- Approvals → `PendingRegistrationsPage`
- Finance Team → `FinanceTeamPage` (director pinned top, members below)
- CCA Treasurers → `CcaTreasurersPage` (portfolio groups, search bar works)
- Settings → `SettingsPage` (pre-filled from DB, save works)
- Contact → `ContactPage`

Confirm that navigating to `/team` as a non-director redirects to `/` (the wildcard route handles this).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: wire director routes — FinanceTeamPage, CcaTreasurersPage, SettingsPage"
```

---

## Self-Review Checklist

- [x] Task 1 seeds `academic_year = '2526'` on conflict do nothing — safe to re-run
- [x] Task 2 `_get_finance_director` remaps `matric_number` → `matric_no` and `phone_number` → `phone` to match `pdf.py` usage
- [x] Task 3 AY read raises 500 if `app_settings` row missing — clear error message
- [x] Task 4 counter format is `:04d` (4 digits) not `:03d`
- [x] Task 5 removes all five env var entries from both `config.py` and the `deploy.yml` Python keys list
- [x] Tasks 6–7 settings hook + page are consistent (`fd_matric_no` key used throughout)
- [x] Task 8 `DirectorDrawer` uses `/team` route (maps to `FinanceTeamPage`) and `/cca-treasurers` (maps to `CcaTreasurersPage`)
- [x] Task 9 `Layout.jsx` removes `usePendingCount` import (now in `DirectorDrawer`) — no unused import
- [x] Task 10 `FinanceTeamPage` director row has no Edit/Remove buttons (director cannot remove themselves)
- [x] Task 11 `CcaTreasurersPage` search filters on both name and CCA name client-side
- [x] Task 12 `App.jsx` imports `FinanceTeamPage` not old `TeamPage` for the `/team` route
