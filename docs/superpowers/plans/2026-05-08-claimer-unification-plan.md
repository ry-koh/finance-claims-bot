# Claimer/CCA Treasurer Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate `claimers` table with direct references to `finance_team` (CCA Treasurers), adding inline one-off claimer fields on claims for people outside the system.

**Architecture:** Drop `claimers` table; repurpose `claims.claimer_id` FK to point at `finance_team(id)`; add `cca_id` and four `one_off_*` text columns to `claims`. Backend joins and PDF/email services are updated to read from the new shape. Frontend Step 1 of NewClaimPage replaces the `claimers` dropdown with a `finance_team` treasurer picker plus an optional "one-off" form.

**Tech Stack:** FastAPI + Supabase Python client (backend); React 18 + TanStack Query v5 (frontend); Supabase PostgREST for DB migrations via SQL Editor.

---

## File Map

**Create:**
- `supabase/migrations/019_claimer_unification.sql`

**Modify:**
- `backend/app/models.py`
- `backend/app/routers/claims.py`
- `backend/app/routers/admin.py`
- `backend/app/routers/documents.py`
- `backend/app/routers/email.py`
- `backend/app/services/gmail.py`
- `backend/app/main.py`
- `frontend/src/api/admin.js`
- `frontend/src/pages/NewClaimPage.jsx`
- `frontend/src/pages/ClaimDetailPage.jsx`
- `frontend/src/pages/IdentifierDataPage.jsx`

**Delete:**
- `backend/app/routers/claimers.py`
- `frontend/src/api/claimers.js`

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/019_claimer_unification.sql`

> No automated tests for SQL migrations. Run in Supabase SQL Editor and verify manually.

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 019: Claimer/CCA Treasurer Unification
-- Replaces claimers table with direct finance_team references on claims.

-- 1. Drop old FK from claims.claimer_id → claimers
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_claimer_id_fkey;

-- 2. Make claimer_id nullable (treasurer creates claim → server sets it to their own id;
--    one-off claimers have no claimer_id)
ALTER TABLE claims ALTER COLUMN claimer_id DROP NOT NULL;

-- 3. Add new FK: claims.claimer_id → finance_team(id)
ALTER TABLE claims
  ADD CONSTRAINT claims_claimer_id_fkey
    FOREIGN KEY (claimer_id) REFERENCES finance_team(id) ON DELETE RESTRICT;

-- 4. Add cca_id to claims (required for reference code generation and display)
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS cca_id uuid REFERENCES ccas(id) ON DELETE RESTRICT;

-- 5. Add inline one-off claimer fields
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS one_off_name        text,
  ADD COLUMN IF NOT EXISTS one_off_matric_no   text,
  ADD COLUMN IF NOT EXISTS one_off_phone       text,
  ADD COLUMN IF NOT EXISTS one_off_email       text;

-- 6. Ensure every claim has either a linked treasurer OR a one-off name
ALTER TABLE claims
  ADD CONSTRAINT claims_claimer_check
    CHECK (claimer_id IS NOT NULL OR one_off_name IS NOT NULL);

-- 7. Drop the claimers table (no longer used)
DROP TABLE IF EXISTS claimers;
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Paste the SQL above in Supabase → SQL Editor → Run. Expected output: multiple "Success" messages, no errors.

- [ ] **Step 3: Verify schema**

In SQL Editor run:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'claims'
ORDER BY ordinal_position;
```
Expected: rows for `claimer_id` (nullable uuid), `cca_id` (uuid), `one_off_name`, `one_off_matric_no`, `one_off_phone`, `one_off_email`.

Also run:
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'claimers';
```
Expected: 0 rows (table gone).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/019_claimer_unification.sql
git commit -m "feat: db migration — unify claimers into finance_team"
```

---

### Task 2: Backend Models

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: Remove Claimer models and update Claim models**

In `backend/app/models.py`, make these changes:

**Remove** the three models (lines 121–143):
```python
class Claimer(BaseModel):
    ...

class ClaimerCreate(BaseModel):
    ...

class ClaimerUpdate(BaseModel):
    ...
```

**Replace** the `Claim` model's `claimer_id: UUID` with optional:
```python
class Claim(BaseModel):
    id: UUID
    reference_code: Optional[str] = None
    claim_number: Optional[int] = None
    claimer_id: Optional[UUID] = None          # finance_team member (treasurer)
    cca_id: Optional[UUID] = None              # CCA this claim belongs to
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    processed_by: Optional[UUID] = None
    claim_description: str
    total_amount: Decimal
    date: _date
    wbs_account: WBSAccount
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    other_emails: List[str] = []
    status: ClaimStatus
    error_message: Optional[str] = None
    transport_form_needed: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
```

