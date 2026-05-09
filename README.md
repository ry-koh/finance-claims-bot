# Finance Claims Bot

## Overview

Finance Claims Bot is an internal claims management system built for the **Raffles Hall finance team** to process CCA reimbursement claims. The system is a **Telegram Mini App** — a React web app that opens inside Telegram, with a FastAPI backend and a Telegram bot for notifications.

Three types of users interact with the system:
- **Finance team** (directors and members): manage the full claims lifecycle
- **CCA Treasurers**: submit claims as drafts for finance team review, and receive messages from the finance team via the bot
- **One-off claimers**: individuals without an account (e.g. alumni, guests); claims are created on their behalf by the finance team; they have no app access

---

## User Roles

| Role | Access | Responsibilities |
|---|---|---|
| **Finance Director** | Full access + director tools | Approves team registrations, manages team membership, views analytics, configures document/email settings |
| **Finance Member** | Claims + approval wizard | Creates and processes claims end-to-end |
| **CCA Treasurer** | Own claims only | Registers via the mini app, creates draft claims, submits for finance review, receives bot messages |
| **One-off Claimer** | None | Not an app user; name/email/matric/phone stored directly on the claim |

All users register through the mini app. Treasurer registrations require director approval.

---

## Claim Lifecycle

### Finance-team-created claims
```
draft → email_sent → screenshot_pending → screenshot_uploaded
      → docs_generated → compiled → submitted → reimbursed
```

### Treasurer-submitted claims
```
draft (treasurer edits)
  → pending_review     (treasurer submits for finance review)
  → [rejected back to draft, or approved:]
  → email_sent → screenshot_pending → ...→ reimbursed
```

### Attachment request branch (from submitted)
```
submitted → attachment_requested  (finance team flags missing attachment)
              → attachment_uploaded   (treasurer/finance team uploads files)
              → [accepted → submitted, or rejected → attachment_requested]
```

For one-off claimers in `attachment_requested` state, the finance team uploads files directly since those claimers have no app access.

Any step can land in `error` with a stored message; the UI shows a retry button.

Treasurers see simplified status labels only: `Draft`, `Needs Action`, `In Review`, `Awaiting Submission`, `Submitted`, and `Reimbursed`. Finance/director views keep the detailed internal statuses needed for processing.

---

## Tech Stack

### Frontend
- **React 18 + Vite + Tailwind CSS**
- **TanStack Query v5** for server state, **React Router v6** for routing
- Theme-aware mobile UI with light/dark/system modes and treasurer-focused claim health panels
- Hosted on **Vercel** (`frontend/vercel.json` has a single SPA rewrite rule)
- Runs inside Telegram as a **Mini App**; user identity comes from `window.Telegram.WebApp.initData`

