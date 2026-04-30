# Finance Claims Bot — Design Document
_Last updated after independent design review_

---

## Understanding Summary

- **What:** A Telegram Mini App for a Finance Director and their small finance team to manage the full claims lifecycle end-to-end
- **Why:** Current workflow has multiple friction points — manual form filling, no easy CRUD, Identifier Data hard to update, multi-step pipeline with no centralised progress view
- **Who:** Finance team members only (small, known group). CCA treasurers submit claim info to the finance team externally; they do not use this system
- **Key constraints:** Free hosting only; Google Drive for file storage; receipts arrive in multiple formats needing normalisation; all receipts in a claim must share one WBS account; max 5 expense categories per claim
- **Non-goals (Phase A):** CCA treasurers using the system directly (Phase C later)

---

## Assumptions

1. Render cold-start (~30s on first daily open) is acceptable — mitigated by a pre-warm ping on Mini App open and a visible loading state
2. Finance team members are registered once by the Finance Director with their Telegram ID
3. Google Drive folder structure: `Claims/{Academic Year}/{Reference Code}/` — created by FastAPI on claim creation
4. Transport form template will be provided separately; it is optional per claim
5. Gmail API sends from the Finance Director's existing Gmail account (one-time OAuth setup); refresh token stored as Render environment variable (not filesystem — wiped on redeploy)
6. The existing Google Docs/Sheets templates (Summary, RFP, Transport) are reused as-is; LOA is generated as a PDF directly in Python

---

## Architecture

```
Telegram App
    │
    ├── Bot (webhook) ──────────────────────┐
    │                                        │
    └── Mini App (Vercel, React + Vite)      │
              │                              │
              │ HTTPS API calls              │
              ▼                              ▼
        FastAPI backend (Render)─────────────┘
              │
       ┌──────┼──────────────┐
       ▼      ▼              ▼
  Supabase  Google Drive  Gmail API
 (PostgreSQL) (files/docs)  (emails)
              ▲
    GitHub Actions (free weekly keep-alive ping
    to /health — prevents Supabase inactivity pause)
```

**Layer responsibilities:**
- **Mini App (Vercel):** Full UI — claim form, receipt editor, claim list, document status, CRUD, Identifier Data management
- **Bot:** Lightweight companion — sends status notifications, deep-links into Mini App for specific claims
- **FastAPI (Render):** All business logic — claim CRUD, PDF generation, Drive uploads, email sending, Telegram notifications
- **Supabase:** Structured data — claims, claimers, CCAs, portfolios, finance team members
- **Google Drive:** Receipt images, generated LOA/Summary/RFP/Transport PDFs, compiled packages
- **Gmail API:** Sends confirmation emails to CCA treasurers from existing Finance Director Gmail

---

## Database Schema

```
finance_team
────────────
id, telegram_id, name, email, role (director/member)

portfolios          ccas
──────────          ────
id, name            id, portfolio_id, name

claimers
────────
id, cca_id, name, matric_no, phone, email

claims
──────
id, reference_code, claimer_id, filled_by (→ finance_team),
processed_by (→ finance_team), claim_description,
total_amount (computed), date, wbs_account (SA/MBH/MF),
wbs_no (auto-derived), remarks, other_emails TEXT[],
status, error_message TEXT, transport_form_needed (bool),
created_at, updated_at

claim_line_items  (up to 5 per claim, auto-grouped by category)
────────────────
id, claim_id, line_item_index, category, category_code,
gst_code, dr_cr, combined_description, total_amount (computed)

receipts  (unlimited per claim)
────────
id, claim_id, line_item_id, receipt_no, description,
company, date, amount, receipt_image_drive_id,
bank_screenshot_drive_id

claim_documents
───────────────
id, claim_id, type (loa/summary/rfp/transport/email_screenshot/compiled),
drive_file_id, is_current BOOLEAN, created_at

document_counters  (prevents race conditions on reference codes)
─────────────────
id, type (claim/summary/rfp/transport), academic_year, counter
```