**Replace** `ClaimCreate`:
```python
class ClaimCreate(BaseModel):
    cca_id: UUID                               # required: CCA this claim is for
    claimer_id: Optional[UUID] = None          # finance_team treasurer; auto-set for treasurer role
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    claim_description: str
    total_amount: Decimal
    date: _date
    wbs_account: WBSAccount
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    other_emails: List[str] = []
    transport_form_needed: bool = False
    is_partial: bool = False
    partial_amount: Optional[Decimal] = None
```

**Replace** `ClaimUpdate` — add optional new fields after `claimer_id`:
```python
class ClaimUpdate(BaseModel):
    claimer_id: Optional[UUID] = None
    cca_id: Optional[UUID] = None
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    processed_by: Optional[UUID] = None
    claim_description: Optional[str] = None
    total_amount: Optional[Decimal] = None
    date: Optional[_date] = None
    wbs_account: Optional[WBSAccount] = None
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    other_emails: Optional[List[str]] = None
    status: Optional[ClaimStatus] = None
    error_message: Optional[str] = None
    transport_form_needed: Optional[bool] = None
    is_partial: Optional[bool] = None
    partial_amount: Optional[Decimal] = None
    mf_approval_drive_id: Optional[str] = None
    client_updated_at: Optional[str] = None
```

- [ ] **Step 2: Verify Python syntax**

```bash
cd backend && python -c "from app.models import ClaimCreate, Claim, ClaimUpdate; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: update Claim models for claimer unification"
```

---

### Task 3: Backend Claims Router

**Files:**
- Modify: `backend/app/routers/claims.py`

Three sections to update: `create_claim`, `list_claims` (the GET / endpoint), and `get_claim`.

- [ ] **Step 1: Update `list_claims` select and search**

Find the `list_claims` function. Change line:
```python
.select("*, claimer:claimers(id, name)", count="exact")
```
to:
```python
.select("*, claimer:finance_team(id, name)", count="exact")
```

Find the `if search and search.strip():` block (lines 117–134). Replace the entire block with:
```python
    if search and search.strip():
        s = search.strip()
        or_parts = [
            f"reference_code.ilike.%{s}%",
            f"one_off_name.ilike.%{s}%",
        ]
        ft_resp = (
            db.table("finance_team")
            .select("id")
            .ilike("name", f"%{s}%")
            .eq("role", "treasurer")
            .execute()
        )
        ft_ids = [r["id"] for r in (ft_resp.data or [])]
        if ft_ids:
            or_parts.append(f"claimer_id.in.({','.join(ft_ids)})")
        query = query.or_(",".join(or_parts))
```

- [ ] **Step 2: Update `get_claim` select**

Find the `get_claim` function. Change the select line:
```python
.select("*, claimer:claimers(*, cca:ccas(*, portfolio:portfolios(*)))")
```
to:
```python
.select("*, claimer:finance_team(id, name, email, matric_number, phone_number), cca:ccas(name, portfolio:portfolios(name))")
```

- [ ] **Step 3: Update `create_claim`**

Find the `create_claim` function. Remove the entire `# --- Fetch claimer → CCA → portfolio ---` block (lines 372–397 approximately — it does `db.table("claimers").select(...)` and builds `cca_name`, `portfolio_name`).

Replace it with:

```python
    # Validate claimer: treasurer always claims for themselves; finance/director provide claimer_id or one-off
    if _member.get("role") == "treasurer":
        cca_links = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", _member["id"])
            .execute()
        )
        allowed_cca_ids = {row["cca_id"] for row in (cca_links.data or [])}
        if str(payload.cca_id) not in allowed_cca_ids:
            raise HTTPException(403, "You can only create claims for your own CCAs")
        # Treasurer is always the claimer
        payload.claimer_id = UUID(_member["id"])
    else:
        # Finance team / director: must supply claimer_id (treasurer) or one_off_name
        if payload.claimer_id is None and not payload.one_off_name:
            raise HTTPException(422, "Provide either claimer_id or one_off_name")
        if payload.claimer_id is not None:
            ft_check = (
                db.table("finance_team")
                .select("id, role")
                .eq("id", str(payload.claimer_id))
                .single()
                .execute()
            )
            if not ft_check.data:
                raise HTTPException(404, "Claimer not found in finance team")

    # --- Fetch CCA → portfolio for reference code ---
    cca_resp = (
        db.table("ccas")
        .select("name, portfolio:portfolios(name)")
        .eq("id", str(payload.cca_id))
        .single()
        .execute()
    )
    if not cca_resp.data:
        raise HTTPException(404, "CCA not found")
    cca_name = cca_resp.data["name"]
    portfolio_name = (cca_resp.data.get("portfolio") or {}).get("name", "UNKNOWN")
```

