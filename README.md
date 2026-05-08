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
| **Finance Director** | Full access + director tools | Approves team registrations, manages team membership, views analytics; Gmail account used to send emails |
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

---

## Tech Stack

### Frontend
- **React 18 + Vite + Tailwind CSS**
- **TanStack Query v5** for server state, **React Router v6** for routing
- Hosted on **Vercel** (`frontend/vercel.json` has a single SPA rewrite rule)
- Runs inside Telegram as a **Mini App**; user identity comes from `window.Telegram.WebApp.initData`

### Backend
- **Python 3.11, FastAPI**
- Hosted on **Google Cloud Run** (`asia-southeast1`, 1 GB RAM)
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
- **Gmail API** (OAuth2 refresh token): sends emails from the Finance Director's personal Gmail account
- **python-telegram-bot**: webhook handler for bot commands; sends compiled PDF to FD's Telegram chat; delivers finance-team messages to treasurer chats

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
   - Finance fields: Category (dropdown of all categories), GST Code (`IE`/`I9`/`L9`), DR/CR
   - Optional flag note (pre-fills the rejection remarks textarea)
   - Next is disabled until category is selected
2. **Summary screen** — review all receipts grouped by category, reconciliation check (total receipts vs total net BTs), flagged receipts banner
3. **Approve** — batch PATCHes all receipts with category/GST/DR-CR, then sends the confirmation email
4. **Reject** — available from any screen; textarea pre-filled with per-receipt flag notes

Wizard progress is saved to `sessionStorage` so accidental back-navigation doesn't lose work.

---

## Email Flow

1. Finance team clicks **Send Email** on a claim
2. Backend builds an HTML email:
   - **To**: claimer's email (+ any extra recipients)
   - **Subject**: claim reference code
   - **Body**: claims summary (CCA, event, amount, PayNow number), itemised receipt list, auto-generated remarks
   - **Auto-remarks**: Master's Fund flag, partial claim indicator, refund breakdowns, foreign currency notes
   - **Attachments**: receipt images and bank transaction screenshots
3. Email sent via Gmail API from FD's account
4. Finance team uploads a screenshot of the sent email
5. Screenshot is included in the compiled PDF as proof of correspondence

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
| **Receipt** | Individual expense — `amount` (what was paid; used for bank transaction reconciliation), optional `claimed_amount` (what is being claimed; blank = full amount), description, company, date, receipt images, bank transaction link. DB trigger sums `COALESCE(claimed_amount, amount)` into the claim total. BT reconciliation always compares `receipt.amount` vs BT net (not `claimed_amount`) since bank debits reflect actual spend. |
| **BankTransaction** | A bank debit linked to receipts; can have multiple images and refunds |
| **BankTransactionRefund** | A refund against a BT — amount and screenshot |
| **ClaimDocument** | A generated file — versioned; only `is_current=true` is used per type; email screenshot is never marked stale |
| **ClaimAttachmentRequest** | A request cycle for additional attachments — tracks request message, status, and uploaded files |

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
| Treasurer Home | `/` | Treasurer | Own draft/submitted claims. Cards show submitted/reimbursed dates when available. |
| New Claim | `/claims/new` | All | Multi-step form: claimer → receipts → bank transactions → transport |
| Claim Detail | `/claims/:id` | All | Full claim view — edit fields, manage receipts/BTs, run pipeline, handle attachment requests |
| Approval Wizard | `/claims/:id/approve` | Director, Member | Step-by-step receipt review before approving |
| Identifier Data | `/identifiers` | Director, Member | Edit treasurer matric numbers and phone numbers used in claim documents |
| Contact | `/contact` | Director, Member | Send a message to a CCA treasurer via the Telegram bot |
| Pending Registrations | `/pending-registrations` | Director | Approve or reject treasurer registrations |
| Team | `/team` | Director | View and manage active team members |
| Analytics | `/analytics` | Director | Claims volume by CCA/portfolio/fund with SA+MF breakdown and CSV export |
| Portfolios & CCAs | `/ccas` | Director | Create, rename, and delete portfolios and CCAs. Deleting shows any linked treasurers who will be unassigned. |

---

## Authentication & Registration

- Telegram WebApp `initData` validated via HMAC-SHA256 on every API request
- Users identified by Telegram user ID against the `finance_team` table
- No passwords or separate login

**Registration flow:**
1. User opens the mini app for the first time → sees registration form
2. Selects role (Finance Member or CCA Treasurer), enters name, email, `@telegram_username`, and (for treasurers) their CCA(s)
3. Registration is created in `pending` state
4. Director approves via the Pending Registrations page
5. User is notified via bot and gains access

---

## Treasurer Contact

Finance team members can send direct messages to CCA treasurers via the **Contact** page:
1. Select a treasurer from the list (shows name, @username, CCAs)
2. Type a message
3. Click **Send via Bot** — the message is delivered to the treasurer's Telegram chat from the bot, attributed with the sender's name

Treasurers must have previously started the bot for delivery to work.

---

## Infrastructure

| Component | Hosting | Notes |
|---|---|---|
| Frontend | Vercel | Free tier; SPA rewrite in `vercel.json` |
| Backend | Google Cloud Run | `asia-southeast1`; 1 GB RAM; auto-deploy on push to `main` |
| Database | Supabase | Free tier; kept alive by weekly GitHub Actions cron |
| Images & Attachments | Cloudflare R2 | Free tier; S3-compatible |
| Documents | Google Drive | User OAuth; per-claim subfolders |

---

## Setup

See [SETUP.md](SETUP.md) for environment variables, service account configuration, and initial data seeding.
