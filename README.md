# Finance Claims Bot

## Overview

Finance Claims Bot is an internal claims management system built for the **Raffles Hall finance team** to process CCA reimbursement claims on behalf of treasurers. The system is a **Telegram Mini App** — a React web app that opens inside Telegram. Finance team members manage the full claims lifecycle inside the app; CCA treasurers only receive a confirmation email.

---

## User Roles

| Actor | Responsibilities |
|---|---|
| **Finance Director (FD)** | Gmail account used to send claim emails; receives compiled PDF via Telegram |
| **Finance Team Members** | Create and process claims end-to-end |
| **CCA Treasurers** | Receive confirmation email only — do not log in |

---

## Claim Lifecycle

```
draft
  → email_sent            (confirmation email sent to claimer)
  → screenshot_pending    (waiting for finance team to upload email screenshot)
  → screenshot_uploaded   (screenshot attached)
  → docs_generated        (LOA, Summary, RFP, Transport Form generated)
  → compiled              (all docs merged into a single PDF)
  → submitted             (compiled PDF sent to FD via Telegram)
  → reimbursed            (fully processed)
```

Any step can land in `error` with a stored message; the UI shows a retry button.

---

## Tech Stack

### Frontend
- **React 18 + Vite + Tailwind CSS**
- Hosted on **Vercel** (`frontend/vercel.json` has a single SPA rewrite rule)
- Runs inside Telegram as a **Mini App**

### Backend
- **Python 3.11, FastAPI**
- Hosted on **Google Cloud Run** (`asia-southeast1`, 1 GB RAM)
- Auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`)
- Auth: Telegram `initData` HMAC-SHA256 validated on every request; users identified by Telegram ID

### Database
- **Supabase** (PostgreSQL via PostgREST)
- Kept alive by a GitHub Actions weekly cron (Sunday midnight UTC) that pings `/health`

### File Storage — two systems
- **Cloudflare R2** (S3-compatible): receipt images and bank transaction screenshots uploaded from the UI
- **Google Drive** (user OAuth2 refresh token): all generated PDFs, organised into per-claim subfolders named after the reference code

### Document Generation
- **fpdf2**: LOA built programmatically in Python; images embedded directly
- **Google Sheets API**: Summary sheet and Transport Form (placeholder find/replace on templates)
- **Google Docs API**: RFP document (placeholder find/replace on template)
- **pypdf**: merges all generated PDFs into a single compiled document

### Integrations
- **Gmail API** (OAuth2 refresh token): sends emails from the Finance Director's personal Gmail account
- **python-telegram-bot**: webhook handler for bot commands; sends compiled PDF to FD's Telegram chat

---

## Document Generation

For each claim the system generates:

| Document | Method | Description |
|---|---|---|
| **LOA** (Letter of Authorisation) | fpdf2 | MF approval scan (first page, if Master's Fund), receipt images, bank transaction screenshots; claimer authorises FD to collect on their behalf |
| **Summary Sheet** | Google Sheets | Tabulated financial breakdown with line items, GST codes, DR/CR, WBS account, grand total |
| **RFP** (Request for Payment) | Google Docs | Formal payment request document |
| **Transport Form** | Google Sheets | Trip-by-trip breakdown (from/to, purpose, date, distance, amount) — generated only if claim has transport trips |
| **Compiled PDF** | pypdf | All of the above + email screenshot merged in order |

All files are saved to a Google Drive subfolder named after the claim reference code.

---

## Email Flow

1. Finance team clicks **Send Email** on a `draft` claim
2. Backend builds an HTML email:
   - **To**: claimer's email address
   - **Subject**: claim reference code
   - **Body**: claims summary table (CCA, event, amount, PayNow number), itemised receipt list (date in DD/MM/YYYY, company omitted if blank), auto-generated remarks
   - **Auto-remarks** (computed live): Master's Fund flag, partial claim amount, refund breakdowns, receipt/BT counts
   - **Attachments**: all receipt images and bank transaction screenshots from Drive
3. Email sent via Gmail API from FD's account
4. Finance team uploads a screenshot of the sent email back into the system
5. Screenshot is included in the compiled PDF as proof of correspondence

---

## Data Model

```
Portfolio → CCA → Claimer
                     ↓
                  Claim ──→ ClaimLineItems
                     ↓              ↓
                 Receipts ←─────────┘
                     ↓
             BankTransactions → BankTransactionRefunds
                     ↓
             ClaimDocuments (LOA, Summary, RFP, Transport, Screenshot, Compiled)
```

| Entity | Description |
|---|---|
| **Portfolio** | Group of CCAs (e.g. Sports, Arts) |
| **CCA** | Individual club/activity |
| **Claimer** | Treasurer — name, matric number, PayNow phone, email |
| **Claim** | Core object: description, WBS account, total amount, date, remarks, transport flag, partial claim flag |
| **Receipt** | Individual expense line — amount, description, company, date, GST code, DR/CR, receipt image, bank transaction link |
| **BankTransaction** | A bank debit linked to receipts; can have refunds |
| **ClaimDocument** | A generated file — versioned; only `is_current=true` is used per type |

---

## WBS Accounts

| Code | Label | Notes |
|---|---|---|
| SA | Student Account | Default |
| MBH | MBH | — |
| MF | Master's Fund | Requires Master's Fund approval upload; scan inserted as first LOA page |

---

## Frontend Pages

| Page | Path | Purpose |
|---|---|---|
| Home | `/` | Claims list with status badges |
| New Claim | `/claims/new` | Multi-step form: claimer/event info → receipts, bank transactions, transport trips |
| Claim Detail | `/claims/:id` | Full claim view — edit fields, manage receipts/BTs, run pipeline steps |
| Identifier Data | `/identifier-data` | Manage portfolios, CCAs, claimers, finance team members |

---

## Authentication

- Telegram WebApp `initData` validated via HMAC-SHA256 on every API request
- Finance team members identified by Telegram user ID against the `finance_team` table
- No passwords or separate login

---

## Infrastructure

| Component | Hosting | Notes |
|---|---|---|
| Frontend | Vercel | Free tier; SPA rewrite in `vercel.json` |
| Backend | Google Cloud Run | `asia-southeast1`; 1 GB RAM; auto-deploy on push to `main` |
| Database | Supabase | Free tier; kept alive by weekly GitHub Actions cron |
| Images | Cloudflare R2 | Free tier; S3-compatible |
| Documents | Google Drive | User OAuth; per-claim subfolders |