Also update the `claim_data` dict insertion block — replace the old `"claimer_id": str(payload.claimer_id)` line and add the new fields:
```python
    claim_data = {
        "reference_code": reference_code,
        "claim_number": counter,
        "cca_id": str(payload.cca_id),
        "claim_description": payload.claim_description,
        "total_amount": str(payload.total_amount),
        "date": payload.date.isoformat(),
        "wbs_account": payload.wbs_account.value,
        "transport_form_needed": payload.transport_form_needed,
        "is_partial": payload.is_partial,
        "status": ClaimStatus.DRAFT.value,
        "other_emails": payload.other_emails,
    }
    if payload.claimer_id is not None:
        claim_data["claimer_id"] = str(payload.claimer_id)
    if payload.one_off_name:
        claim_data["one_off_name"] = payload.one_off_name
    if payload.one_off_matric_no:
        claim_data["one_off_matric_no"] = payload.one_off_matric_no
    if payload.one_off_phone:
        claim_data["one_off_phone"] = payload.one_off_phone
    if payload.one_off_email:
        claim_data["one_off_email"] = payload.one_off_email
    if _member.get("role") == "treasurer":
        claim_data["filled_by"] = str(_member["id"])
    elif payload.filled_by is not None:
        claim_data["filled_by"] = str(payload.filled_by)
    if payload.wbs_no is not None:
        claim_data["wbs_no"] = payload.wbs_no
    if payload.remarks is not None:
        claim_data["remarks"] = payload.remarks
    if payload.is_partial and payload.partial_amount is not None:
        claim_data["partial_amount"] = str(payload.partial_amount)
```

Also add `UUID` to the imports at the top of the file if not already there (check line 1–10):
```python
from uuid import UUID
```

- [ ] **Step 4: Verify Python syntax**

```bash
cd backend && python -c "from app.routers.claims import router; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/claims.py
git commit -m "feat: update claims router for claimer unification"
```

---

### Task 4: Backend Admin Router

**Files:**
- Modify: `backend/app/routers/admin.py`

Two changes: (1) remove auto-claimer creation on approval, (2) add treasurer-options endpoint, (3) support matric/phone in UpdateMemberRequest.

- [ ] **Step 1: Remove claimer creation from `approve_registration`**

Find `approve_registration` (around line 55). The block that creates `claimers` records on approval looks like:
```python
    if member.get("role") == "treasurer":
        cca_resp = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", member_id)
            .execute()
        )
        try:
            for row in (cca_resp.data or []):
                db.table("claimers").insert({...}).execute()
        except Exception:
            db.table("finance_team").update({"status": "pending"}).eq("id", member_id).execute()
            raise HTTPException(500, "Failed to create claimer records; ...")
```

Delete that entire `if member.get("role") == "treasurer":` block. The function should end with just:
```python
    db.table("finance_team").update({"status": "active"}).eq("id", member_id).execute()
    return {"success": True}
```

- [ ] **Step 2: Update `UpdateMemberRequest` to support matric/phone**

Find the `UpdateMemberRequest` class (around line 150):
```python
class UpdateMemberRequest(BaseModel):
    role: str
    cca_ids: list[str] = []
    name: Optional[str] = None
    email: Optional[str] = None
```

Replace with:
```python
class UpdateMemberRequest(BaseModel):
    role: Optional[str] = None
    cca_ids: list[str] = []
    name: Optional[str] = None
    email: Optional[str] = None
    matric_number: Optional[str] = None
    phone_number: Optional[str] = None
```

- [ ] **Step 3: Update `update_team_member` to persist matric/phone**

Find the `update_team_member` function. Read the full function and add handling for the new fields. It currently builds an `update_data` dict and applies CCA changes. Add after the existing update logic:

```python
    update_data = {}
    if body.name is not None:
        update_data["name"] = body.name
    if body.email is not None:
        update_data["email"] = body.email
    if body.role is not None:
        update_data["role"] = body.role
    if body.matric_number is not None:
        update_data["matric_number"] = body.matric_number
    if body.phone_number is not None:
        update_data["phone_number"] = body.phone_number
```

