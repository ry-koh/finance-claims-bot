# Attachment Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-submission workflow where the Finance Director flags submitted claims to request additional attachments from CCA treasurers, with per-file upload/download and Telegram notifications.

**Architecture:** Two new DB tables (`claim_attachment_requests`, `claim_attachment_files`) track request cycles and individual files. Two new claim statuses drive state. Seven new endpoints extend the existing `/claims` router. A new `attachmentRequests.js` API file keeps frontend concerns separated. UI changes are confined to `ClaimDetailPage`, `HomePage`, and `TreasurerHomePage`.

**Tech Stack:** FastAPI, Supabase (Postgres), Cloudflare R2, Telegram Bot API, React 18, TanStack Query v5, Tailwind CSS

---

## File Map

### New files
- `supabase/migrations/018_attachment_requests.sql`
- `frontend/src/api/attachmentRequests.js`

### Modified files
- `backend/app/models.py` — add two new `ClaimStatus` enum values
- `backend/app/routers/claims.py` — add 7 endpoints + 2 Pydantic models + 1 helper
- `frontend/src/pages/ClaimDetailPage.jsx` — add `AttachmentRequestPanel` component and render it
- `frontend/src/pages/HomePage.jsx` — add two new statuses to `STATUSES` array
- `frontend/src/pages/TreasurerHomePage.jsx` — add status labels/badges and action banner

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/018_attachment_requests.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Extend claims status CHECK to include attachment statuses
ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_status_check
    CHECK (status IN (
      'draft', 'pending_review', 'email_sent', 'screenshot_pending',
      'screenshot_uploaded', 'docs_generated', 'compiled',
      'submitted', 'attachment_requested', 'attachment_uploaded',
      'reimbursed', 'error'
    ));

-- Request cycles: one row per round of director flagging
CREATE TABLE claim_attachment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  director_id uuid NOT NULL REFERENCES finance_team(id),
  request_message text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Individual files uploaded per request cycle
