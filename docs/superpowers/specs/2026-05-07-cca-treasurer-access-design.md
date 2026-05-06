# CCA Treasurer Access — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Overview

Expand the Finance Claims Mini App to CCA treasurers, giving them a scoped interface to submit and track their own reimbursement claims. The finance team reviews treasurer submissions before proceeding with the existing pipeline.

---

## Understanding Summary

- **What**: Add a `treasurer` role with registration, scoped claim creation, submit-for-review workflow, and director-gated onboarding for both treasurers and new finance members
- **Why**: CCA treasurers currently cannot self-service their submissions; finance team does all data entry on their behalf
- **Who**: CCA treasurers (new), finance members (existing, now go through pending approval), finance director (existing, approves registrations)
- **Key constraints**: Treasurer = claimer (they are the one being reimbursed); many-to-many treasurer ↔ CCA relationship; no MBH WBS option for treasurers; category/GST/DR-CR/remarks are finance-team-only fields
- **Non-goals**: Director analytics/CCA expense breakdown (future — nav entry reserved as "Coming soon"), Telegram bot notifications for pending approvals

---

## Decision Log

| Decision | Alternatives considered | Reason chosen |
|---|---|---|
| Extend `finance_team` table with `treasurer` role | Separate `treasurers` table; reuse `claimers` table | Single auth path, minimal schema changes |
| Explicit "Submit for Review" step (PENDING_REVIEW) | Always visible to finance; visible with "ready" flag | Least cognitive load for finance team; clear order |
| `rejection_comment` column separate from `error_message` | Reuse `error_message` | `error_message` is for system pipeline errors — semantically distinct |
| Flat claim list for treasurers (status badge on card) | Tabs like finance team view | Treasurers have fewer claims; status badge is sufficient |
| Director approves both treasurer and member registrations | Auto-approve members | Maintains control over who has finance team access |
| Finance member email must be `@u.nus.edu` | Optional or any email | Finance team accesses shared Gmail for email screenshots; NUS email ties identity to the institution |
| Email body instructs treasurer to CC `68findirector.rh@gmail.com` | System auto-CC's that address | Finance team needs to find the treasurer's reply in the shared inbox to screenshot it |

---

## Roles & Permissions

| Action | Treasurer | Finance Member | Finance Director |
|---|---|---|---|
| Register (pending state) | ✓ | ✓ | — |
| Edit pending registration | ✓ | ✓ | — |
| Approve / reject registrations | — | — | ✓ |
| Create claim (own CCA only) | ✓ | ✓ (any CCA) | ✓ |
| Fill description / amount / date / company / WBS / images | ✓ | ✓ | ✓ |
| Fill category / GST / DR-CR / remarks | — | ✓ | ✓ |
| Select MBH as WBS account | — | ✓ | ✓ |
| Submit claim for review | ✓ | — | — |
| View claims | Own only | All | All |
| Approve PENDING_REVIEW (send email) | — | ✓ | ✓ |
| Reject PENDING_REVIEW with comment | — | ✓ | ✓ |
| Preview and re-crop attachments | — | ✓ | ✓ |
| Rest of pipeline (screenshot, docs, compile, submit) | — | ✓ | ✓ |

---

## Data Model Changes

### `finance_team` table
- Add `status text NOT NULL DEFAULT 'active'` — values: `'active'` | `'pending'`; all existing records default to `'active'`
- Add `email text` — required for all new registrations; must match `@u.nus.edu` for finance members
- `role` enum gains `'treasurer'` value

### New `treasurer_ccas` junction table
```sql
CREATE TABLE treasurer_ccas (
  finance_team_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  cca_id          uuid NOT NULL REFERENCES ccas(id)         ON DELETE CASCADE,
  PRIMARY KEY (finance_team_id, cca_id)
);
```

### `claims` table
- Add `rejection_comment text` — nullable; set when finance team rejects a PENDING_REVIEW claim; cleared when claim is resubmitted

### `ClaimStatus` enum
New value `pending_review` inserted between `draft` and `email_sent`:
```
draft → pending_review → email_sent → screenshot_pending →
screenshot_uploaded → docs_generated → compiled → submitted → reimbursed
(+ error for system failures)
```

Finance-created claims skip `pending_review` (go DRAFT → EMAIL_SENT directly).

### WBS account restriction
- **Backend**: reject `MBH` if the claim's `filled_by` is a treasurer
- **Frontend**: filter WBS options to `['SA', 'MF']` when the logged-in user is a treasurer

---

## Registration & Auth Flow

### First-time open — three states
The backend checks `finance_team` for the Telegram ID and the frontend routes accordingly:

| Backend response | Frontend screen |
|---|---|
| Telegram ID not found | RegistrationPage |
| `status = 'pending'` | PendingApprovalPage |
| `status = 'active'` | Normal app (role-aware) |

### RegistrationPage
1. User picks role: **CCA Treasurer** or **Finance Team Member**
2. Treasurer: name, email (required), CCA(s) selected from existing list
3. Finance member: name (required), email (required, validated `@u.nus.edu`)
4. Submit → `finance_team` record created with `status = 'pending'`; `treasurer_ccas` rows inserted for treasurers
5. User lands on PendingApprovalPage

### PendingApprovalPage
- Shows submitted details ("Your registration is awaiting director approval")
- **"Edit Registration"** button — user can amend name, email, or CCA selection; updates the pending record in place (no re-submission flow needed)

