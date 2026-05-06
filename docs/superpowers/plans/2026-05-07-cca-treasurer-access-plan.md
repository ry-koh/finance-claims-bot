# CCA Treasurer Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `treasurer` role to the Finance Claims Mini App, with scoped claim creation, a submit-for-review workflow, director-gated onboarding for all new users, and a finance team review panel including attachment re-cropping.

**Architecture:** Extend the existing `finance_team` table with `status` and `email` columns plus a `treasurer_ccas` junction table. Add `pending_review` to the claim status machine. Gate all existing pipeline endpoints behind a new `require_finance_team()` middleware. Add a React AuthContext that routes unregistered/pending users to new screens before the normal app loads.

**Tech Stack:** FastAPI + Supabase (PostgREST) backend, React + TanStack Query frontend, Tailwind CSS, existing `ImageCropModal` component for re-cropping.

**Critical constraint:** No existing feature, endpoint, or UI component may be removed or broken. All changes are additive.

---

## File Map

**New backend files:**
- `backend/app/routers/registration.py` — `/me`, `POST /register`, `PUT /register`
- `backend/app/routers/admin.py` — director-only pending approval endpoints

**Modified backend files:**
- `backend/app/models.py` — add `PENDING_REVIEW`, `TREASURER`, `FinanceTeamMemberCreate` update
- `backend/app/auth.py` — update `require_auth()`, add `require_finance_team()`
- `backend/app/main.py` — include new routers
- `backend/app/routers/claims.py` — treasurer filter on list, WBS validation, new review endpoints
- `backend/app/routers/email.py` — `require_finance_team()`, allow `pending_review` status
- `backend/app/routers/documents.py` — `require_finance_team()` on pipeline endpoints
- `backend/app/services/gmail.py` — CC instruction in email body

**New frontend files:**
- `frontend/src/context/AuthContext.jsx` — user state, role helpers
- `frontend/src/api/auth.js` — `getMe`, `register`, `updateRegistration`
- `frontend/src/api/admin.js` — pending registration management
- `frontend/src/pages/RegistrationPage.jsx`
- `frontend/src/pages/PendingApprovalPage.jsx`
- `frontend/src/pages/PendingRegistrationsPage.jsx`
- `frontend/src/pages/TreasurerHomePage.jsx`
- `frontend/src/pages/AnalyticsPage.jsx` — "Coming soon" placeholder

**Modified frontend files:**
- `frontend/src/main.jsx` — wrap with AuthProvider
- `frontend/src/App.jsx` — role-aware routing
- `frontend/src/components/Layout.jsx` — pending badge (director), Analytics nav entry
- `frontend/src/pages/HomePage.jsx` — add `pending_review` tab
- `frontend/src/pages/NewClaimPage.jsx` — role-aware form fields
- `frontend/src/pages/ClaimDetailPage.jsx` — review panel, rejection banner, submit-for-review
- `frontend/src/api/claims.js` — new review mutation hooks
- `frontend/src/constants/claimConstants.js` — add `pending_review` to STATUSES

---

## Task 1: Supabase DB Migration

**Files:**
- Run SQL in Supabase dashboard (Settings → SQL Editor)

- [ ] **Step 1: Run the migration SQL**

```sql
-- 1. Add status and email columns to finance_team
ALTER TABLE finance_team
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending')),
  ADD COLUMN IF NOT EXISTS email text;

-- 2. Update role check to include treasurer
ALTER TABLE finance_team
  DROP CONSTRAINT IF EXISTS finance_team_role_check;
ALTER TABLE finance_team
  ADD CONSTRAINT finance_team_role_check
    CHECK (role IN ('director', 'member', 'treasurer'));

-- 3. Create treasurer_ccas junction table
CREATE TABLE IF NOT EXISTS treasurer_ccas (
  finance_team_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  cca_id          uuid NOT NULL REFERENCES ccas(id) ON DELETE CASCADE,
  PRIMARY KEY (finance_team_id, cca_id)
);

-- 4. Add rejection_comment to claims
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS rejection_comment text;

-- 5. Update claims status check to include pending_review
ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_status_check
    CHECK (status IN (
      'draft', 'pending_review', 'email_sent', 'screenshot_pending',
      'screenshot_uploaded', 'docs_generated', 'compiled',
      'submitted', 'reimbursed', 'error'
    ));
```

- [ ] **Step 2: Verify in Supabase table editor**

Check `finance_team` has `status` (default `active`) and `email` columns.
Check `treasurer_ccas` table exists.
Check `claims` has `rejection_comment` column.

- [ ] **Step 3: Enable RLS on treasurer_ccas (match finance_team pattern)**

In Supabase dashboard → Table Editor → `treasurer_ccas` → RLS → enable and add permissive policy for service role (same as other tables).

---

## Task 2: Backend Models + Auth Middleware

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/auth.py`

- [ ] **Step 1: Update `ClaimStatus` and `UserRole` enums in `models.py`**

In `backend/app/models.py`, change:

```python
class WBSAccount(str, Enum):
    SA = "SA"
    MBH = "MBH"
    MF = "MF"


class ClaimStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    EMAIL_SENT = "email_sent"
    SCREENSHOT_PENDING = "screenshot_pending"
    SCREENSHOT_UPLOADED = "screenshot_uploaded"
    DOCS_GENERATED = "docs_generated"
    COMPILED = "compiled"
    SUBMITTED = "submitted"
    REIMBURSED = "reimbursed"
    ERROR = "error"


class UserRole(str, Enum):
    DIRECTOR = "director"
    MEMBER = "member"
    TREASURER = "treasurer"
```

- [ ] **Step 2: Update `auth.py`**

Replace the entire contents of `backend/app/auth.py` with:

```python
from fastapi import Depends, Header, HTTPException
from supabase import Client

from app.database import get_supabase


async def require_auth(
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
) -> dict:
    """
    Validates the Telegram user ID against the finance_team table.
    Returns the member row as a dict.
    Raises 401 if unregistered, 403 if pending approval.
    """
    response = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=401, detail="unregistered")
    member = response.data[0]
    if member.get("status") == "pending":
        raise HTTPException(status_code=403, detail="pending")
    return member


async def require_finance_team(
    member: dict = Depends(require_auth),
) -> dict:
    """
    Requires the authenticated user to be a finance member or director.
    Treasurers are rejected with 403.
    """
    if member.get("role") == "treasurer":
        raise HTTPException(status_code=403, detail="Finance team access required")
    return member