Make sure `matric_number` and `phone_number` are included in whatever dict gets written to Supabase. Read the full `update_team_member` function body and ensure those fields flow through.

- [ ] **Step 4: Add `GET /admin/treasurer-options` endpoint**

After the `list_team_members` function, add:

```python
@router.get("/treasurer-options")
async def list_treasurer_options(
    cca_id: str = Query(...),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return finance_team treasurers linked to a given CCA, for the new claim form."""
    links_resp = (
        db.table("treasurer_ccas")
        .select("finance_team_id")
        .eq("cca_id", cca_id)
        .execute()
    )
    ft_ids = [row["finance_team_id"] for row in (links_resp.data or [])]
    if not ft_ids:
        return []
    members_resp = (
        db.table("finance_team")
        .select("id, name, email")
        .in_("id", ft_ids)
        .eq("status", "active")
        .order("name")
        .execute()
    )
    return members_resp.data or []
```

Also add `Query` to the import if not already there:
```python
from fastapi import APIRouter, Depends, HTTPException, Query
```

- [ ] **Step 5: Verify**

```bash
cd backend && python -c "from app.routers.admin import router; print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin.py
git commit -m "feat: update admin router — remove claimer auto-creation, add treasurer-options"
```

---

### Task 5: Backend Documents, Email, and Gmail

**Files:**
- Modify: `backend/app/routers/documents.py`
- Modify: `backend/app/routers/email.py`
- Modify: `backend/app/services/gmail.py`

- [ ] **Step 1: Update `_get_full_claim` in documents.py**

Find the `_get_full_claim` function. Replace the select string and add normalization:

```python
def _get_full_claim(claim_id: str, db) -> dict:
    result = db.table("claims").select(
        "*, claimer:finance_team(id, name, email, matric_number, phone_number), "
        "cca:ccas(name, portfolio:portfolios(name)), "
        "line_items:claim_line_items(*, receipts(*))"
    ).eq("id", claim_id).is_("deleted_at", "null").single().execute()
    if not result.data:
        raise HTTPException(404, "Claim not found")
    claim = result.data
    # Normalize claimer to the shape expected by pdf/gmail services:
    # {name, matric_no, phone, email, cca: {name, portfolio: {name}}}
    raw_claimer = claim.get("claimer") or {}
    claim["claimer"] = {
        "name": claim.get("one_off_name") or raw_claimer.get("name") or "",
        "matric_no": claim.get("one_off_matric_no") or raw_claimer.get("matric_number") or "",
        "phone": claim.get("one_off_phone") or raw_claimer.get("phone_number") or "",
        "email": claim.get("one_off_email") or raw_claimer.get("email") or "",
        "cca": claim.get("cca") or {},
    }
    return claim
```

- [ ] **Step 2: Update `email.py` — both `send_email` and `resend_email` functions**

Find both occurrences of:
```python
.select("*, claimer:claimers(*, cca:ccas(*))")
```
Replace both with:
```python
.select("*, claimer:finance_team(id, name, email, matric_number, phone_number), cca:ccas(name, portfolio:portfolios(name))")
```

In the same functions, find the email validation block (around `claimer = claim.get("claimer") or {}`). After fetching the claim dict, add normalization before the claimer email check:

```python
    raw_claimer = claim.get("claimer") or {}
    claimer_email = (
        claim.get("one_off_email")
        or raw_claimer.get("email")
        or ""
    )
    if not claimer_email:
        raise HTTPException(status_code=400, detail="Claimer has no email address")
    # Normalize for gmail service
    claim["claimer"] = {
        "name": claim.get("one_off_name") or raw_claimer.get("name") or "",
        "matric_no": claim.get("one_off_matric_no") or raw_claimer.get("matric_number") or "",
        "phone": claim.get("one_off_phone") or raw_claimer.get("phone_number") or "",
        "email": claimer_email,
        "cca": claim.get("cca") or {},
    }
```

Remove the old `claimer = claim.get("claimer") or {}` + `claimer_email = claimer.get("email") or ""` lines that are now replaced. Do this for both `send_email` and `resend_email`.

- [ ] **Step 3: Verify**

```bash
cd backend && python -c "from app.routers.documents import router; from app.routers.email import router as er; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/documents.py backend/app/routers/email.py
git commit -m "feat: update documents and email routers for claimer unification"
```

---

### Task 6: Backend Cleanup