### Director approval
- Badge on director's homepage showing count of pending requests
- Approval screen shows: name, requested role, CCA(s) (treasurers only), email
- **Approve** → `status = 'active'`; for treasurers: auto-create one `Claimer` record per CCA (name + email from registration) so the claim pipeline has a claimer to attach to
- **Reject** → record deleted

### Auth middleware
- `require_auth()` returns `401 unregistered` if Telegram ID absent, `403 pending` if status is pending — frontend intercepts both to route to the correct screen
- New `require_finance_team()` — wraps `require_auth()`, rejects role `treasurer` with 403 — applied to category/GST/DR-CR edits, email send, doc generation, and all downstream pipeline endpoints
- `require_director()` — unchanged

---

## Claim Workflow

### Status machine
```
DRAFT
  ↓  (treasurer submits)
PENDING_REVIEW
  ↓  (finance approves)          ← or → DRAFT (finance rejects with comment)
EMAIL_SENT
  ↓
SCREENSHOT_PENDING
  ↓
SCREENSHOT_UPLOADED
  ↓
DOCS_GENERATED
  ↓
COMPILED
  ↓
SUBMITTED
  ↓
REIMBURSED
```

### Treasurer claim creation form

**Step 1 — Who:**
- Auto-filled with the treasurer's own claimer record
- If linked to multiple CCAs, a CCA picker appears (selects which `Claimer` record to use)

**Step 2 — What:**
- Description, date, WBS (SA / MF only — MBH hidden)
- No remarks field

**Step 3 — Transactions:**
- Receipts: description, amount, date, company, images
- Category / GST / DR-CR fields hidden
- Bank transactions: unchanged

### DRAFT state (treasurer)
- Treasurer can edit freely
- If previously rejected, a warning banner shows the `rejection_comment` with an "Edit & Resubmit" prompt
- **"Submit for Review"** button → claim moves to PENDING_REVIEW, becomes read-only for the treasurer; `rejection_comment` cleared

### PENDING_REVIEW state (finance team)
Finance team review panel:
- All attachments (receipt images, BT images) shown in a grid with **Preview** and **Re-crop** per image
- Re-crop opens `ImageCropModal` with the stored R2 image as `src` — on confirm, replaces the image in R2 and updates the drive ID
- Category / GST / DR-CR inputs per receipt
- Remarks field
- **"Approve & Send Email"** → email sent to treasurer's email address; body instructs them to reply CC'ing `68findirector.rh@gmail.com` so the finance team can find the reply in the shared inbox; claim moves to EMAIL_SENT
- **"Reject"** → comment modal → `rejection_comment` saved, claim moves back to DRAFT

### EMAIL_SENT onwards
Unchanged from today. Finance team logs into `68findirector.rh@gmail.com`, screenshots the treasurer's reply, and uploads it to the claim.

### Finance-created claims
Finance team fills all fields (including category/GST/DR-CR/remarks) and goes DRAFT → EMAIL_SENT directly. PENDING_REVIEW is skipped.

---

## Frontend Structure

### Screen inventory

| Screen | Who sees it |
|---|---|
| RegistrationPage | Unregistered Telegram users |
| PendingApprovalPage (with edit) | Pending users (any role) |
| Treasurer home — flat claim list, status badges | Treasurers |
| Treasurer new claim form (simplified) | Treasurers |
| Finance home — tabbed list, PENDING_REVIEW tab added | Finance members + director |
| Finance claim detail — review panel in PENDING_REVIEW | Finance members + director |
| Pending registrations approval screen | Director only |
| "Analytics" nav entry — "Coming soon" placeholder | Director only |

### Key UI details

**Treasurer claims list:**
- Flat scrollable list, no status tabs
- Each card shows: claim description, date, amount, CCA, and `Status: [human-readable label]`
- Rejected DRAFT claims show a red "Action required" indicator

**Finance review panel (PENDING_REVIEW only):**
- Attachment grid with Preview + Re-crop per image
- Receipt rows with category/GST/DR-CR inline inputs
- Remarks textarea
- Approve and Reject action buttons at the bottom

**Rejection comment banner:**
- Shown on DRAFT claims where `rejection_comment` is set
- Warning style, displays the comment text, "Edit & Resubmit" CTA

**Pending registrations:**
- Badge count on director's homepage
- Approval screen: name, role label, CCA list (treasurers), email — Approve / Reject per entry

---

## Critical Constraint — Preserve All Existing Features

**IMPORTANT: No existing feature, endpoint, UI component, or workflow step may be removed or altered in a breaking way.** All changes are purely additive:

- The existing finance team claim creation flow (all fields, all WBS options, direct DRAFT → EMAIL_SENT) must remain exactly as-is
- All existing status transitions, bulk actions, document generation, compilation, and submission steps are unchanged
- All existing API endpoints retain their current behaviour — new role checks are added without removing existing functionality
- The finance team's full claim detail page (receipts, bank transactions, line items, document uploads) is untouched except for the new PENDING_REVIEW review panel being added to it
- Any DB migration must be backwards-compatible (additive columns with defaults, new tables only — no column removals or type changes)

---

## Out of Scope

- **Director analytics** (CCA expense breakdown by fund) — future feature; Analytics nav entry reserved as "Coming soon" with no logic
- **Telegram bot notifications** for pending approvals — director checks the app
- **Treasurer-to-finance messaging** beyond the structured rejection comment