async def require_director(
    member: dict = Depends(require_auth),
) -> dict:
    """
    Requires the authenticated user to have the 'director' role.
    """
    if member.get("role") != "director":
        raise HTTPException(status_code=403, detail="Access denied: director role required")
    return member
```

- [ ] **Step 3: Verify the app still starts**

```bash
cd backend
uvicorn app.main:app --reload
```

Expected: server starts, no import errors.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/auth.py
git commit -m "feat: add treasurer role, pending_review status, require_finance_team middleware"
```

---

## Task 3: Backend Registration Endpoints

**Files:**
- Create: `backend/app/routers/registration.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/routers/registration.py`**

```python
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.database import get_supabase

router = APIRouter(tags=["registration"])


class RegisterRequest(BaseModel):
    name: str
    email: str
    role: str          # "member" or "treasurer"
    cca_ids: list[str] = []


@router.get("/me")
async def get_me(
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """
    Returns current user's status and data.
    Always 200:
      {"status": "unregistered"} if not in DB
      {...member, "status": "pending", "ccas": [...]} if pending
      {...member, "ccas": [...]} if active treasurer
      {...member} if active member/director
    """
    response = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    if not response.data:
        return {"status": "unregistered"}

    member = response.data[0]

    # Attach CCA details for treasurers
    if member.get("role") == "treasurer":
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id, ccas(id, name)")
            .eq("finance_team_id", member["id"])
            .execute()
        )
        member["ccas"] = [row["ccas"] for row in (cca_links.data or []) if row.get("ccas")]

    return member


@router.post("/register")
async def register(
    payload: RegisterRequest,
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """Create a pending finance_team registration."""
    if payload.role not in ("member", "treasurer"):
        raise HTTPException(400, "role must be 'member' or 'treasurer'")
    if payload.role == "member" and not payload.email.endswith("@u.nus.edu"):
        raise HTTPException(400, "Finance members must use an @u.nus.edu email address")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must select at least one CCA")
    if not payload.name.strip():
        raise HTTPException(400, "Name is required")

    existing = (
        db.table("finance_team")
        .select("id")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, "Already registered")

    result = db.table("finance_team").insert({
        "telegram_id": int(telegram_id),
        "name": payload.name.strip(),
        "email": payload.email.strip().lower(),
        "role": payload.role,
        "status": "pending",
    }).execute()
    member = result.data[0]

    if payload.role == "treasurer" and payload.cca_ids:
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member["id"], "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()

    return member


@router.put("/register")
async def update_registration(
    payload: RegisterRequest,
    telegram_id: str = Header(..., alias="X-Telegram-User-Id"),
    db: Client = Depends(get_supabase),
):
    """Update a pending registration (edit before approval)."""
    existing = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .eq("status", "pending")
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "No pending registration found")
    member = existing.data[0]

    if payload.role == "member" and not payload.email.endswith("@u.nus.edu"):
        raise HTTPException(400, "Finance members must use an @u.nus.edu email address")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must select at least one CCA")

    db.table("finance_team").update({
        "name": payload.name.strip(),
        "email": payload.email.strip().lower(),
        "role": payload.role,
    }).eq("id", member["id"]).execute()

    # Replace CCA links
    db.table("treasurer_ccas").delete().eq("finance_team_id", member["id"]).execute()
    if payload.role == "treasurer" and payload.cca_ids:
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member["id"], "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()

    return {"success": True}
```

- [ ] **Step 2: Register the router in `backend/app/main.py`**

Add to the imports at the top:
```python
from app.routers import registration as registration_router
```

Add after the existing `app.include_router(images_router.router)` line:
```python
app.include_router(registration_router.router)
```

- [ ] **Step 3: Verify endpoints exist**

```bash
curl http://localhost:8000/me -H "X-Telegram-User-Id: 99999999"
```
Expected: `{"status": "unregistered"}`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/registration.py backend/app/main.py
git commit -m "feat: add /me, POST /register, PUT /register endpoints"
```

---

## Task 4: Backend Admin Endpoints (Director)

**Files:**
- Create: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/routers/admin.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.auth import require_director
from app.database import get_supabase

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/pending-registrations")
async def list_pending(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """List all pending registration requests (director only)."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .execute()
    )
    members = resp.data or []

    for member in members:
        if member.get("role") == "treasurer":
            cca_resp = (
                db.table("treasurer_ccas")
                .select("cca_id, ccas(id, name)")
                .eq("finance_team_id", member["id"])
                .execute()
            )
            member["ccas"] = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]

    return members


@router.get("/pending-registrations/count")
async def pending_count(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Return count of pending registrations for the badge."""
    resp = (
        db.table("finance_team")
        .select("id", count="exact")
        .eq("status", "pending")
        .execute()
    )
    return {"count": resp.count or 0}


@router.post("/approve/{member_id}")
async def approve_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """
    Approve a pending registration.
    For treasurers: auto-creates one Claimer record per linked CCA.
    """
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "pending")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")
    member = resp.data[0]

    db.table("finance_team").update({"status": "active"}).eq("id", member_id).execute()

    if member.get("role") == "treasurer":
        cca_resp = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", member_id)
            .execute()
        )
        for row in (cca_resp.data or []):
            db.table("claimers").insert({
                "cca_id": row["cca_id"],
                "name": member["name"],
                "email": member["email"],
            }).execute()

    return {"success": True}


@router.delete("/reject/{member_id}")
async def reject_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Reject and delete a pending registration."""
    db.table("finance_team").delete().eq("id", member_id).eq("status", "pending").execute()
    return {"success": True}
```

- [ ] **Step 2: Register router in `backend/app/main.py`**

Add import:
```python
from app.routers import admin as admin_router
```

Add router:
```python
app.include_router(admin_router.router)
```

- [ ] **Step 3: Verify**