### Backend
- **Python 3.12, FastAPI**
- Hosted on **Google Cloud Run** (`asia-southeast1`, 512 MiB RAM by default)
- Auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`)
- Auth: Telegram `initData` HMAC-SHA256 validated on every request; users identified by Telegram ID

### Database
- **Supabase** (PostgreSQL via PostgREST)
- Kept alive by a GitHub Actions weekly cron (Sunday midnight UTC) that pings `/health`

### File Storage — two systems
- **Cloudflare R2** (S3-compatible): receipt images, bank transaction screenshots, MF approval scans, exchange rate screenshots, attachment request files
- **Google Drive** (user OAuth2 refresh token): all generated PDFs, organised into per-claim subfolders named after the reference code

### Document Generation
- **fpdf2**: LOA built programmatically in Python; images embedded directly
- **Google Sheets API**: Summary sheet and Transport Form (placeholder find/replace on templates)
- **Google Docs API**: RFP document (placeholder find/replace on template)
- **pypdf**: merges all generated PDFs into a single compiled document

### Integrations
- **Gmail API** (OAuth2 refresh token): sends confirmation emails from the configured Gmail account
- **python-telegram-bot**: webhook handler for bot commands; sends compiled PDF to FD's Telegram chat; delivers finance-team messages, registration alerts, help-inbox alerts, claim reminders, and reimbursement notifications

---

## Document Generation

For each claim the system generates:

| Document | Method | Description |
|---|---|---|
| **LOA** | fpdf2 | MF approval scan (first page, if Master's Fund), receipt images, bank transaction screenshots |
| **Summary Sheet** | Google Sheets | Financial breakdown: line items, GST codes, DR/CR, WBS account, grand total |
| **RFP** | Google Docs | Formal payment request document |
| **Transport Form** | Google Sheets | Trip-by-trip breakdown (from/to, purpose, date DD/MM/YYYY, time HH:MM AM/PM, distance, amount) — only if claim has transport trips |
| **Compiled PDF** | pypdf | All of the above + email screenshot merged in order |

All files are saved to a Google Drive subfolder named after the claim reference code. Re-generating documents marks existing generated docs stale but preserves the email screenshot.

---

## Receipt Approval Wizard

When a claim is ready for approval, the finance team uses a step-by-step wizard (`/claims/:id/approve`) instead of a single-click approve button.

1. **Per-receipt screens** — for each receipt:
   - Full-size receipt images (tap to fullscreen)
   - Receipt info (description, company, date, amount)
   - All bank transactions for the claim, with the linked one highlighted; refund amounts and screenshots viewable inline
   - Foreign exchange evidence for foreign-currency receipts, with screenshots shown inline when uploaded
   - Finance fields: Category (dropdown of all categories), GST Code (`IE`/`I9`/`L9`), DR/CR
   - Optional flag note (pre-fills the rejection remarks textarea)
   - Next is disabled until category is selected
2. **Summary screen** — review all receipts grouped by category, reconciliation check (total receipts vs total net BTs), flagged receipts banner
3. **Approve** — batch PATCHes all receipts with category/GST/DR-CR, then sends the confirmation email
4. **Reject** — available from any screen; textarea pre-filled with per-receipt flag notes

Wizard progress is saved to `sessionStorage` so accidental back-navigation doesn't lose work.

---

## SOP and Help References

The app includes operational reference material so treasurers do not need to rely only on separate documents.

- **SOP page (`/sop`)**: available to all roles. It covers setup, claim submission rules, evidence requirements, claim statuses, direct vendor payment, NUSync/payment collection, and what to do when unsure.
- **Help > Common Questions**: the place for receipt/platform-specific instructions that may change often, such as Shopee invoices, bank transaction screenshot rules, card payments for physical purchases, and disallowed payment methods.
- **Help Inbox (`/help-inbox`)**: treasurers can submit questions from the Help tab; finance team/directors review and reply from the inbox.
- **Submission timing**: claims should be submitted within 3 working days once all event receipts and bank transactions are ready.
- **Physical receipts**: physical receipts are still submitted to Ryan after upload; exact handover timing/location can be updated operationally without changing the app.

---

## Email Flow

1. Finance team clicks **Send Email** on a claim
2. Backend builds an HTML confirmation email to the claimer:
   - **Actual email To**: the claimer's email
   - **Actual subject**: claim reference code
   - **Body**: instructions plus a copy-paste claim submission block
   - **Copy-paste To**: configured `claim_submission_to_email` (for example `rh.finance@u.nus.edu`)
   - **Copy-paste CC**: configured `claim_submission_cc_email` plus receipt payer emails when someone other than the treasurer paid
   - **Salutation**: configured document/email Finance Director salutation
   - **Greeting**: uses the claimer's full name
   - **Auto-remarks**: Master's Fund flag, partial claim indicator, refund breakdowns, foreign currency notes
   - **Attachments**: receipt images and bank transaction screenshots
3. Email is sent via Gmail API from the configured OAuth Gmail account
4. Finance team uploads a screenshot of the sent email
5. Screenshot is included in the compiled PDF as proof of correspondence

---

## Settings, Identity, and Email Routing

The Settings page separates app identity, document identity, and claim email routing.

| Setting area | Stored in | Used for |
|---|---|---|
| **Your App Identity** | `finance_team.name` and `finance_team.email` | Drawer/account identity and audit timeline actor names |
| **Claim Email Routing** | `app_settings.claim_submission_to_email` and `app_settings.claim_submission_cc_email` | The `To` and default `CC` lines inside the claim email copy-paste block |
| **Document & Email Finance Director** | `app_settings.document_fd_*` | Generated document identity, email salutation, and transport form FD personal email |

These settings do not change the Gmail OAuth account used to send the confirmation email. The Gmail sender is controlled by `GMAIL_REFRESH_TOKEN`.

---

## Attachment Requests

When NUS office requests additional documentation after a claim is submitted:

1. Finance team opens the claim and clicks **Request Attachment**, describing what is needed
2. Claim status moves to `attachment_requested`
3. For **registered claimers**: the finance member who created the claim is notified via Telegram bot
4. For **one-off claimers**: no Telegram notification (they have no app access); the request message is visible in the claim detail so finance team can collect files on their behalf
5. The relevant party uploads files via the attachment panel in the app
6. Finance team reviews uploads — Accept returns the claim to `submitted`; Reject creates a new request cycle

---

## Analytics

Available to the finance director at `/analytics`.

**Group-by options:**
- By CCA (rows per CCA, grouped under portfolio headers)
- By Portfolio
- By Fund (SA vs MF vs MBH total)
- Portfolio × Fund (SA and MF columns per portfolio)
- CCA × Fund (SA and MF columns per CCA, grouped under portfolio headers)

**Filters:** date range and status multi-select.

**Export:** the current view can be downloaded as a CSV file (opens in Excel) via the Export CSV button.

---

## Data Model

```
Portfolio → CCA → finance_team (treasurer) ─┐
                                             ↓
                               Claim ──→ ClaimLineItems
                                 ↓              ↓
                             Receipts ←─────────┘
                                 ↓
                         ReceiptImages
                         BankTransactions → BankTransactionImages
                                            BankTransactionRefunds → RefundImages
                         ClaimDocuments (LOA, Summary, RFP, Transport, Screenshot, Compiled)
                         ClaimAttachmentRequests → ClaimAttachmentFiles

