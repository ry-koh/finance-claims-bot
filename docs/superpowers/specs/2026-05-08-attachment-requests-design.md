# Attachment Requests Design

## Understanding Summary

- **What:** A post-submission workflow where the Finance Director can flag a submitted claim to request additional attachments from CCA treasurers, after NUS office identifies missing or incorrect documents
- **Why:** NUS office sometimes requests additional attachments after a claim is submitted; only the Finance Director is notified of this, and currently there is no in-app channel to relay the request or receive the response
- **Who:** Finance Director (flags claims, reviews uploads, accepts/rejects); CCA Treasurers (receive request, upload files, submit)
- **Constraints:** Only applies to claims already in `submitted` status; free-form file upload (any type); multiple files per response; director downloads individual files to submit to NUS office; full audit trail across multiple request/response cycles
- **Non-goals:** Automatically re-generating or re-compiling claim documents; notifying finance members (only director); tracking which specific NUS officer requested the document

---

## Architecture

Two new statuses added to the `claims` status enum. Two new tables track each request cycle and individual uploaded files. All new endpoints live in the existing `/claims` router. Frontend changes are confined to `ClaimDetailPage.jsx`, `HomePage.jsx`, and `TreasurerHomePage.jsx` — no new pages required.

**Tech Stack:** FastAPI, Supabase (Postgres), Cloudflare R2, Telegram Bot API, React 18, TanStack Query v5, Tailwind CSS

---

## Data Model

### New claim statuses

Added to the existing `claims.status` CHECK constraint:
- `attachment_requested` — waiting for treasurer to upload files
- `attachment_uploaded` — treasurer submitted files, waiting for director review

Full updated enum: `draft`, `pending_review`, `email_sent`, `screenshot_pending`, `screenshot_uploaded`, `docs_generated`, `compiled`, `submitted`, `attachment_requested`, `attachment_uploaded`, `reimbursed`, `error`

### `claim_attachment_requests`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK DEFAULT gen_random_uuid() | |
| `claim_id` | UUID NOT NULL → `claims.id` ON DELETE CASCADE | |
| `director_id` | UUID NOT NULL → `finance_team.id` | who flagged it |
| `request_message` | text NOT NULL | what NUS office needs |
| `status` | text NOT NULL DEFAULT 'pending' CHECK IN ('pending', 'submitted', 'accepted', 'rejected') | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### `claim_attachment_files`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK DEFAULT gen_random_uuid() | |
| `request_id` | UUID NOT NULL → `claim_attachment_requests.id` ON DELETE CASCADE | |
| `file_url` | text NOT NULL | R2 object key |
| `original_filename` | text NOT NULL | |
| `uploaded_at` | timestamptz NOT NULL DEFAULT now() | |

### Indexes

```sql
create index idx_claim_attachment_requests_claim on claim_attachment_requests(claim_id);
create index idx_claim_attachment_files_request on claim_attachment_files(request_id);
```

### Request cycle logic

Each request cycle is one row in `claim_attachment_requests`. When the director rejects, the existing request record is marked `rejected` and a new request record is created for the next round. The "current" open request is always the latest row with status `pending` or `submitted`. This gives a full audit trail across multiple cycles.

---

## API Endpoints

All endpoints live in `backend/app/routers/claims.py`.

### `POST /claims/{id}/request-attachment`
- Auth: `require_finance_team`
- Precondition: claim status must be `submitted`
- Body: `{ message: str }`
- Creates a `claim_attachment_requests` row (status = `pending`)
- Updates claim status → `attachment_requested`
- Sends Telegram notification to the claim's treasurer:
  ```
  📎 Additional attachment requested for claim {reference_code}

  {message}

  Please upload the required files in the app.
  ```
- Returns: created request record

### `POST /claims/{id}/attachment-upload`
- Auth: `require_auth`
- Precondition: claim status must be `attachment_requested`; current open request must exist
- Body: multipart `file`
- Uploads file to R2 at `attachments/{claim_id}/{uuid}.{ext}`
- Creates a `claim_attachment_files` row linked to the current open request
- Returns: `{ id, file_url, original_filename, uploaded_at }`

### `POST /claims/{id}/attachment-submit`
- Auth: `require_auth`
- Precondition: claim status must be `attachment_requested`; at least one file uploaded on current request
- Updates current request status → `submitted`
- Updates claim status → `attachment_uploaded`
- Sends Telegram notification to Finance Director:
  ```
  📎 Attachments uploaded for claim {reference_code} — ready for your review.
  ```
- Returns: updated request record

### `POST /claims/{id}/attachment-accept`
- Auth: `require_finance_team`
- Precondition: claim status must be `attachment_uploaded`
- Updates current request status → `accepted`
- Updates claim status → `submitted`
- Returns: `{ ok: true }`

