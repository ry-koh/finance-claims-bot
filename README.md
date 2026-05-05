# Finance Claims Bot

## Overview

Finance Claims Bot is an internal claims management system built for the **Raffles Hall finance team** to process CCA reimbursement claims on behalf of treasurers. The system is designed as a **Telegram Mini App**, allowing finance team members to manage the full lifecycle of claims within Telegram.

Treasurers do not interact with the system directly — they only receive confirmation emails.

---

## Key Features

* End-to-end claim processing workflow
* Automated document generation (LOA, Summary, RFP, Transport Form)
* One-click compilation into a single PDF
* Gmail integration for sending claim emails
* Telegram bot integration for final submission
* Google Drive storage for all generated documents
* Structured data model for claims, receipts, and transactions

---

## User Roles

| Actor                     | Responsibilities                               |
| ------------------------- | ---------------------------------------------- |
| **Finance Director (FD)** | Signs off on claims and sends emails via Gmail |
| **Finance Team Members**  | Create and process claims using the system     |
| **CCA Treasurers**        | Receive confirmation emails only               |

---

## Claim Lifecycle

Each claim progresses through the following states:

```
draft
 → email_sent
 → screenshot_uploaded
 → docs_generated
 → compiled
 → submitted
 → reimbursed
```

* Each step can fail with an error message
* Retry mechanisms are available in the UI

---

## System Architecture

### Frontend

* React 18 + Vite + Tailwind CSS
* Hosted on Vercel
* Runs inside Telegram as a Mini App

### Backend

* Python 3.11 + FastAPI
* Hosted on Google Cloud Run (512 MB free tier)
* Stateless API with Telegram-based authentication

### Database

* PostgreSQL (Supabase)
* Accessed via PostgREST
* Kept alive via GitHub Actions cron job

### Storage

* **Cloudflare R2**: Receipt & bank transaction images
* **Google Drive**: Generated documents (per-claim folders)

### Integrations

* Gmail API (email sending)
* Google Docs & Sheets API (document generation)
* Telegram Bot API (submission & UI host)

---

## Document Generation

For each claim, the system generates:

| Document                      | Method        | Description                                             |
| ----------------------------- | ------------- | ------------------------------------------------------- |
| LOA (Letter of Authorisation) | fpdf2         | Includes receipts, bank transactions, and approval docs |
| Summary Sheet                 | Google Sheets | Tabulated financial breakdown                           |
| RFP (Request for Payment)     | Google Docs   | Formal payment request                                  |
| Transport Form                | Google Sheets | Trip-level breakdown (if applicable)                    |
| Compiled PDF                  | pypdf         | Merged final submission document                        |

All documents are stored in a Google Drive folder named after the claim reference code.

---

## Email Flow

1. Finance team triggers email send
2. System generates HTML email with:

   * Claim summary
   * Receipt breakdown
   * Auto-generated remarks
3. Attachments included:

   * Receipt images
   * Bank transaction screenshots
4. Email sent via Gmail API (FD account)
5. Screenshot of sent email uploaded back into system
6. Screenshot included in final compiled PDF

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
            ClaimDocuments
```

### Key Entities

* **Portfolio**: Group of CCAs (e.g. Sports, Arts)
* **CCA**: Individual club/activity
* **Claimer**: Treasurer details (name, matric, PayNow, email)
* **Claim**: Core object with metadata and totals
* **Receipt**: Individual expense entry
* **BankTransaction**: Linked payment record
* **ClaimDocument**: Generated files (versioned)

---

## WBS Accounts

| Code | Label           | Notes                                        |
| ---- | --------------- | -------------------------------------------- |
| SA   | Student Account | Default                                      |
| MBH  | MBH             | —                                            |
| MF   | Master's Fund   | Requires approval document (included in LOA) |

---

## API Endpoints (Core)

### Generate Documents

```
POST /documents/generate/{claim_id}
```

### Compile Documents

```
POST /documents/compile/{claim_id}
```

### Send to Telegram

```
POST /documents/send_telegram/{claim_id}
```

---

## Frontend Pages

| Page            | Path             | Purpose                           |
| --------------- | ---------------- | --------------------------------- |
| Home            | /                | List all claims                   |
| New Claim       | /claims/new      | Create a new claim                |
| Claim Detail    | /claims/:id      | View and process a claim          |
| Identifier Data | /identifier-data | Manage portfolios, CCAs, claimers |

---

## Authentication

* Uses Telegram WebApp `initData`
* Verified using HMAC-SHA256 with bot token
* Users identified via Telegram user ID
* No passwords required

---

## Infrastructure Notes

* Cloud Run free tier (512 MB RAM)
* Supabase pauses after inactivity → kept alive via cron

---

## Deployment

### Frontend (Vercel)

* SPA rewrite configured in `vercel.json`

### Backend (Cloud Run)

* Containerized FastAPI service
* Webhook endpoint for Telegram bot

---

## Summary

Finance Claims Bot streamlines the entire reimbursement workflow for Raffles Hall finance operations, reducing manual effort, ensuring consistency in documentation, and centralising all claim data and outputs in a single system.