**Files:**
- Delete: `backend/app/routers/claimers.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Delete claimers router**

```bash
rm backend/app/routers/claimers.py
```

- [ ] **Step 2: Update main.py**

In `backend/app/main.py`, remove the `claimers` import and include:

Line 10 — change:
```python
from app.routers import bot, claimers, claims, documents, email as email_router, images as images_router, portfolios, receipts
```
to:
```python
from app.routers import bot, claims, documents, email as email_router, images as images_router, portfolios, receipts
```

Line 98 — remove:
```python
app.include_router(claimers.router)
```

- [ ] **Step 3: Verify startup**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git rm backend/app/routers/claimers.py
git commit -m "feat: remove claimers router"
```

---

### Task 7: Frontend — Admin API Hook

**Files:**
- Modify: `frontend/src/api/admin.js`

- [ ] **Step 1: Read the existing admin.js file**

Read `frontend/src/api/admin.js` to understand existing exports (useTeamMembers, useUpdateTeamMember, useRemoveTeamMember, etc.).

- [ ] **Step 2: Add `useTreasurerOptions` hook**

At the end of `frontend/src/api/admin.js`, add:

```javascript
export function useTreasurerOptions(ccaId) {
  return useQuery({
    queryKey: ['admin', 'treasurer-options', ccaId],
    queryFn: () => api.get('/admin/treasurer-options', { params: { cca_id: ccaId } }).then((r) => r.data),
    enabled: !!ccaId,
  })
}
```

Make sure `useQuery` is already imported from `@tanstack/react-query` at the top of the file. If not, add it to the import.

- [ ] **Step 3: Verify**