finance_team (directors, members, treasurers)
  ↕ (treasurer_ccas junction)
CCA

One-off claimers: no separate row — name/matric/phone/email stored directly on Claim
```

| Entity | Description |
|---|---|
| **Portfolio** | Group of CCAs (e.g. Sports, Arts) |
| **CCA** | Individual club/activity |
| **Claim** | Core object: description, WBS account, total amount (auto-computed by DB trigger), date, remarks, transport flag, partial claim flag; links to either a registered treasurer (`claimer_id`) or stores one-off details inline. `submitted_at` and `reimbursed_at` are auto-stamped by a DB trigger on the first transition to those statuses. |
| **ClaimLineItem** | Category grouping of receipts — category, GST code, DR/CR, combined description |
| **Receipt** | Individual expense — `amount` (what was paid; used for bank transaction reconciliation), optional `claimed_amount` (what is being claimed; blank = full amount), required payer snapshot (`payer_name`, `payer_email`, optional saved `payer_id`), description, company, date, receipt images, bank transaction link. DB trigger sums `COALESCE(claimed_amount, amount)` into the claim total. BT reconciliation always compares `receipt.amount` vs BT net (not `claimed_amount`) since bank debits reflect actual spend. |
| **TreasurerPayer** | Saved payer list per registered treasurer. New receipts default to the treasurer themself; treasurers, finance members, and directors can manage saved payers. One-off claims use receipt-only payer snapshots instead. |
| **BankTransaction** | A bank debit linked to receipts; can have multiple images and refunds |
| **BankTransactionRefund** | A refund against a BT — amount and screenshot |
| **ClaimDocument** | A generated file — versioned; only `is_current=true` is used per type; email screenshot is never marked stale |
| **ClaimAttachmentRequest** | A request cycle for additional attachments — tracks request message, status, and uploaded files |
| **AppSettings** | Key/value settings for academic year, claim email routing, and document/email Finance Director profile |

---

## WBS Accounts

Treasurers select their fund via the "Are you using Master Fund?" question when creating a claim. Finance Director can change the value during review.

| Code | UI Label | Notes |
|---|---|---|
| **SA** | No (default) | Student Account |
| **MF** | Yes | Master's Fund — requires a Master's Approval screenshot upload; scan inserted as first LOA page |
| **MBH** | — | MBH account — set by Finance Director only |
| **OTHERS** | Others | Claimer is unsure; Finance Director updates at review |

---

## Frontend Pages

| Page | Path | Roles | Purpose |
|---|---|---|---|
| Home | `/` | Director, Member | Claims list with scrollable status pills, search, date filters, bulk actions, and CSV export. Cards show submitted/reimbursed dates when available. |
| Treasurer Home | `/` | Treasurer | Own claims grouped by simplified statuses: Needs Action, Draft, In Review, Awaiting Submission, Submitted, Reimbursed. |
| New Claim | `/claims/new` | All | Multi-step form: claimer, receipts, bank transactions, transport; includes claim health checks and draft recovery notices |
| Claim Detail | `/claims/:id` | All | Full claim view: edit fields, manage receipts/BTs, review reimbursement split by payer, run pipeline, handle attachment requests, and view claim health |
| Approval Wizard | `/claims/:id/approve` | Director, Member | Step-by-step receipt review before approving |
| CCA Treasurer Lookup | `/identifiers` | Director, Member | Read-only lookup of active CCA treasurer contact details and CCA assignments |
| Contact | `/contact` | Director, Member | Send a message to a CCA treasurer via the Telegram bot |
| Pending Registrations | `/pending-registrations` | Director | Approve or reject treasurer registrations |
| Team | `/team` | Director | View and manage active team members |
| Analytics | `/analytics` | Director | Claims volume by CCA/portfolio/fund with SA+MF breakdown and CSV export |
| Reimbursements | `/reimbursements` | Director | PayLah/PayNow checklist for selected submitted claims, grouped by claimer with phone, amount, claim IDs, paid checkboxes, and grouped Telegram completion messages. |
| CCA Treasurer Management | `/cca-treasurers` | Director | Manage active CCA treasurer profiles and CCA assignments |
| Portfolios & CCAs | `/ccas` | Director | Create, rename, and delete portfolios and CCAs. Deleting shows any linked treasurers who will be unassigned. |
| Help | `/help` | Treasurer | Common Questions and the treasurer's own Help questions |
| Help Inbox | `/help-inbox` | Director, Member | Review and reply to treasurer questions; new questions notify finance via the bot |
| SOP | `/sop` | All | In-app finance SOP and claims reference |
| Settings | `/settings` | Director | Configure academic year, app identity, claim email routing, and document/email Finance Director profile. |
| System Status | `/system-status` | Director | Check backend configuration, webhook secret status, storage usage, and backfill unknown file sizes. |

---

## Authentication & Registration

- Telegram WebApp `initData` validated via HMAC-SHA256 on every API request
- Users identified by Telegram user ID against the `finance_team` table
- No passwords or separate login

**Registration flow:**
1. User opens the mini app for the first time → sees registration form
2. Selects role (Finance Member or CCA Treasurer), enters name, email, and `@telegram_username`
3. CCA treasurers also enter matric number, PayLah/PayNow contact number, and CCA(s)
4. CCA treasurers must confirm that their contact number, email, and matric number are accurate before submitting
5. Registration is created in `pending` state
6. Active directors with Telegram IDs receive a bot alert for the pending registration
7. Director approves via the Pending Registrations page
8. User is notified via bot and gains access

---

## Treasurer Contact

Finance team members can send direct messages to CCA treasurers via the **Contact** page:
1. Select a treasurer from the list (shows name, @username, CCAs)
2. Type a message
3. Click **Send via Bot** — the message is delivered to the treasurer's Telegram chat from the bot, attributed with the sender's name

Treasurers must have previously started the bot for delivery to work.

---

## Bot Notifications

The bot sends operational notifications when the recipient has started the bot and has an active `finance_team.telegram_id`.

- Directors receive pending-registration alerts.
- Finance team/directors receive new Help Inbox question alerts.
- Treasurers receive approval/email-sent reminders, rejection messages, submitted-to-school updates, Help replies, and reimbursement completion messages.

---

## Infrastructure

| Component | Hosting | Notes |
|---|---|---|
| Frontend | Vercel | Free tier; SPA rewrite in `vercel.json` |
| Backend | Google Cloud Run | `asia-southeast1`; 512 MiB RAM, max 1 instance, scales to zero; auto-deploy on push to `main` |
| Database | Supabase | Free tier; kept alive by weekly GitHub Actions cron |
| Images & Attachments | Cloudflare R2 | Free tier; S3-compatible |
| Documents | Google Drive | User OAuth; per-claim subfolders |

---

## Free-Tier Guardrails

- Cloud Run deploys with one worker, `512Mi` memory, `min-instances 0`, and `max-instances 1` to avoid idle or burst billing.
- Telegram webhook registration happens in the deploy workflow, not during every Cloud Run startup, so cold `/start` requests do not wait on a webhook setup call.
- If `TELEGRAM_WEBHOOK_SECRET_TOKEN` is unset, the app uses a deterministic fallback derived from the bot token. Set an explicit secret only if you want manual secret rotation.
- Document generation is serialized with `DOCGEN_MAX_WORKERS=1` so PDF/image work does not run in parallel and spike RAM.
- Uploads are capped with `MAX_UPLOAD_BYTES=8000000` / `VITE_MAX_UPLOAD_BYTES=8000000`, and PDF conversion is capped with `MAX_PDF_PAGES=20`.
- System Status shows tracked R2/Drive storage usage. Older files with unknown sizes can be backfilled from metadata without re-uploading files.
- The expected usage pattern is low concurrency: 60-70 CCA treasurers, about 8 finance team members, and 1 director. Bulk finance operations are supported, but heavy document generation is intentionally queued.

---

## Setup

See [SETUP.md](SETUP.md) for environment variables, service account configuration, and initial data seeding.