### `POST /claims/{id}/attachment-reject`
- Auth: `require_finance_team`
- Precondition: claim status must be `attachment_uploaded`
- Body: `{ message: str }`
- Updates current request status → `rejected`
- Creates a new `claim_attachment_requests` row (status = `pending`) with the new message
- Updates claim status → `attachment_requested`
- Sends Telegram notification to the claim's treasurer:
  ```
  📎 Attachments for claim {reference_code} need revision.

  {message}

  Please upload the corrected files in the app.
  ```
- Returns: new request record

### `GET /claims/{id}/attachment-requests`
- Auth: `require_auth`
- Returns all request cycles for the claim, newest first, each with nested `files` array
- Response: `[{ id, request_message, status, created_at, files: [{ id, file_url, original_filename, uploaded_at }] }]`

### `DELETE /claims/{id}/attachment-requests/current/files/{file_id}`
- Auth: `require_auth`
- Precondition: claim status must be `attachment_requested` (i.e. treasurer has not yet submitted); file must belong to the current open request
- Deletes the file from R2 and removes the `claim_attachment_files` row
- Returns: 204 No Content

### `GET /claims/{id}/attachment-requests/current/files/{file_id}/download`
- Auth: `require_finance_team`
- Generates an R2 presigned URL (60 min expiry) for the specified file
- Returns: `{ url: str }` — frontend opens in new tab

---

## Frontend

### New file: `frontend/src/api/attachmentRequests.js`

Hooks and fetch functions:
- `useAttachmentRequests(claimId)` — GET all requests with files
- `useRequestAttachment(claimId)` — POST to flag claim
- `useUploadAttachmentFile(claimId)` — POST multipart file upload
- `useDeleteAttachmentFile(claimId, fileId)` — DELETE single uploaded file before submit
- `useSubmitAttachments(claimId)` — POST to submit
- `useAcceptAttachments(claimId)` — POST to accept
- `useRejectAttachments(claimId)` — POST to reject + new message
- `useDownloadAttachmentFile(claimId, fileId)` — GET presigned URL

### `ClaimDetailPage.jsx`

**When status = `submitted` (director/member view):**
- "Request Attachment" button → inline form below with textarea for message + "Send Request" button (disabled while empty or pending)

**When status = `attachment_requested` (treasurer view):**
- Banner: director's message from current open request
- File picker (multiple, any type): each selected file uploads immediately to R2 on selection, shows filename + size + × remove button
- "Submit Attachments" button (disabled until at least one file is uploaded)

**When status = `attachment_requested` (director/member view):**
- Banner: "Waiting for treasurer to upload attachments"
- Shows current request message

**When status = `attachment_uploaded` (director/member view):**
- Panel listing each file in the current request: filename + "Download" button (opens presigned URL in new tab)
- "Accept" button → calls accept endpoint, invalidates claim query
- "Reject" button → reveals inline textarea for new message → "Send" → calls reject endpoint

### `HomePage.jsx`

Add `attachment_requested` and `attachment_uploaded` to the status filter tab list so the director can see and filter claims needing action.

### `TreasurerHomePage.jsx`

Surface `attachment_requested` claims with the same visual urgency as `pending_review` (e.g. same status badge colour or dedicated section).

---

## Telegram Notifications

| Trigger | Recipient | Message |
|---------|-----------|---------|
| Director flags claim | Treasurer | `📎 Additional attachment requested for claim {ref}\n\n{message}\n\nPlease upload the required files in the app.` |
| Treasurer submits | Finance Director | `📎 Attachments uploaded for claim {ref} — ready for your review.` |
| Director rejects | Treasurer | `📎 Attachments for claim {ref} need revision.\n\n{message}\n\nPlease upload the corrected files in the app.` |

Finance Director's `telegram_id` is fetched via `finance_team` where `role = 'director'`.

---

## Files

### New
- `supabase/migrations/018_attachment_requests.sql`
- `frontend/src/api/attachmentRequests.js`

### Modified
- `backend/app/routers/claims.py` — 6 new endpoints
- `frontend/src/pages/ClaimDetailPage.jsx` — attachment request UI panels
- `frontend/src/pages/HomePage.jsx` — add new statuses to filter tabs
- `frontend/src/pages/TreasurerHomePage.jsx` — surface `attachment_requested` claims

---

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| Two new statuses (`attachment_requested`, `attachment_uploaded`) | Single status + flag column | Unambiguous state — each party knows exactly what action is required of them |
| Separate `claim_attachment_requests` + `claim_attachment_files` tables | Extend `claims` table; single table with `text[]` | Matches existing 1-to-many pattern (receipts/receipt_images); full audit trail per cycle; individual file metadata needed for per-file download |
| Upload files immediately on selection (before submit) | Upload all on submit | Matches existing receipt upload UX; avoids large multi-file upload on submit; partial uploads still visible on page refresh |
| Director receives Telegram on treasurer submit | Polling / no notification | Director is not always watching the app; push is the established pattern |
| Presigned URL for download (not proxied) | Proxy download through backend | Simpler, less server load; R2 presigned URLs are the existing pattern for document downloads |
| New `attachmentRequests.js` API file | Extend `claims.js` | Keeps claims.js from growing; attachment request logic is a self-contained concern |