```bash
cd frontend && node -e "require('./src/api/admin.js')" 2>&1 | head -5
```
If the output is blank or shows a module-type error (not a syntax error), it's fine — the file is an ES module.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/admin.js
git commit -m "feat: add useTreasurerOptions hook to admin API"
```

---

### Task 8: Frontend — NewClaimPage Step 1 Overhaul

**Files:**
- Modify: `frontend/src/pages/NewClaimPage.jsx`

This is the biggest frontend change. Step 1 for finance team / director shows a treasurer picker (portfolio → CCA → treasurer dropdown) with an optional one-off form. For treasurers, it shows their own CCAs.

- [ ] **Step 1: Update imports at the top of NewClaimPage.jsx**

Remove the `claimers` import line:
```javascript
import { useClaimers, useCreateClaimer, fetchClaimers } from '../api/claimers'
```

Add:
```javascript
import { useTreasurerOptions } from '../api/admin'
```

- [ ] **Step 2: Replace `Step1` component (lines 138–303)**

Replace the entire `Step1` function with:

```javascript
function Step1({ data, onChange }) {
  const { data: portfolios = [], isLoading: portfoliosLoading } = usePortfolios()
  const { data: ccas = [], isLoading: ccasLoading } = useCcasByPortfolio(data.portfolioId)
  const { data: treasurers = [], isLoading: treasurersLoading } = useTreasurerOptions(data.ccaId)

  const portfolioOptions = portfolios.map((p) => ({ value: p.id, label: p.name }))
  const ccaOptions = ccas.map((c) => ({ value: c.id, label: c.name }))
  const treasurerOptions = treasurers.map((t) => ({ value: t.id, label: t.name }))

  function handlePortfolioChange(val) {
    onChange({ portfolioId: val, ccaId: '', claimerId: '', isOneOff: false })
  }

  function handleCcaChange(val) {
    onChange({ ccaId: val, claimerId: '', isOneOff: false })
  }

  return (
    <div className="space-y-4">
      {/* Portfolio */}
      <div>
        <Label required>Portfolio</Label>
        {portfoliosLoading ? (
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <Select
            value={data.portfolioId}
            onChange={handlePortfolioChange}
            placeholder="Select portfolio…"
            options={portfolioOptions}
          />
        )}
      </div>

      {/* CCA */}
      <div>
        <Label required>CCA</Label>
        <Select
          value={data.ccaId}
          onChange={handleCcaChange}
          placeholder={data.portfolioId ? (ccasLoading ? 'Loading…' : 'Select CCA…') : 'Select portfolio first'}
          options={ccaOptions}
          disabled={!data.portfolioId || ccasLoading}
        />
      </div>

      {/* Treasurer or One-Off Toggle */}
      {data.ccaId && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label required>Claimer</Label>
            <button
              type="button"
              onClick={() => onChange({ isOneOff: !data.isOneOff, claimerId: '' })}
              className="text-xs text-blue-600 font-medium"
            >
              {data.isOneOff ? 'Select treasurer instead' : 'One-off claimer'}
            </button>
          </div>

          {!data.isOneOff && (
            <Select
              value={data.claimerId}
              onChange={(val) => onChange({ claimerId: val })}
              placeholder={treasurersLoading ? 'Loading…' : treasurers.length === 0 ? 'No treasurers for this CCA' : 'Select treasurer…'}
              options={treasurerOptions}
              disabled={treasurersLoading || treasurers.length === 0}
            />
          )}

          {data.isOneOff && (
            <div className="border border-blue-200 rounded-xl bg-blue-50 p-3 mt-1 space-y-2">
              <p className="text-xs font-semibold text-blue-700 mb-2">One-off Claimer</p>
              <div>
                <Label required>Name</Label>
                <Input
                  value={data.oneOffName}
                  onChange={(v) => onChange({ oneOffName: v })}
                  placeholder="Full name"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Matric No.</Label>
                  <Input
                    value={data.oneOffMatricNo}
                    onChange={(v) => onChange({ oneOffMatricNo: v })}
                    placeholder="A0XXXXXXX"
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={data.oneOffPhone}
                    onChange={(v) => onChange({ oneOffPhone: v })}
                    placeholder="XXXXXXXX"
                  />
                </div>
              </div>
              <div>
                <Label>School Email</Label>
                <Input
                  type="email"
                  value={data.oneOffEmail}
                  onChange={(v) => onChange({ oneOffEmail: v })}
                  placeholder="XXX@u.nus.edu"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace `TreasurerClaimerPicker` component (lines 1276–1323)**

The treasurer flow now just picks their CCA (they are always the claimer). Replace:

```javascript
function TreasurerClaimerPicker({ user, value, onChange }) {
  const ccas = user?.ccas || []

  useEffect(() => {
    if (ccas.length === 1 && !value) {
      onChange(ccas[0].id)
    }
  }, [ccas, value, onChange])

  if (ccas.length === 0) return <p className="text-sm text-gray-400">No CCAs assigned to your account.</p>

  if (ccas.length === 1) {
    return (
      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
        Claiming for: <strong>{ccas[0].name}</strong>
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
        {ccas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
```

Note: `onChange` is now called with `ccaId` (not `claimerId`). Update the render section too (Step 5).

- [ ] **Step 4: Update `DEFAULT_STEP1` and `step1Valid`**

Find `DEFAULT_STEP1` (line 1329):
```javascript
const DEFAULT_STEP1 = { portfolioId: '', ccaId: '', claimerId: '' }
```
Replace with:
```javascript
const DEFAULT_STEP1 = {
  portfolioId: '',
  ccaId: '',
  claimerId: '',
  isOneOff: false,
  oneOffName: '',
  oneOffMatricNo: '',
  oneOffPhone: '',
  oneOffEmail: '',
}
```

Find `step1Valid` (line 1405):
```javascript
const step1Valid = isTreasurer ? !!step1.claimerId : step1.portfolioId && step1.ccaId && step1.claimerId
```
Replace with:
```javascript
const step1Valid = isTreasurer
  ? !!step1.ccaId
  : step1.portfolioId && step1.ccaId && (step1.claimerId || (step1.isOneOff && step1.oneOffName.trim()))
```

- [ ] **Step 5: Update the render section for Step 1 treasurer path**

Find (around line 1611–1616):
```javascript
{step === 1 && isTreasurer && (
  <TreasurerClaimerPicker
    user={user}
    value={step1.claimerId}
    onChange={(claimerId) => updateStep1({ claimerId })}
  />
)}
```
Replace with:
```javascript
{step === 1 && isTreasurer && (
  <TreasurerClaimerPicker
    user={user}
    value={step1.ccaId}
    onChange={(ccaId) => updateStep1({ ccaId })}
  />
)}
```

- [ ] **Step 6: Update `handleSave` to send new payload shape**

Find the claim creation call in `handleSave` (around line 1468):
```javascript
const claim = await createClaim.mutateAsync({
  claimer_id: step1.claimerId,
  ...
})
```

Replace with:
```javascript
      const claimPayload = {
        cca_id: step1.ccaId,
        claim_description: step2.claimDescription.trim(),
        total_amount: totalAmount,
        date: step2.date,
        wbs_account: step2.wbsAccount,
        remarks: autoRemarks || undefined,
        other_emails: step2.otherEmails,
        transport_form_needed: step2.transportFormNeeded,
        is_partial: step2.isPartial,
        partial_amount: step2.isPartial && step2.partialAmount ? Number(step2.partialAmount) : undefined,
      }
      if (!isTreasurer) {
        if (step1.isOneOff) {
          claimPayload.one_off_name = step1.oneOffName.trim()
          if (step1.oneOffMatricNo.trim()) claimPayload.one_off_matric_no = step1.oneOffMatricNo.trim()
          if (step1.oneOffPhone.trim()) claimPayload.one_off_phone = step1.oneOffPhone.trim()
          if (step1.oneOffEmail.trim()) claimPayload.one_off_email = step1.oneOffEmail.trim()
        } else {
          claimPayload.claimer_id = step1.claimerId
        }
      }
      // For treasurer: server auto-sets claimer_id = current user
      const claim = await createClaim.mutateAsync(claimPayload)
```

Remove the old `claim_description`, `total_amount`, `date`, `wbs_account`, `remarks`, `other_emails`, `transport_form_needed`, `is_partial`, `partial_amount` lines from within `createClaim.mutateAsync({...})` since they're now in `claimPayload`.

- [ ] **Step 7: Verify the page compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: build completes with 0 errors (warnings are OK).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/NewClaimPage.jsx
git commit -m "feat: update NewClaimPage for claimer unification"
```

---

### Task 9: Frontend — ClaimDetailPage and IdentifierDataPage

**Files:**
- Modify: `frontend/src/pages/ClaimDetailPage.jsx`
- Modify: `frontend/src/pages/IdentifierDataPage.jsx`

- [ ] **Step 1: Fix claimer display in ClaimDetailPage**

In `ClaimDetailPage.jsx`, find (around line 1612–1613):
```javascript
  const claimer = claim.claimer ?? {}
  const cca = claimer.cca ?? {}
```
Replace with:
```javascript
  const claimer = claim.claimer ?? {}
  const cca = claim.cca ?? {}
  const claimerName = claim.one_off_name || claimer.name || '—'
```

Find (around line 1891):
```javascript
              <InfoRow label="Claimer" value={claimer.name ?? '—'} />
```
Replace with:
```javascript
              <InfoRow label="Claimer" value={claimerName} />
```

Also find any references to `cca.name` in ClaimDetailPage that currently go through `claimer.cca.name`. After reading those usages, replace `claimer.cca` with `claim.cca` or the `cca` variable already updated above.

- [ ] **Step 2: Overhaul IdentifierDataPage**

`IdentifierDataPage.jsx` currently shows claimers grouped by portfolio → CCA with matric/phone editing. It needs to instead show finance_team treasurers with editable matric_number and phone_number.

Replace the entire file content with the following:

```javascript
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'

function fetchTreasurers() {
  return api.get('/admin/team', {}).then((r) =>
    r.data.filter((m) => m.role === 'treasurer')
  )
}

function updateTreasurer({ id, matric_number, phone_number }) {
  return api.patch(`/admin/team/${id}`, { matric_number, phone_number }).then((r) => r.data)
}

function TreasurerRow({ member, updateMutation }) {
  const [editing, setEditing] = useState(false)
  const [matric, setMatric] = useState(member.matric_number || '')
  const [phone, setPhone] = useState(member.phone_number || '')
  const [rowError, setRowError] = useState(null)

  function handleSave() {
    setRowError(null)
    updateMutation.mutate(
      { id: member.id, matric_number: matric.trim() || null, phone_number: phone.trim() || null },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setRowError(err?.response?.data?.detail || 'Update failed.'),
      }
    )
  }

  const ccaNames = (member.ccas || []).map((c) => c.name).join(', ')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
          {ccaNames && <p className="text-xs text-gray-500">{ccaNames}</p>}
        </div>
        {!editing && (
          <button
            onClick={() => { setMatric(member.matric_number || ''); setPhone(member.phone_number || ''); setEditing(true) }}
            className="text-xs text-blue-600 font-medium shrink-0"
          >
            Edit
          </button>
        )}
      </div>

      {!editing && (
        <div className="flex gap-3 flex-wrap mt-1">
          {member.matric_number ? (
            <span className="text-xs text-gray-600">{member.matric_number}</span>
          ) : (
            <span className="text-xs text-gray-400 italic">No matric no.</span>
          )}
          {member.phone_number ? (
            <span className="text-xs text-gray-600">{member.phone_number}</span>
          ) : (
            <span className="text-xs text-gray-400 italic">No phone</span>
          )}
          {member.email && <span className="text-xs text-gray-500 truncate">{member.email}</span>}
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Matric No.</label>
              <input
                value={matric}
                onChange={(e) => setMatric(e.target.value)}
                placeholder="A0XXXXXXX"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="XXXXXXXX"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          {rowError && <p className="text-xs text-red-600">{rowError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded-lg disabled:opacity-60"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-1 bg-gray-100 text-gray-700 text-xs font-medium py-1.5 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function IdentifierDataPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: treasurers, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'treasurers'],
    queryFn: fetchTreasurers,
  })

  const updateMutation = useMutation({
    mutationFn: updateTreasurer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'treasurers'] }),
  })

  // Group by portfolio → CCA
  const grouped = useMemo(() => {
    if (!treasurers?.length) return {}
    const q = search.toLowerCase()
    const filtered = search
      ? treasurers.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.matric_number || '').toLowerCase().includes(q) ||
            (t.ccas || []).some((c) => c.name.toLowerCase().includes(q))
        )
      : treasurers
    const result = {}
    filtered.forEach((t) => {
      const ccas = t.ccas || []
      if (ccas.length === 0) {
        const key = 'Unassigned'
        result[key] = result[key] || []
        result[key].push(t)
      } else {
        ccas.forEach((cca) => {
          const key = cca.name
          result[key] = result[key] || []
          result[key].push(t)
        })
      }
    })
    return result
  }, [treasurers, search])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white px-4 py-3 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">CCA Treasurer Profiles</h1>
        <p className="text-xs text-gray-400 mt-0.5">Matric numbers and phone numbers used in claim documents</p>
      </div>

      <div className="px-4 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, matric, or CCA…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {isLoading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
        {isError && <p className="text-sm text-red-600 text-center py-8">Failed to load: {error?.message}</p>}
        {!isLoading && !isError && Object.keys(grouped).length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            {search ? 'No treasurers match your search.' : 'No treasurers found.'}
          </p>
        )}
        {Object.entries(grouped).map(([ccaName, members]) => (
          <div key={ccaName}>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{ccaName}</p>
            <div className="space-y-2">
              {members.map((m) => (
                <TreasurerRow key={m.id} member={m} updateMutation={updateMutation} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ClaimDetailPage.jsx frontend/src/pages/IdentifierDataPage.jsx
git commit -m "feat: update ClaimDetailPage and IdentifierDataPage for claimer unification"
```

---

### Task 10: Frontend Cleanup

**Files:**
- Delete: `frontend/src/api/claimers.js`

- [ ] **Step 1: Verify no remaining imports of claimers.js**

```bash
grep -r "from '../api/claimers'" frontend/src/
grep -r "from './claimers'" frontend/src/
```
Expected: 0 matches (all usages should already be removed by Tasks 8 and 9).

- [ ] **Step 2: Delete the file**

```bash
git rm frontend/src/api/claimers.js
```

- [ ] **Step 3: Final build check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: remove claimers API (replaced by finance_team/admin API)"
```

---

## Self-Review

**Spec coverage check:**
- ✅ DB: `claimers` dropped, `claimer_id` → `finance_team`, `cca_id` added, `one_off_*` fields added
- ✅ Backend create: treasurer auto-set as claimer, finance team picks from treasurer dropdown or one-off
- ✅ Backend list/get: joins updated to `finance_team`
- ✅ Admin: claimer auto-creation removed from approval; treasurer-options endpoint added; matric/phone editable
- ✅ Documents/email/gmail: normalized claimer dict for backward-compat with pdf service
- ✅ Frontend: Step1 uses treasurer dropdown; one-off toggle; TreasurerClaimerPicker sets ccaId
- ✅ IdentifierDataPage: shows treasurer profiles with matric/phone editing
- ✅ ClaimDetailPage: handles `one_off_name` fallback
- ✅ Cleanup: `claimers.js` and `claimers.py` removed

**Placeholder scan:** None.

**Type consistency:**
- `cca_id` is a `UUID` in Python models; `cca_id` string in DB and JS
- `claimer_id` optional UUID in models; optional in DB
- `one_off_*` fields consistently `Optional[str]` in Python, `string` in JS
- `useTreasurerOptions` added in admin.js; imported and used in NewClaimPage
- `matric_number` / `phone_number` are the finance_team column names (migration 014); `matric_no` / `phone` are the normalized names fed to pdf/gmail services — normalization happens in `documents.py` and `email.py`