CREATE TABLE claim_attachment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES claim_attachment_requests(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  original_filename text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_attachment_requests_claim ON claim_attachment_requests(claim_id);
CREATE INDEX idx_claim_attachment_files_request ON claim_attachment_files(request_id);
```

- [ ] **Step 2: Run the migration**

Run the SQL above in your Supabase project's SQL Editor.
Verify by running:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('claim_attachment_requests', 'claim_attachment_files')
ORDER BY table_name, ordinal_position;
```
Expected: columns for both tables appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/018_attachment_requests.sql
git commit -m "feat: add attachment requests migration"
```

---

## Task 2: Update ClaimStatus Enum

**Files:**
- Modify: `backend/app/models.py`

The `ClaimStatus` enum in `models.py` currently ends at `ERROR = "error"`. Add two new values after `SUBMITTED`.

- [ ] **Step 1: Add the two new enum values**

In `backend/app/models.py`, find the `ClaimStatus` class (around line 20) and add after `SUBMITTED = "submitted"`:

```python
class ClaimStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    EMAIL_SENT = "email_sent"
    SCREENSHOT_PENDING = "screenshot_pending"
    SCREENSHOT_UPLOADED = "screenshot_uploaded"
    DOCS_GENERATED = "docs_generated"
    COMPILED = "compiled"
    SUBMITTED = "submitted"
    ATTACHMENT_REQUESTED = "attachment_requested"
    ATTACHMENT_UPLOADED = "attachment_uploaded"
    REIMBURSED = "reimbursed"
    ERROR = "error"
```

- [ ] **Step 2: Verify the backend starts**

```bash
cd backend
uvicorn app.main:app --reload
```
Expected: starts without import errors. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add attachment_requested and attachment_uploaded claim statuses"
```

---

## Task 3: Backend — POST Endpoints

**Files:**
- Modify: `backend/app/routers/claims.py`

Add two local Pydantic models, one helper function, and five POST endpoints. Append all of this after the existing `mark_reimbursed` endpoint at the bottom of `claims.py`.

- [ ] **Step 1: Add imports for UploadFile**

Find the existing fastapi import line at the top of `claims.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Query
```
Replace it with:
```python
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
```

- [ ] **Step 2: Add Pydantic models and helper**

Add immediately after the existing `RejectReviewRequest` model (around line 23):

```python
class AttachmentRequestBody(PydanticBaseModel):
    message: str
```

Add after the `_get_claim_or_404` helper (around line 57):

```python
def _get_current_attachment_request(db: Client, claim_id: str) -> dict | None:
    """Return the latest pending or submitted attachment request for a claim."""
    resp = (
        db.table("claim_attachment_requests")
        .select("*")
        .eq("claim_id", claim_id)
        .in_("status", ["pending", "submitted"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None
```

- [ ] **Step 3: Add the five POST endpoints**

Append after `mark_reimbursed` at the bottom of `claims.py`:

```python
# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/request-attachment  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/request-attachment")
async def request_attachment(
    claim_id: str,
    payload: AttachmentRequestBody,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Finance team flags a submitted claim to request additional attachments."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "submitted":
        raise HTTPException(409, "Claim must be in submitted status to request attachments")

    req_resp = db.table("claim_attachment_requests").insert({
        "claim_id": claim_id,
        "director_id": member["id"],
        "request_message": payload.message,
    }).execute()
    if not req_resp.data:
        raise HTTPException(500, "Failed to create attachment request")

    db.table("claims").update({"status": "attachment_requested"}).eq("id", claim_id).execute()

    filled_by_id = claim.get("filled_by")
    if filled_by_id:
        ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
        if ft.data and ft.data[0].get("telegram_id"):
            ref = claim.get("reference_code", claim_id)
            asyncio.create_task(send_bot_notification(
                ft.data[0]["telegram_id"],
                f"📎 Additional attachment requested for claim {ref}\n\n{payload.message}\n\nPlease upload the required files in the app."
            ))

    return req_resp.data[0]


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-upload  (any authenticated user)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-upload")
async def upload_attachment_file(
    claim_id: str,
    file: UploadFile = File(...),
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer uploads a file against the current open attachment request."""
    import uuid as _uuid
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Claim is not currently awaiting attachments")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    file_bytes = await file.read()
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    object_name = f"attachments/{claim_id}/{_uuid.uuid4()}.{ext}"
    r2_service.upload_file(file_bytes, object_name, file.content_type or "application/octet-stream")

    file_resp = db.table("claim_attachment_files").insert({
        "request_id": current_req["id"],
        "file_url": object_name,
        "original_filename": filename,
    }).execute()
    if not file_resp.data:
        raise HTTPException(500, "Failed to save file record")

    return file_resp.data[0]


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-submit  (any authenticated user)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-submit")
async def submit_attachments(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer marks their uploads as complete; notifies finance director."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Claim is not currently awaiting attachments")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    files_resp = (
        db.table("claim_attachment_files")
        .select("id")
        .eq("request_id", current_req["id"])
        .execute()
    )
    if not files_resp.data:
        raise HTTPException(422, "Upload at least one file before submitting")

    db.table("claim_attachment_requests").update({"status": "submitted"}).eq("id", current_req["id"]).execute()
    db.table("claims").update({"status": "attachment_uploaded"}).eq("id", claim_id).execute()

    director_resp = db.table("finance_team").select("telegram_id").eq("role", "director").execute()
    if director_resp.data and director_resp.data[0].get("telegram_id"):
        ref = claim.get("reference_code", claim_id)
        asyncio.create_task(send_bot_notification(
            director_resp.data[0]["telegram_id"],
            f"📎 Attachments uploaded for claim {ref} — ready for your review."
        ))

    return {"success": True, "status": "attachment_uploaded"}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-accept  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-accept")
async def accept_attachments(
    claim_id: str,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Director accepts uploaded attachments; claim returns to submitted."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_uploaded":
        raise HTTPException(409, "Claim is not awaiting attachment review")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    db.table("claim_attachment_requests").update({"status": "accepted"}).eq("id", current_req["id"]).execute()
    db.table("claims").update({"status": "submitted"}).eq("id", claim_id).execute()

    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /claims/{claim_id}/attachment-reject  (finance team only)
# ---------------------------------------------------------------------------

@router.post("/{claim_id}/attachment-reject")
async def reject_attachments(
    claim_id: str,
    payload: AttachmentRequestBody,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Director rejects uploads, creates a new request cycle, notifies treasurer."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_uploaded":
        raise HTTPException(409, "Claim is not awaiting attachment review")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    db.table("claim_attachment_requests").update({"status": "rejected"}).eq("id", current_req["id"]).execute()

    new_req_resp = db.table("claim_attachment_requests").insert({
        "claim_id": claim_id,
        "director_id": member["id"],
        "request_message": payload.message,
    }).execute()
    if not new_req_resp.data:
        raise HTTPException(500, "Failed to create new attachment request")

    db.table("claims").update({"status": "attachment_requested"}).eq("id", claim_id).execute()

    filled_by_id = claim.get("filled_by")
    if filled_by_id:
        ft = db.table("finance_team").select("telegram_id").eq("id", filled_by_id).execute()
        if ft.data and ft.data[0].get("telegram_id"):
            ref = claim.get("reference_code", claim_id)
            asyncio.create_task(send_bot_notification(
                ft.data[0]["telegram_id"],
                f"📎 Attachments for claim {ref} need revision.\n\n{payload.message}\n\nPlease upload the corrected files in the app."
            ))

    return new_req_resp.data[0]
```

- [ ] **Step 4: Verify the backend starts**

```bash
cd backend
uvicorn app.main:app --reload
```
Expected: no import or syntax errors. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/claims.py
git commit -m "feat: add attachment request POST endpoints (request, upload, submit, accept, reject)"
```

---

## Task 4: Backend — GET and DELETE Endpoints

**Files:**
- Modify: `backend/app/routers/claims.py`

Append three more endpoints after the five POST endpoints from Task 3.

- [ ] **Step 1: Add GET all-requests, DELETE file, and GET download endpoints**

```python
# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/attachment-requests  (any authenticated user)
# ---------------------------------------------------------------------------

@router.get("/{claim_id}/attachment-requests")
def get_attachment_requests(
    claim_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return all attachment request cycles for a claim, newest first, with files nested."""
    _get_claim_or_404(db, claim_id)

    reqs_resp = (
        db.table("claim_attachment_requests")
        .select("*")
        .eq("claim_id", claim_id)
        .order("created_at", desc=True)
        .execute()
    )
    requests = reqs_resp.data or []

    if requests:
        req_ids = [r["id"] for r in requests]
        files_resp = (
            db.table("claim_attachment_files")
            .select("*")
            .in_("request_id", req_ids)
            .order("uploaded_at")
            .execute()
        )
        files_by_req: dict = {}
        for f in (files_resp.data or []):
            files_by_req.setdefault(f["request_id"], []).append(f)
        for r in requests:
            r["files"] = files_by_req.get(r["id"], [])

    return requests


# ---------------------------------------------------------------------------
# DELETE /claims/{claim_id}/attachment-requests/current/files/{file_id}
# ---------------------------------------------------------------------------

@router.delete("/{claim_id}/attachment-requests/current/files/{file_id}", status_code=204)
def delete_attachment_file(
    claim_id: str,
    file_id: str,
    member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Treasurer removes a file from the current open request (before submitting)."""
    claim = _get_claim_or_404(db, claim_id)
    if claim["status"] != "attachment_requested":
        raise HTTPException(409, "Cannot delete files after submitting")

    current_req = _get_current_attachment_request(db, claim_id)
    if not current_req:
        raise HTTPException(404, "No open attachment request found")

    file_resp = (
        db.table("claim_attachment_files")
        .select("id, file_url")
        .eq("id", file_id)
        .eq("request_id", current_req["id"])
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(404, "File not found on current request")

    r2_service.delete_file(file_resp.data[0]["file_url"])
    db.table("claim_attachment_files").delete().eq("id", file_id).execute()


# ---------------------------------------------------------------------------
# GET /claims/{claim_id}/attachment-requests/current/files/{file_id}/download
# ---------------------------------------------------------------------------

@router.get("/{claim_id}/attachment-requests/current/files/{file_id}/download")
def download_attachment_file(
    claim_id: str,
    file_id: str,
    member: dict = Depends(require_finance_team),
    db: Client = Depends(get_supabase),
):
    """Return a short-lived presigned R2 URL so the director can download a file."""
    _get_claim_or_404(db, claim_id)

    file_resp = (
        db.table("claim_attachment_files")
        .select("id, file_url, original_filename")
        .eq("id", file_id)
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(404, "File not found")

    url = r2_service.generate_signed_url(file_resp.data[0]["file_url"])
    return {"url": url, "filename": file_resp.data[0]["original_filename"]}
```

- [ ] **Step 2: Verify the backend starts**

```bash
cd backend
uvicorn app.main:app --reload
```
Expected: no errors. Open `http://localhost:8000/docs` and confirm the new endpoints appear under the `claims` tag. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/claims.py
git commit -m "feat: add attachment request GET and DELETE endpoints"
```

---

## Task 5: Frontend API

**Files:**
- Create: `frontend/src/api/attachmentRequests.js`

- [ ] **Step 1: Create the file**

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const ATTACHMENT_KEYS = {
  requests: (claimId) => ['claims', claimId, 'attachment-requests'],
}

export function useAttachmentRequests(claimId) {
  return useQuery({
    queryKey: ATTACHMENT_KEYS.requests(claimId),
    queryFn: () => api.get(`/claims/${claimId}/attachment-requests`).then((r) => r.data),
    enabled: !!claimId,
    staleTime: 10_000,
  })
}

export function useRequestAttachment(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => api.post(`/claims/${claimId}/request-attachment`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useUploadAttachmentFile(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/claims/${claimId}/attachment-upload`, form).then((r) => r.data)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) }),
  })
}