```bash
# Using your director's telegram ID:
curl http://localhost:8000/admin/pending-registrations/count \
  -H "X-Telegram-User-Id: <YOUR_DIRECTOR_TELEGRAM_ID>"
```
Expected: `{"count": 0}`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/admin.py backend/app/main.py
git commit -m "feat: add director admin endpoints for pending registration approval"
```

---

## Task 5: Backend Claim Review Endpoints + Email + Guards

**Files:**
- Modify: `backend/app/routers/claims.py`
- Modify: `backend/app/routers/email.py`
- Modify: `backend/app/routers/documents.py`
- Modify: `backend/app/services/gmail.py`

- [ ] **Step 1: Add review endpoints to `backend/app/routers/claims.py`**

At the top of `claims.py`, add `require_finance_team` to the auth imports:
```python
from app.auth import require_auth, require_director, require_finance_team
```

Add a `RejectReviewRequest` model after the existing `BulkStatusUpdate` class:
```python
class RejectReviewRequest(PydanticBaseModel):
    comment: str
```

Add these three new route handlers at the end of the file (before any existing routes that might conflict):

```python
# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/submit-review  (treasurer only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/submit-review")
async def submit_for_review(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer moves their DRAFT claim to PENDING_REVIEW."""
    if member.get("role") != "treasurer":
        raise HTTPException(403, "Only treasurers can submit for review")
    claim = _get_claim_or_404(db, claim_id)
    if str(claim.get("filled_by")) != str(member["id"]):
        raise HTTPException(403, "You can only submit your own claims")
    if claim.get("status") != "draft":
        raise HTTPException(400, f"Claim must be in draft status, currently: {claim.get('status')}")
    db.table("claims").update({
        "status": "pending_review",
        "rejection_comment": None,
    }).eq("id", claim_id).execute()
    return {"success": True, "status": "pending_review"}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/reject-review  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/reject-review")
async def reject_review(
    claim_id: str,
    payload: RejectReviewRequest,
    _member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Finance team rejects a PENDING_REVIEW claim back to DRAFT with a comment."""
    claim = _get_claim_or_404(db, claim_id)
    if claim.get("status") != "pending_review":
        raise HTTPException(400, "Claim is not in pending_review status")
    db.table("claims").update({
        "status": "draft",
        "rejection_comment": payload.comment,
    }).eq("id", claim_id).execute()
    return {"success": True, "status": "draft"}
```

- [ ] **Step 2: Add treasurer filter to `GET /claims` in `claims.py`**

Find the `list_claims` function. After `_member: dict = Depends(require_auth)` is resolved, add a treasurer filter. Find the line where `query` is built and add before the `if status:` check:

```python
    # Treasurers can only see claims they created
    if _member.get("role") == "treasurer":
        query = query.eq("filled_by", _member["id"])
```

- [ ] **Step 3: Add WBS and CCA validation to `POST /claims` in `claims.py`**

Find the `create_claim` function. After `_member: dict = Depends(require_auth)`, add validation for treasurers. Find where the claim is inserted and add before the insert:

```python
    if _member.get("role") == "treasurer":
        if str(payload.wbs_account) == "MBH":
            raise HTTPException(400, "Treasurers cannot select MBH as WBS account")
        # Validate claimer belongs to treasurer's CCA
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", _member["id"])
            .execute()
        )
        allowed_cca_ids = {row["cca_id"] for row in (cca_links.data or [])}
        claimer_resp = (
            db.table("claimers")
            .select("cca_id")
            .eq("id", str(payload.claimer_id))
            .execute()
        )
        if not claimer_resp.data or claimer_resp.data[0]["cca_id"] not in allowed_cca_ids:
            raise HTTPException(403, "You can only create claims for your own CCA")
```

- [ ] **Step 4: Update `email.py` — add `require_finance_team` and allow `pending_review`**

In `backend/app/routers/email.py`, change:
```python
from app.auth import require_auth
```
to:
```python
from app.auth import require_finance_team
```

In `send_claim_email`, change:
```python
    _member: dict = Depends(require_auth),
```
to:
```python
    _member: dict = Depends(require_finance_team),
```

In `resend_claim_email`, same change.

In `send_claim_email`, change the allowed statuses check from:
```python
    allowed_statuses = {"draft", "email_sent"}
```
to:
```python
    allowed_statuses = {"draft", "pending_review", "email_sent"}
```

- [ ] **Step 5: Add CC instruction to email body in `gmail.py`**

In `backend/app/services/gmail.py`, in the `build_claim_email` function, find the line:
```python
  <p>Please copy and paste everything below the line into a new email. You do not need to reattach the attachments.{"<br><br><strong>Remember to CC:</strong> " + ", ".join(cc_reminder_emails) if cc_reminder_emails else ""}</p>
```

Replace it with:
```python
  <p>Please copy and paste everything below the line into a new email. You do not need to reattach the attachments.{"<br><br><strong>Remember to CC:</strong> " + ", ".join(cc_reminder_emails) if cc_reminder_emails else ""}<br><br><strong>Important:</strong> When replying, please CC <strong>68findirector.rh@gmail.com</strong> so that our finance team can track your response.</p>
```

- [ ] **Step 6: Add `require_finance_team` to document pipeline endpoints in `documents.py`**

In `backend/app/routers/documents.py`, add `require_finance_team` to the auth import:
```python
from app.auth import require_auth, require_director, require_finance_team
```

For each of these endpoints, change `Depends(require_auth)` to `Depends(require_finance_team)`:
- `generate_documents` (POST `/documents/generate/{claim_id}`)
- `compile_documents` (POST `/documents/compile/{claim_id}`)
- `send_to_telegram` (POST `/documents/send-to-telegram`)
- `upload_screenshot` (POST `/documents/screenshot/{claim_id}`)
- `upload_mf_approval` (POST `/documents/mf-approval/{claim_id}`)

Leave `require_auth` on any GET endpoints (viewing documents is fine for all roles).

- [ ] **Step 7: Verify backend compiles and runs**

```bash
uvicorn app.main:app --reload
```
No import errors expected.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/claims.py backend/app/routers/email.py \
        backend/app/routers/documents.py backend/app/services/gmail.py
git commit -m "feat: claim review endpoints, treasurer guards, CC instruction in email"
```

---

## Task 6: Frontend Auth Context + API + App Routing

**Files:**
- Create: `frontend/src/context/AuthContext.jsx`
- Create: `frontend/src/api/auth.js`
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create `frontend/src/api/auth.js`**

```js
import api from './client'

export const getMe = () => api.get('/me').then((r) => r.data)

export const register = (payload) => api.post('/register', payload).then((r) => r.data)

export const updateRegistration = (payload) => api.put('/register', payload).then((r) => r.data)
```