**WBS accounts (3 only):**
- SA → H-404-00-000003
- MBH → H-404-00-000004
- MF → E-404-10-0001-01

**Claim status progression:**
`draft → email_sent → screenshot_pending → screenshot_uploaded → docs_generated → compiled → submitted → reimbursed`

Error state: any step can transition to `error` — `error_message` field records what failed. Finance team can retry from the claim detail view.

---

## Mini App UI Flow

### New Claim — 3 steps

**Step 1: Who**
Portfolio → CCA → Select claimer (or add new inline)

**Step 2: What**
Claim description, remarks, other emails (multi-input), WBS account (SA/MBH/MF)

**Step 3: Receipts**
Add receipts individually. Each receipt: receipt no., description, company, date, amount, category, GST code, DR/CR, upload receipt image, upload bank screenshot.

Receipts auto-group by category into line items (live summary shown below receipt list). Combined description written once per line item group at the bottom of Step 3.

**Split triggers (automatic, with confirmation prompt):**
1. Receipt has different WBS account than the claim → "This receipt is under MBH but this claim is SA. Split into a new claim?"
2. 6th unique category added → "You have 6 categories — max 5 per claim. Split into a new claim?"

Split logic: new claim inherits claimer/event details, excess receipts moved to it. Both claims are reviewable before saving.

**Re-categorisation edge case:** if a receipt is moved to a different category after the combined description is written, the user is prompted: "The combined description for this group will need updating. Clear it?"

### Receipt Upload Flow
1. Finance team uploads file (JPEG, PNG, HEIC, WEBP, or PDF)
2. MIME type validated — unsupported formats return a clear error message, not a 500
3. Backend auto-converts: HEIC/WEBP/PDF-page → JPEG, normalised for A4
4. Mini App shows Cropper.js editor: rotate + crop
5. Confirmed image saved to Google Drive under `Claims/{Year}/{Ref}/receipts/`

### Claim Detail View
```
[Reference Code] — [Claimer] — [Total]
─────────────────────────────────────
● Email pending      [Send Email]
○ Screenshot         [Upload Screenshot]   ← unlocks after email sent
○ Documents          [Generate Docs]       ← unlocks after screenshot
○ Compiled           [Compile PDF]         ← unlocks after docs
○ Submitted          [Mark Submitted]
─────────────────────────────────────
[Edit Claim]   [View Files]   [Delete]
```

Actions unlock sequentially. Failed actions show an error banner with a [Retry] button; `error_message` is displayed inline.

### Home / Dashboard
List of all claims, filterable by status. Summary counters per status at top.

### Identifier Data View
Searchable list of claimers per CCA. Fully editable inline. New claimers can also be added mid-claim-entry from Step 1.

---

## Document Generation

**LOA** — generated directly as a PDF in Python using `fpdf2`. Receipt images stacked one per page, auto-scaled to A4 margins. No template needed.

**Summary, RFP, Transport Form** — copy Google Docs/Sheets templates via Drive API, fill values programmatically, export as PDF. Templates remain editable in Google Drive without touching code.

| Document | Method | Output |
|---|---|---|
| LOA | fpdf2 (Python, direct) | LOA No. X - (REF).pdf |
| Summary | Google Sheets template | Summary No. X - (REF).pdf |
| RFP | Google Docs template | RFP No. X - (REF).pdf |
| Transport Form | Google Docs template (optional) | Transport No. X - (REF).pdf |

**Compiled PDF order:**
`RFP → LOA (receipt images) → Transport Form (if needed) → email screenshot → Summary`

**Compilation:** Python `pypdf` merges all PDFs server-side.

**Stale document detection:** editing a claim after documents are generated flags outdated documents and shows [Regenerate Documents] on the claim detail view. Old `claim_documents` records have `is_current` set to false; new ones are marked true.

**Document numbering:** `document_counters` table with `SELECT ... FOR UPDATE` prevents race conditions when two claims are saved simultaneously.