export function useDeleteAttachmentFile(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId) =>
      api.delete(`/claims/${claimId}/attachment-requests/current/files/${fileId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) }),
  })
}

export function useSubmitAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/claims/${claimId}/attachment-submit`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useAcceptAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/claims/${claimId}/attachment-accept`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['claims', claimId] }),
  })
}

export function useRejectAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => api.post(`/claims/${claimId}/attachment-reject`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useDownloadAttachmentFile(claimId) {
  return useMutation({
    mutationFn: (fileId) =>
      api
        .get(`/claims/${claimId}/attachment-requests/current/files/${fileId}/download`)
        .then((r) => r.data),
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/attachmentRequests.js
git commit -m "feat: add attachmentRequests API hooks"
```

---

## Task 6: Frontend — ClaimDetailPage

**Files:**
- Modify: `frontend/src/pages/ClaimDetailPage.jsx`

Add `AttachmentRequestPanel` as a sub-component (before the `export default function ClaimDetailPage` at line 1111), import the new hooks, and render the panel inside the main page.

- [ ] **Step 1: Add the import for the new hooks**

Find the existing import block at the top of `ClaimDetailPage.jsx`. Add this line after the other API imports:

```javascript
import {
  useAttachmentRequests,
  useRequestAttachment,
  useUploadAttachmentFile,
  useDeleteAttachmentFile,
  useSubmitAttachments,
  useAcceptAttachments,
  useRejectAttachments,
  useDownloadAttachmentFile,
} from '../api/attachmentRequests'
```

- [ ] **Step 2: Add the AttachmentRequestPanel sub-component**

Insert the following function immediately before `export default function ClaimDetailPage()` (line 1111). It uses `ActionButton`, `useIsFinanceTeam`, and `useIsTreasurer` which are already available in the file:

```javascript
function AttachmentRequestPanel({ claim }) {
  const isFinanceTeam = useIsFinanceTeam()
  const isTreasurer = useIsTreasurer()
  const status = claim.status

  const { data: requests = [] } = useAttachmentRequests(claim.id)
  const currentRequest = requests.find(
    (r) => r.status === 'pending' || r.status === 'submitted'
  )

  const [requestMsg, setRequestMsg] = useState('')
  const [rejectMsg, setRejectMsg] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  const requestAttachment = useRequestAttachment(claim.id)
  const uploadFile = useUploadAttachmentFile(claim.id)
  const deleteFile = useDeleteAttachmentFile(claim.id)
  const submitAttachments = useSubmitAttachments(claim.id)
  const acceptAttachments = useAcceptAttachments(claim.id)
  const rejectAttachments = useRejectAttachments(claim.id)
  const downloadFile = useDownloadAttachmentFile(claim.id)

  // Finance team: "Request Attachment" form shown on submitted claims
  if (status === 'submitted' && isFinanceTeam) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-amber-800 mb-2">
          Request Additional Attachment
        </h2>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 mb-3"
          rows={3}
          placeholder="Describe what NUS office needs..."
          value={requestMsg}
          onChange={(e) => setRequestMsg(e.target.value)}
        />
        <ActionButton
          variant="warning"
          disabled={!requestMsg.trim()}
          loading={requestAttachment.isPending}
          onClick={() =>
            requestAttachment.mutate(
              { message: requestMsg },
              { onSuccess: () => setRequestMsg('') }
            )
          }
        >
          Send Request
        </ActionButton>
      </div>
    )
  }

  // Treasurer: upload files
  if (status === 'attachment_requested' && isTreasurer) {
    const uploadedFiles = currentRequest?.files ?? []
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-800 mb-1">
            Additional Attachment Required
          </h2>
          {currentRequest && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {currentRequest.request_message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Upload files
          </label>
          <input
            type="file"
            multiple
            className="text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 active:file:bg-blue-100"
            onChange={(e) => {
              Array.from(e.target.files || []).forEach((f) => uploadFile.mutate(f))
              e.target.value = ''
            }}
            disabled={uploadFile.isPending}
          />
          {uploadFile.isPending && (
            <p className="text-xs text-gray-500 mt-1">Uploading…</p>
          )}
        </div>
        {uploadedFiles.length > 0 && (
          <ul className="space-y-1">
            {uploadedFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-sm"
              >
                <span className="truncate text-gray-800">{f.original_filename}</span>
                <button
                  onClick={() => deleteFile.mutate(f.id)}
                  className="text-red-400 ml-2 text-xs font-medium active:text-red-600 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ActionButton
          disabled={uploadedFiles.length === 0}
          loading={submitAttachments.isPending}
          onClick={() => submitAttachments.mutate()}
        >
          Submit Attachments
        </ActionButton>
      </div>
    )
  }

  // Finance team: waiting banner
  if (status === 'attachment_requested' && isFinanceTeam) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-amber-800 mb-1">
          Waiting for Treasurer
        </h2>
        {currentRequest && (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {currentRequest.request_message}
          </p>
        )}
      </div>
    )
  }

  // Finance team: review uploaded files
  if (status === 'attachment_uploaded' && isFinanceTeam) {
    const uploadedFiles = currentRequest?.files ?? []
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          Treasurer Attachments — Review Required
        </h2>
        {uploadedFiles.length > 0 ? (
          <ul className="space-y-1">
            {uploadedFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <span className="truncate text-gray-800">{f.original_filename}</span>
                <button
                  onClick={() =>
                    downloadFile.mutate(f.id, {
                      onSuccess: ({ url }) => window.open(url, '_blank'),
                    })
                  }
                  className="text-blue-600 ml-2 text-xs font-medium active:text-blue-800 shrink-0"
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No files found.</p>
        )}
        <div className="flex gap-2 pt-1">
          <ActionButton
            loading={acceptAttachments.isPending}
            onClick={() => acceptAttachments.mutate()}
          >
            Accept
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() => setShowRejectForm((v) => !v)}
          >
            Reject
          </ActionButton>
        </div>
        {showRejectForm && (
          <div>
            <textarea
              className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 mb-2"
              rows={3}
              placeholder="Describe what still needs to be provided…"
              value={rejectMsg}
              onChange={(e) => setRejectMsg(e.target.value)}
            />
            <ActionButton
              variant="danger"
              disabled={!rejectMsg.trim()}
              loading={rejectAttachments.isPending}
              onClick={() =>
                rejectAttachments.mutate(
                  { message: rejectMsg },
                  {
                    onSuccess: () => {
                      setShowRejectForm(false)
                      setRejectMsg('')
                    },
                  }
                )
              }
            >
              Send &amp; Request Again
            </ActionButton>
          </div>
        )}
      </div>
    )
  }

  return null
}
```

- [ ] **Step 3: Render the panel in the main page**

In `ClaimDetailPage`, find the rejection banner block (around line 1471):
```javascript
{/* ── Rejection banner — shown on DRAFT claims returned with feedback ── */}
{claim.status === 'draft' && claim.rejection_comment && (
```

Add `<AttachmentRequestPanel claim={claim} />` immediately **after** this rejection banner block and **before** the `{/* ── Claim info card ── */}` comment:

```javascript
        {/* ── Attachment request panel ── */}
        {['submitted', 'attachment_requested', 'attachment_uploaded'].includes(claim.status) && (
          <AttachmentRequestPanel claim={claim} />
        )}
```

- [ ] **Step 4: Fix StatusPipeline for attachment statuses**

`StatusPipeline` uses `statusIndex(displayStatus)` to determine which step is active. `attachment_requested` and `attachment_uploaded` are not in `STATUS_ORDER`, so they return `-1` and the pipeline renders all steps as locked. Map them to `submitted` so the pipeline correctly shows the claim reached that milestone.

In `ClaimDetailPage.jsx`, find the `StatusPipeline` function (around line 108) and update the `displayStatus` line:

```javascript
// Before:
const displayStatus = claim.status === 'error' ? 'screenshot_uploaded' : claim.status

// After:
const displayStatus =
  claim.status === 'error'
    ? 'screenshot_uploaded'
    : claim.status === 'attachment_requested' || claim.status === 'attachment_uploaded'
    ? 'submitted'
    : claim.status
```

- [ ] **Step 5: Verify in browser**

Start the dev server:
```bash
cd frontend
npm run dev
```
1. Open a claim in `submitted` status as a finance team member — confirm "Request Additional Attachment" panel appears with textarea + Send Request button.
2. Confirm the panel is hidden for `compiled` or other statuses.
3. On a claim in `attachment_requested` status, confirm the pipeline shows "Submitted" step as done (green checkmark) rather than all steps locked.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ClaimDetailPage.jsx
git commit -m "feat: add AttachmentRequestPanel to ClaimDetailPage"
```

---

## Task 7: Frontend — HomePage and TreasurerHomePage

**Files:**
- Modify: `frontend/src/pages/HomePage.jsx`
- Modify: `frontend/src/pages/TreasurerHomePage.jsx`

- [ ] **Step 1: Add new statuses to HomePage**

In `frontend/src/pages/HomePage.jsx`, find the `STATUSES` array (lines 7–17). Add two new entries after the `Submitted` entry:

```javascript
const STATUSES = [
  { label: 'All',                  value: null,                    badge: 'bg-gray-100 text-gray-700' },
  { label: 'Pending Review',       value: 'pending_review',        badge: 'bg-amber-100 text-amber-800' },
  { label: 'Email Sent',           value: 'email_sent',            badge: 'bg-blue-100 text-blue-800' },
  { label: 'Screenshot Pending',   value: 'screenshot_pending',    badge: 'bg-amber-100 text-amber-800' },
  { label: 'Screenshot Uploaded',  value: 'screenshot_uploaded',   badge: 'bg-orange-100 text-orange-800' },
  { label: 'Docs Generated',       value: 'docs_generated',        badge: 'bg-purple-100 text-purple-800' },
  { label: 'Compiled',             value: 'compiled',              badge: 'bg-indigo-100 text-indigo-800' },
  { label: 'Submitted',            value: 'submitted',             badge: 'bg-green-100 text-green-800' },
  { label: 'Attach. Requested',    value: 'attachment_requested',  badge: 'bg-orange-100 text-orange-800' },
  { label: 'Attach. Uploaded',     value: 'attachment_uploaded',   badge: 'bg-blue-100 text-blue-800' },
  { label: 'Reimbursed',           value: 'reimbursed',            badge: 'bg-teal-100 text-teal-800' },
]
```

- [ ] **Step 2: Add new statuses to TreasurerHomePage**

In `frontend/src/pages/TreasurerHomePage.jsx`, find the `STATUS_LABELS` object (lines 4–15) and add two entries:

```javascript
const STATUS_LABELS = {
  draft: 'Draft',
  pending_review: 'Under Review',
  email_sent: 'Email Sent',
  screenshot_pending: 'Screenshot Pending',
  screenshot_uploaded: 'Screenshot Uploaded',
  docs_generated: 'Docs Generated',
  compiled: 'Compiled',
  submitted: 'Submitted',
  attachment_requested: 'Attachment Required',
  attachment_uploaded: 'Attachment Submitted',
  reimbursed: 'Reimbursed',
  error: 'Error',
}
```

Find the `STATUS_BADGE` object (lines 17–28) and add two entries:

```javascript
const STATUS_BADGE = {
  draft: 'bg-gray-200 text-gray-800',
  pending_review: 'bg-amber-100 text-amber-800',
  email_sent: 'bg-blue-100 text-blue-800',
  screenshot_pending: 'bg-amber-100 text-amber-800',
  screenshot_uploaded: 'bg-orange-100 text-orange-800',
  docs_generated: 'bg-purple-100 text-purple-800',
  compiled: 'bg-indigo-100 text-indigo-800',
  submitted: 'bg-green-100 text-green-800',
  attachment_requested: 'bg-orange-100 text-orange-800',
  attachment_uploaded: 'bg-amber-100 text-amber-800',
  reimbursed: 'bg-teal-100 text-teal-800',
  error: 'bg-red-100 text-red-800',
}
```

- [ ] **Step 3: Add action banner for attachment_requested claims in TreasurerHomePage**

Find the existing rejection-comment banner in the claim card render (around line 87):
```javascript
{claim.status === 'draft' && claim.rejection_comment && (
  <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1 mb-2 font-medium">
    ⚠ Action required — tap to view feedback
  </div>
)}
```

Add a similar banner immediately after it:
```javascript
{claim.status === 'attachment_requested' && (
  <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1 mb-2 font-medium">
    📎 Action required — additional attachment needed
  </div>
)}
```

- [ ] **Step 4: Verify in browser**

1. On `HomePage` (finance team view), check that the status filter tab bar now includes "Attach. Requested" and "Attach. Uploaded" tabs.
2. On `TreasurerHomePage`, check that a claim in `attachment_requested` status shows the orange action banner and the correct status badge "Attachment Required".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/HomePage.jsx frontend/src/pages/TreasurerHomePage.jsx
git commit -m "feat: add attachment_requested and attachment_uploaded to status tabs and treasurer view"
```