- [ ] **Step 2: Create `frontend/src/context/AuthContext.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { getMe } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still loading

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser({ status: 'unregistered' }))
  }, [])

  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

// Convenience helpers
export function useIsDirector() {
  const { user } = useAuth()
  return user?.role === 'director'
}

export function useIsFinanceTeam() {
  const { user } = useAuth()
  return user?.role === 'director' || user?.role === 'member'
}

export function useIsTreasurer() {
  const { user } = useAuth()
  return user?.role === 'treasurer'
}
```

- [ ] **Step 3: Wrap app with `AuthProvider` in `frontend/src/main.jsx`**

Read the current `main.jsx` first, then add the import and wrap:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
)
```

*(Preserve the exact existing imports — just add `AuthProvider` wrapping inside `QueryClientProvider`.)*

- [ ] **Step 4: Update `frontend/src/App.jsx` for role-aware routing**

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
import AnalyticsPage from './pages/AnalyticsPage'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const { user } = useAuth()

  if (user === undefined) return <LoadingScreen />
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <Routes>
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
            {isDirector && (
              <>
                <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
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

- [ ] **Step 5: Verify app loads without crash**

Run `npm run dev` in `frontend/`. Open the app. Because `getMe` will return `unregistered` (no Telegram ID in dev), you'll see a blank/errored registration page — that's expected. No console errors from routing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/context/AuthContext.jsx frontend/src/api/auth.js \
        frontend/src/main.jsx frontend/src/App.jsx
git commit -m "feat: auth context, /me API, role-aware routing shell"
```

---

## Task 7: Frontend Registration + Pending Screens

**Files:**
- Create: `frontend/src/pages/RegistrationPage.jsx`
- Create: `frontend/src/pages/PendingApprovalPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/RegistrationPage.jsx`**

```jsx
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { register } from '../api/auth'
import { useCcas } from '../api/portfolios'

// useCcas fetches all CCAs flat — check portfolios.js; if not present, add:
// export const useCcas = () => useQuery({ queryKey: ['ccas'], queryFn: () => api.get('/claimers/ccas').then(r => r.data) })
// Actually use the existing portfolios API which returns portfolios with CCAs nested.

export default function RegistrationPage() {
  const { setUser } = useAuth()
  const [role, setRole] = useState('')          // 'member' | 'treasurer'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [selectedCcaIds, setSelectedCcaIds] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Fetch portfolios (each has .ccas array) for CCA selection
  const { data: portfolios = [] } = useCcas()

  // Flatten portfolios → CCAs list
  const allCcas = portfolios.flatMap((p) => (p.ccas || []).map((c) => ({ ...c, portfolioName: p.name })))

  function toggleCca(id) {
    setSelectedCcaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        cca_ids: role === 'treasurer' ? selectedCcaIds : [],
      })
      setUser(result)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Welcome</h1>
        <p className="text-sm text-gray-500 mb-6">Register to access the Finance Claims app</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Role picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">I am a</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'treasurer', label: 'CCA Treasurer' },
                { value: 'member', label: 'Finance Team Member' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors ${
                    role === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {role && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Your full name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                  {role === 'member' && (
                    <span className="text-gray-400 font-normal ml-1">(@u.nus.edu)</span>
                  )}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={role === 'member' ? 'eXXXXXXX@u.nus.edu' : 'your@email.com'}
                />
              </div>

              {role === 'treasurer' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Your CCA(s) <span className="text-red-500">*</span>
                  </label>
                  <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
                    {allCcas.map((cca) => (
                      <label key={cca.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCcaIds.includes(cca.id)}
                          onChange={() => toggleCca(cca.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-800">{cca.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{cca.portfolioName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !name.trim() || !email.trim() || (role === 'treasurer' && selectedCcaIds.length === 0)}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit Registration'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
```

**Note:** `useCcas` needs to fetch portfolios with CCAs. Check if `portfolios.js` already exports `usePortfolios` that returns nested CCAs. If the existing `usePortfolios` hook returns `[{ id, name, ccas: [{id, name}] }]`, use that directly. If it doesn't nest CCAs, add a helper:

```js
// In frontend/src/api/portfolios.js — add if not already present:
export const usePortfoliosWithCcas = () =>
  useQuery({
    queryKey: ['portfolios', 'with-ccas'],
    queryFn: () => api.get('/portfolios?include_ccas=true').then((r) => r.data),
  })
```

Then in `RegistrationPage.jsx`, replace `useCcas` with `usePortfoliosWithCcas`.

- [ ] **Step 2: Create `frontend/src/pages/PendingApprovalPage.jsx`**

```jsx
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateRegistration, getMe } from '../api/auth'
import { usePortfolios } from '../api/portfolios'

export default function PendingApprovalPage() {
  const { user, setUser } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [selectedCcaIds, setSelectedCcaIds] = useState(
    (user?.ccas || []).map((c) => c.id)
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: portfolios = [] } = usePortfolios()
  const allCcas = portfolios.flatMap((p) => (p.ccas || []).map((c) => ({ ...c, portfolioName: p.name })))

  function toggleCca(id) {
    setSelectedCcaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await updateRegistration({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: user.role,
        cca_ids: user.role === 'treasurer' ? selectedCcaIds : [],
      })
      const updated = await getMe()
      setUser(updated)
      setEditing(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl">⏳</div>
          <div>
            <h1 className="text-base font-bold text-gray-900">Awaiting Approval</h1>
            <p className="text-xs text-gray-500">Your registration is being reviewed</p>
          </div>
        </div>

        {!editing ? (
          <div className="space-y-2 mb-4">
            <Detail label="Name" value={user?.name} />
            <Detail label="Email" value={user?.email} />
            <Detail label="Role" value={user?.role === 'treasurer' ? 'CCA Treasurer' : 'Finance Team Member'} />
            {user?.role === 'treasurer' && user?.ccas?.length > 0 && (
              <Detail label="CCA(s)" value={(user.ccas || []).map((c) => c.name).join(', ')} />
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Email {user?.role === 'member' && <span className="text-gray-400 font-normal">(@u.nus.edu)</span>}
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            {user?.role === 'treasurer' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CCA(s)</label>
                <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {allCcas.map((cca) => (
                    <label key={cca.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selectedCcaIds.includes(cca.id)} onChange={() => toggleCca(cca.id)} className="rounded" />
                      <span className="text-sm">{cca.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </form>
        )}

        {!editing && (
          <button onClick={() => setEditing(true)}
            className="w-full py-2 border border-gray-300 rounded-xl text-sm text-gray-600 font-medium">
            Edit Registration
          </button>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value || '—'}</span>
    </div>
  )
}
```