---

## Email Generation

- Gmail API sends from Finance Director's Gmail (one-time OAuth; refresh token stored as Render env var)
- Email body: confirmation to claimer + copy-paste template for them to forward to rh.finance@u.nus.edu
- CC instructions in body: 68findirector.rh@gmail.com + `other_emails` array
- Subject: reference code
- Attachments: receipt images + bank screenshots from Google Drive
- After sending: claim status → `screenshot_pending`
- Pre-warm ping sent to backend on Mini App open to avoid cold-start stall during email send

---

## Auth & Access Control

- Telegram user ID checked on every Mini App open against `finance_team` table
- Finance Director registers team members via bot command (`/addmember @username`)
- Anyone not in the table sees "Access denied" — no login screen
- Role field: Finance Director has elevated permissions (delete claims, manage team, hard-delete)

---

## CRUD

- All claim fields editable from claim detail view at any status
- Editing triggers stale document detection
- Receipts and line items editable inline
- Claimer details editable from claim or from Identifier Data view
- Delete = soft delete, recoverable for 30 days
- Finance Director role can hard-delete

---

## Keep-Alive (Supabase Inactivity Prevention)

GitHub Actions free cron job runs weekly (Sunday midnight). Sends a GET request to `GET /health` on the Render backend. The `/health` endpoint makes a lightweight query to Supabase (`SELECT 1`). This keeps both Render and Supabase active at zero cost. Configured entirely in `.github/workflows/keepalive.yml` — no external service needed.

---

## Decision Log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Finance team are the users | CCA treasurers submit directly | Finance team validates; treasurers provide raw info externally |
| 2 | Telegram Mini App (React) | Conversational bot only | Complex forms and CRUD need proper UI |
| 3 | FastAPI + React | Next.js serverless, GAS | Next.js times out on PDF generation; GAS dead end for full vision |
| 4 | Render + Vercel (free) | Local hosting, Railway | Auto-restarts, self-maintaining, genuinely free |
| 5 | Supabase PostgreSQL | Google Sheets as DB, Firebase | Proper relational DB; always-on; free |
| 6 | Google Drive for files | Supabase storage, S3 | Already in use, free, familiar |
| 7 | Google Docs/Sheets templates for Summary/RFP/Transport | Generate all PDFs from scratch | Templates already exist; editable without code changes |
| 8 | LOA generated directly via fpdf2 | Google Docs template | Google Docs API unreliable for page-by-page image insertion |
| 9 | Email screenshot appended at compile time | Re-insert into LOA Doc | Simpler; avoids regenerating LOA |
| 10 | Receipts auto-group by category | Pre-create groups first | More natural UX — know receipts before groups |
| 11 | WBS account at claim level (SA/MBH/MF only) | WBS per receipt | Business rule: all receipts in a claim share one WBS account |
| 12 | Auto split on different WBS or >5 categories | Manual splitting | Prevents invalid claims; reduces manual work |
| 13 | Pillow (backend) + Cropper.js (frontend) | Accept raw uploads | Receipts in HEIC/WEBP/PDF; need rotation/crop before PDF insertion |
| 14 | Soft delete with 30-day recovery | Hard delete | Prevents accidental data loss |
| 15 | Telegram user ID whitelist | Password, Google OAuth | Simplest for small known team; no login screen |
| 16 | MF(RHMP) removed | Keep all 4 WBS accounts | Confirmed unused |
| 17 | Gmail refresh token in Render env var | Filesystem .json | Render filesystem wiped on redeploy; env vars persist |
| 18 | GitHub Actions keep-alive cron | External ping service | Free, zero-dependency, lives in the repo |
| 19 | document_counters table with SELECT FOR UPDATE | Derive from claim order | Prevents race conditions on concurrent claim creation |
| 20 | Compiled PDF order: RFP → LOA → Transport → Screenshot → Summary | Other orders | Confirmed matches finance office submission order |