- [ ] **Step 3: Check `usePortfolios` includes nested CCAs**

Open `frontend/src/api/portfolios.js`. If the portfolios endpoint returns objects without a `ccas` array, you need to either:
a) Add a `?include_ccas=true` param and handle it in the backend, or
b) Make a separate call to fetch all CCAs.

Check what `/portfolios` returns by checking `backend/app/routers/portfolios.py`. Adjust the frontend to match the actual shape.

- [ ] **Step 4: Verify pages render**

Open the frontend — because `getMe` returns `{status: 'unregistered'}` in dev (no real Telegram ID), `RegistrationPage` should show. No console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RegistrationPage.jsx frontend/src/pages/PendingApprovalPage.jsx
git commit -m "feat: registration and pending approval screens"
```

---

## Task 8: Frontend Director Approval Screen + Badge

**Files:**
- Create: `frontend/src/api/admin.js`
- Create: `frontend/src/pages/PendingRegistrationsPage.jsx`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Create `frontend/src/api/admin.js`**

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const PENDING_KEYS = {
  all: ['pending-registrations'],
  count: ['pending-registrations', 'count'],
}

export const fetchPendingRegistrations = () =>
  api.get('/admin/pending-registrations').then((r) => r.data)

export const fetchPendingCount = () =>
  api.get('/admin/pending-registrations/count').then((r) => r.data.count)

export const approveRegistration = (memberId) =>
  api.post(`/admin/approve/${memberId}`).then((r) => r.data)

export const rejectRegistration = (memberId) =>
  api.delete(`/admin/reject/${memberId}`).then((r) => r.data)

export function usePendingRegistrations() {
  return useQuery({
    queryKey: PENDING_KEYS.all,
    queryFn: fetchPendingRegistrations,
  })
}

export function usePendingCount() {
  return useQuery({
    queryKey: PENDING_KEYS.count,
    queryFn: fetchPendingCount,
    refetchInterval: 60_000,
  })
}

export function useApproveRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: approveRegistration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all }),
    ...options,
  })
}

export function useRejectRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectRegistration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all }),
    ...options,
  })
}
```

- [ ] **Step 2: Create `frontend/src/pages/PendingRegistrationsPage.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import {
  usePendingRegistrations,
  useApproveRegistration,
  useRejectRegistration,
} from '../api/admin'

export default function PendingRegistrationsPage() {
  const navigate = useNavigate()
  const { data: pending = [], isLoading } = usePendingRegistrations()
  const approve = useApproveRegistration()
  const reject = useRejectRegistration()

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/')} className="text-blue-600 text-sm">← Back</button>
        <h1 className="text-lg font-bold text-gray-900">Pending Registrations</h1>
      </div>

      {pending.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No pending registrations</div>
      ) : (
        <div className="space-y-3">
          {pending.map((member) => (
            <div key={member.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-gray-900">{member.name}</p>
                  <p className="text-xs text-gray-500">{member.email}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  member.role === 'treasurer'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {member.role === 'treasurer' ? 'CCA Treasurer' : 'Finance Member'}
                </span>
              </div>

              {member.role === 'treasurer' && member.ccas?.length > 0 && (
                <p className="text-xs text-gray-500 mb-3">
                  CCAs: {member.ccas.map((c) => c.name).join(', ')}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => approve.mutate(member.id)}
                  disabled={approve.isPending || reject.isPending}
                  className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject.mutate(member.id)}
                  disabled={approve.isPending || reject.isPending}
                  className="flex-1 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update `frontend/src/components/Layout.jsx` — badge + Analytics nav**

Replace the contents of `Layout.jsx` with:

```jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth, useIsDirector } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'

function PendingBadge() {
  const { data: count = 0 } = usePendingCount()
  if (!count) return null
  return (
    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function Layout() {
  const isDirector = useIsDirector()

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 flex">
        <NavLink to="/" end className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">🏠</span>
          <span>Home</span>
        </NavLink>
        <NavLink to="/claims/new" className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">➕</span>
          <span>New Claim</span>
        </NavLink>
        <NavLink to="/identifiers" className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">👥</span>
          <span>Identifiers</span>
        </NavLink>
        {isDirector && (
          <>
            <NavLink to="/pending-registrations" className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs relative ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }>
              <span className="relative text-xl">
                👤
                <PendingBadge />
              </span>
              <span>Approvals</span>
            </NavLink>
            <NavLink to="/analytics" className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }>
              <span className="text-xl">📊</span>
              <span>Analytics</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
```

**Note:** The `usePendingCount` hook is only called inside `PendingBadge` which is only rendered for directors. Non-directors never trigger the admin API call.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/admin.js frontend/src/pages/PendingRegistrationsPage.jsx \
        frontend/src/components/Layout.jsx
git commit -m "feat: director approval screen, pending badge, analytics nav entry"
```

---

## Task 9: Frontend Treasurer Home + Analytics Placeholder

**Files:**
- Create: `frontend/src/pages/TreasurerHomePage.jsx`
- Create: `frontend/src/pages/AnalyticsPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/TreasurerHomePage.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import { useClaims } from '../api/claims'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_review: 'Under Review',
  email_sent: 'Email Sent',
  screenshot_pending: 'Screenshot Pending',
  screenshot_uploaded: 'Screenshot Uploaded',
  docs_generated: 'Docs Generated',
  compiled: 'Compiled',
  submitted: 'Submitted',
  reimbursed: 'Reimbursed',
  error: 'Error',
}

const STATUS_BADGE = {
  draft: 'bg-gray-200 text-gray-800',
  pending_review: 'bg-amber-100 text-amber-800',
  email_sent: 'bg-blue-100 text-blue-800',
  screenshot_pending: 'bg-amber-100 text-amber-800',
  screenshot_uploaded: 'bg-orange-100 text-orange-800',
  docs_generated: 'bg-purple-100 text-purple-800',
  compiled: 'bg-indigo-100 text-indigo-800',
  submitted: 'bg-green-100 text-green-800',
  reimbursed: 'bg-teal-100 text-teal-800',
  error: 'bg-red-100 text-red-800',
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatAmount(amount) {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-28 mb-3" />
      <div className="flex justify-between">
        <div className="h-3 bg-gray-200 rounded w-20" />
        <div className="h-5 bg-gray-200 rounded w-24" />
      </div>
    </div>
  )
}

export default function TreasurerHomePage() {
  const navigate = useNavigate()
  const { data, isLoading } = useClaims({ page_size: 100 })
  const claims = data?.items || data?.data || []

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-900">My Claims</h1>
        <button
          onClick={() => navigate('/claims/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          + New Claim
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : claims.length === 0 ? (
        <div className="text-center text-gray-400 py-16 text-sm">
          No claims yet. Tap + New Claim to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <button
              key={claim.id}
              onClick={() => navigate(`/claims/${claim.id}`)}
              className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors"
            >
              {claim.rejection_comment && claim.status === 'draft' && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1 mb-2 font-medium">
                  ⚠ Action required — tap to view feedback
                </div>
              )}
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900 break-all leading-tight">
                  {claim.reference_code ?? `#${claim.id}`}
                </span>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[claim.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {STATUS_LABELS[claim.status] ?? claim.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate mb-2">{claim.claim_description}</p>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{formatDate(claim.date)}</span>
                <span className="font-medium text-gray-700">{formatAmount(claim.total_amount)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Note:** Check the exact shape of `useClaims` response — it may return `{ items, total }` or `{ data, count }`. Adjust `claims` extraction accordingly by inspecting an actual API response.

- [ ] **Step 2: Create `frontend/src/pages/AnalyticsPage.jsx`**

```jsx
export default function AnalyticsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center p-4">
      <span className="text-4xl mb-3">📊</span>
      <h1 className="text-lg font-bold text-gray-900 mb-1">Analytics</h1>
      <p className="text-sm text-gray-400">CCA expense breakdown and fund analytics coming soon.</p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TreasurerHomePage.jsx frontend/src/pages/AnalyticsPage.jsx
git commit -m "feat: treasurer home (flat claim list) and analytics placeholder"
```

---

## Task 10: Frontend Role-Aware New Claim Form

**Files:**
- Modify: `frontend/src/pages/NewClaimPage.jsx`
- Modify: `frontend/src/constants/claimConstants.js`

- [ ] **Step 1: Add `pending_review` to `claimConstants.js`**

The constants file currently doesn't list statuses, but `ClaimDetailPage` and `HomePage` hardcode them. No change needed to this file for the status — it's handled per-page. However add a convenience export:

In `frontend/src/constants/claimConstants.js`, add at the bottom:
```js
export const TREASURER_WBS_ACCOUNTS = ['SA', 'MF']
```

- [ ] **Step 2: Add `useAuth` import and role-aware logic to `NewClaimPage.jsx`**

At the top of `NewClaimPage.jsx`, add:
```jsx
import { useAuth } from '../context/AuthContext'
```

Inside the `NewClaimPage` component, add near the top:
```jsx
const { user } = useAuth()
const isTreasurer = user?.role === 'treasurer'
const availableWbsAccounts = isTreasurer ? ['SA', 'MF'] : WBS_ACCOUNTS
```

- [ ] **Step 3: Treasurer auto-fill in Step 1 (Who)**

In Step 1, the form currently shows portfolio → CCA → claimer selects. For treasurers, replace this with:

Find the Step 1 render section. Add a conditional at the top of the step:

```jsx
{/* Treasurer: show CCA picker (auto-fills claimer) */}
{isTreasurer && (
  <TreasurerClaimerPicker
    user={user}
    value={form.claimer_id}
    onChange={(claimerId) => setForm((f) => ({ ...f, claimer_id: claimerId }))}
  />
)}

{/* Finance team: existing portfolio → CCA → claimer flow */}
{!isTreasurer && (
  /* ...existing Step 1 JSX... */
)}
```

Add the `TreasurerClaimerPicker` component above the `NewClaimPage` export:

```jsx
function TreasurerClaimerPicker({ user, value, onChange }) {
  // user.ccas is [{id: cca_id, name: cca_name}] — attached by /me endpoint
  // Each CCA has a corresponding Claimer record auto-created on approval
  // We need to fetch claimers filtered by the treasurer's CCAs
  const ccaIds = (user?.ccas || []).map((c) => c.id)

  const { data: claimers = [] } = useQuery({
    queryKey: ['claimers', 'treasurer', ccaIds.join(',')],
    queryFn: () =>
      Promise.all(
        ccaIds.map((id) =>
          api.get('/claimers', { params: { cca_id: id } }).then((r) => r.data)
        )
      ).then((results) => results.flat()),
    enabled: ccaIds.length > 0,
  })

  // Auto-select if only one CCA / claimer
  useEffect(() => {
    if (claimers.length === 1 && !value) {
      onChange(claimers[0].id)
    }
  }, [claimers, value, onChange])

  if (claimers.length === 0) return <p className="text-sm text-gray-400">Loading your CCA info…</p>

  if (claimers.length === 1) {
    return (
      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
        Claiming as: <strong>{claimers[0].name}</strong> ({user?.ccas?.[0]?.name})
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        Which CCA is this claim for? <span className="text-red-500">*</span>
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        <option value="" disabled>Select CCA</option>
        {claimers.map((c) => (
          <option key={c.id} value={c.id}>{c.name} — {user?.ccas?.find(cca => cca.id === c.cca_id)?.name}</option>
        ))}
      </select>
    </div>
  )
}
```

Add required imports at the top of `NewClaimPage.jsx`:
```jsx
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
```

- [ ] **Step 4: Hide category/GST/DR-CR in Step 3 for treasurers**

In Step 3, find where `category`, `gst_code`, and `dr_cr` fields are rendered in the receipt form. Wrap each with:
```jsx
{!isTreasurer && (
  /* category / gst / dr_cr fields */
)}
```

- [ ] **Step 5: Restrict WBS options in Step 2 for treasurers**

Find where `WBS_ACCOUNTS` is mapped for the WBS select dropdown. Replace `WBS_ACCOUNTS` with `availableWbsAccounts`.

- [ ] **Step 6: Hide remarks field in Step 2 for treasurers**

Find the remarks textarea in Step 2. Wrap with:
```jsx
{!isTreasurer && (
  /* remarks field */
)}
```

- [ ] **Step 7: Verify in browser**

Test as a mock finance user — all fields should appear. Test as a mock treasurer (by temporarily forcing `user.role = 'treasurer'` in `AuthContext`) — category/GST/DR-CR should be hidden, WBS should show only SA/MF, Step 1 should show the treasurer picker.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/NewClaimPage.jsx frontend/src/constants/claimConstants.js
git commit -m "feat: role-aware new claim form for treasurers"
```

---

## Task 11: Frontend Finance Review Panel + Pending Review Tab

**Files:**
- Modify: `frontend/src/api/claims.js`
- Modify: `frontend/src/pages/HomePage.jsx`
- Modify: `frontend/src/pages/ClaimDetailPage.jsx`

- [ ] **Step 1: Add review mutation hooks to `frontend/src/api/claims.js`**

Add at the bottom of `claims.js`:

```js
export const submitForReview = (claimId) =>
  api.post(`/claims/${claimId}/submit-review`).then((r) => r.data)

export const rejectReview = ({ claimId, comment }) =>
  api.post(`/claims/${claimId}/reject-review`, { comment }).then((r) => r.data)

export function useSubmitForReview(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitForReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}

export function useRejectReview(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}
```

- [ ] **Step 2: Add `pending_review` tab to `frontend/src/pages/HomePage.jsx`**

In the `STATUSES` array at the top of `HomePage.jsx`, insert after the `draft` entry:
```js
{ label: 'Pending Review', value: 'pending_review', badge: 'bg-amber-100 text-amber-800' },
```

Also add to `STATUS_BADGE`:
```js
STATUS_BADGE['pending_review'] = 'bg-amber-100 text-amber-800'
```

- [ ] **Step 3: Update `STATUS_ORDER` in `ClaimDetailPage.jsx`**

Find the `STATUS_ORDER` array in `ClaimDetailPage.jsx`:
```js
const STATUS_ORDER = [
  'draft',
  'email_sent',
  ...
]
```

Add `'pending_review'` between `'draft'` and `'email_sent'`:
```js
const STATUS_ORDER = [
  'draft',
  'pending_review',
  'email_sent',
  'screenshot_pending',
  'screenshot_uploaded',
  'docs_generated',
  'compiled',
  'submitted',
  'reimbursed',
]
```

- [ ] **Step 4: Add rejection banner + Submit for Review button to `ClaimDetailPage.jsx`**

Import the new hooks at the top:
```jsx
import { useAuth, useIsFinanceTeam, useIsTreasurer } from '../context/AuthContext'
import { useSubmitForReview, useRejectReview } from '../api/claims'
```

Inside the `ClaimDetailPage` component, add:
```jsx
const { user } = useAuth()
const isTreasurer = useIsTreasurer()
const isFinanceTeam = useIsFinanceTeam()
const submitForReview = useSubmitForReview()
const rejectReview = useRejectReview()
const [showRejectModal, setShowRejectModal] = useState(false)
const [rejectComment, setRejectComment] = useState('')
```

Find where the claim detail header / status section is rendered. Add the rejection banner just below the header:

```jsx
{/* Rejection banner — shown on DRAFT claims that were previously rejected */}
{claim.status === 'draft' && claim.rejection_comment && (
  <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
    <p className="text-xs font-semibold text-red-700 mb-1">Action Required — Finance Team Feedback:</p>
    <p className="text-sm text-red-800">{claim.rejection_comment}</p>
  </div>
)}

{/* Submit for Review button — treasurer DRAFT claims only */}
{isTreasurer && claim.status === 'draft' && (
  <div className="mx-4 mt-3">
    <button
      onClick={() => submitForReview.mutate(claim.id)}
      disabled={submitForReview.isPending}
      className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
    >
      {submitForReview.isPending ? 'Submitting…' : 'Submit for Review'}
    </button>
  </div>
)}
```

- [ ] **Step 5: Add finance team review panel for PENDING_REVIEW claims**

Add a `ReviewPanel` component in `ClaimDetailPage.jsx` above the default export:

```jsx
function ReviewPanel({ claim, receipts, bankTransactions, onApprove, onReject, approving }) {
  const [rejectComment, setRejectComment] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [cropTarget, setCropTarget] = useState(null) // { type: 'receipt'|'bt', id, driveId }

  return (
    <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
      <h2 className="text-sm font-bold text-amber-900 mb-3">Review Submission</h2>

      {/* Attachment preview grid */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Attachments</p>
        <div className="grid grid-cols-3 gap-2">
          {(receipts || []).flatMap((r) =>
            (r.images || []).map((img) => (
              <AttachmentThumb
                key={img.drive_file_id}
                driveId={img.drive_file_id}
                label={r.description}
                onRecrop={() => setCropTarget({ receiptId: r.id, imageId: img.id, driveId: img.drive_file_id })}
              />
            ))
          )}
          {(bankTransactions || []).flatMap((bt) =>
            (bt.images || []).map((img) => (
              <AttachmentThumb
                key={img.drive_file_id}
                driveId={img.drive_file_id}
                label="Bank Transaction"
                onRecrop={() => setCropTarget({ btImageId: img.id, driveId: img.drive_file_id })}
              />
            ))
          )}
        </div>
      </div>

      {/* Category/GST/DR-CR per receipt — rendered by the existing ReceiptInlineForm, which finance team can already edit */}
      <p className="text-xs text-gray-500 mb-4">Fill in category, GST, and DR/CR for each receipt above before approving.</p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={approving}
          className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {approving ? 'Sending…' : 'Approve & Send Email'}
        </button>
        <button
          onClick={() => setShowRejectModal(true)}
          className="flex-1 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold"
        >
          Reject
        </button>
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end p-4">
          <div className="bg-white rounded-2xl w-full p-4 max-w-sm mx-auto">
            <h3 className="font-bold text-gray-900 mb-2">Reject Submission</h3>
            <p className="text-sm text-gray-500 mb-3">Tell the treasurer what needs to be fixed:</p>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3"
              placeholder="e.g. Missing receipt for the $50 item, please reattach."
            />
            <div className="flex gap-2">
              <button
                onClick={() => onReject(rejectComment)}
                disabled={!rejectComment.trim()}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Send Rejection
              </button>
              <button onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-crop modal — uses existing ImageCropModal with src= */}
      {cropTarget && (
        <ImageCropModal
          src={`${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(cropTarget.driveId)}`}
          fileNumber={1}
          fileTotal={1}
          onConfirm={async (croppedFile) => {
            // Upload cropped file and update the image record
            // Use existing uploadReceiptImage or uploadBankTransactionImage
            // then invalidate the claim query
            setCropTarget(null)
          }}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </div>
  )
}

function AttachmentThumb({ driveId, label, onRecrop }) {
  const url = `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(driveId)}`
  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50 aspect-square">
      <img src={url} alt={label} className="w-full h-full object-cover" />
      <button
        onClick={onRecrop}
        className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 active:opacity-100 transition-opacity"
      >
        <span className="text-white text-xs font-medium">Re-crop</span>
      </button>
    </div>
  )
}
```

Import `ImageCropModal` at the top of `ClaimDetailPage.jsx`:
```jsx
import ImageCropModal from '../components/ImageCropModal'
```

- [ ] **Step 6: Wire the ReviewPanel into the existing ClaimDetailPage render**

Inside the `ClaimDetailPage` component body, add the `useSendEmail` mutation reference (it already exists via `import { useSendEmail } from '../api/email'`) and the reject mutation:

```jsx
const rejectReviewMutation = useRejectReview()
```

Find where the claim detail body renders (after the status/header section). Add the review panel just before the existing receipt/BT sections, conditionally for finance team when status is `pending_review`:

```jsx
{isFinanceTeam && claim.status === 'pending_review' && (
  <ReviewPanel
    claim={claim}
    receipts={receipts}
    bankTransactions={bankTransactions}
    approving={sendEmail.isPending}
    onApprove={() => sendEmail.mutate(claim.id)}
    onReject={(comment) =>
      rejectReviewMutation.mutate(
        { claimId: claim.id, comment },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claim.id) }) }
      )
    }
  />
)}
```

**Note on re-crop upload:** In the `ReviewPanel`'s `onConfirm` handler, you need to replace the existing image with the cropped version. The re-crop flow is: upload the cropped file to the same R2 path (or a new one) via `uploadReceiptImage` or `uploadBankTransactionImage`, then update the image record's `drive_file_id`. The exact implementation depends on whether the image is a receipt image or BT image — check `api/receipts.js` and `api/bankTransactions.js` for the correct upload function. Fill in the `onConfirm` handler with the appropriate call.

- [ ] **Step 7: Verify review panel appears**

Create a test claim, submit it for review (manually set status to `pending_review` in Supabase if needed), then open the claim as a finance team member — the review panel should appear.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/claims.js frontend/src/pages/HomePage.jsx \
        frontend/src/pages/ClaimDetailPage.jsx
git commit -m "feat: pending_review tab, rejection banner, submit-for-review, finance review panel"
```

---

## Task 12: Final Wiring + Verification

**Files:**
- Verify: all routes, API calls, and role behaviours end-to-end

- [ ] **Step 1: Smoke test the full registration flow**

1. Open the mini app with a new Telegram account (or simulate with a fake Telegram ID)
2. Should see `RegistrationPage`
3. Register as CCA Treasurer, select a CCA
4. Should land on `PendingApprovalPage`
5. Open as director — `PendingRegistrationsPage` should show the pending entry with badge
6. Approve → treasurer's account activates, a `Claimer` record is created in Supabase
7. Treasurer reloads → sees `TreasurerHomePage`

- [ ] **Step 2: Smoke test the treasurer claim flow**

1. As treasurer: create a new claim — Step 1 auto-fills CCA, Step 2 shows SA/MF only, category/GST/DR-CR hidden
2. Add a receipt with an image, add a bank transaction
3. Click "Submit for Review" → claim status becomes `pending_review`, form becomes read-only

- [ ] **Step 3: Smoke test the finance review flow**

1. As finance team member: open `HomePage` → "Pending Review" tab shows the claim
2. Open the claim → review panel appears with attachments
3. Edit category/GST/DR-CR on the receipt (these fields should be editable as before)
4. Click "Approve & Send Email" → email sent, claim moves to `email_sent`
5. Test reject: create another claim, submit, reject with comment — claim returns to draft with banner

- [ ] **Step 4: Verify existing features are untouched**

1. Finance team creates a new claim directly (DRAFT → EMAIL_SENT path, no pending_review)
2. All WBS options available (SA, MBH, MF)
3. Category/GST/DR-CR visible and editable
4. Document generation, compilation, submission still work
5. Director can do everything a member can, plus approval screens

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: CCA treasurer access — complete implementation"
```

---

## Self-Review Checklist

| Spec requirement | Covered in task |
|---|---|
| `treasurer` role in `finance_team` | Task 2 |
| `status` column (pending/active) | Task 1 |
| `treasurer_ccas` junction table | Task 1 |
| `rejection_comment` column | Task 1 |
| `pending_review` status | Task 1, 2 |
| `/me` endpoint (unregistered/pending/active) | Task 3 |
| `POST /register` + `PUT /register` | Task 3 |
| Director admin approve/reject | Task 4 |
| Auto-create Claimer on approval | Task 4 |
| `require_finance_team()` middleware | Task 2 |
| Apply guard to email/docs endpoints | Task 5 |
| WBS validation (no MBH for treasurer) | Task 5 |
| Treasurer claim list filter | Task 5 |
| `submit-review` endpoint | Task 5 |
| `reject-review` endpoint | Task 5 |
| Allow `pending_review` in email send | Task 5 |
| CC instruction in email body | Task 5 |
| `AuthContext` + role-aware routing | Task 6 |
| `RegistrationPage` | Task 7 |
| `PendingApprovalPage` with edit | Task 7 |
| `PendingRegistrationsPage` (director) | Task 8 |
| Pending badge in Layout | Task 8 |
| `TreasurerHomePage` (flat list, status badge) | Task 9 |
| Rejection comment warning on DRAFT cards | Task 9 |
| `AnalyticsPage` (Coming soon) | Task 9 |
| Analytics nav entry (director only) | Task 8 |
| Treasurer new claim form (restricted) | Task 10 |
| `pending_review` tab on HomePage | Task 11 |
| Rejection banner on ClaimDetailPage | Task 11 |
| Submit for Review button | Task 11 |
| Finance review panel (attachments + re-crop) | Task 11 |
| Approve & Reject actions with modal | Task 11 |
| Existing features preserved | All tasks — additive only |
