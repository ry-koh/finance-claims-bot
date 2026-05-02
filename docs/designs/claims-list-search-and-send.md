# Design: Claims List Search, Multi-Select, and Telegram Send

## Understanding Summary

- **Claims list search** — text search filtering by reference code, CCA name, and portfolio; date range filter on `created_at`; fetch limit raised to 500 for full client-side coverage
- **Multi-select mode** — toggle on the claims list that shows checkboxes; floating bottom bar with two independent actions
- **"Send to Telegram"** — sends each selected claim's compiled PDF to the currently logged-in user's own Telegram DM; no recipient picker
- **"Mark as Submitted"** — bulk-updates all selected claims' status to `submitted`
- **Download button** — on the claim detail page, opens the compiled PDF via signed R2 URL in a new tab
- Recipients are only the logged-in user (identified by their `telegram_id` in `finance_team`)
- Sending is independent of the claim status pipeline
- Claims without a compiled PDF are silently skipped during send (result summary shown)

## Assumptions

- Finance team member must have a `telegram_id` set; if not, "Send to Telegram" shows an error
- Fetch limit raised from 50 → 500 (client-side filtering is sufficient at this scale)
- Date range filter uses `created_at`, not the claim `date` field
- Multi-select works for all claim statuses (both Send and Mark Submitted)
- "Send to Telegram" sends one message per claim (not one combined message)
- The bot must have already started a conversation with the user (Telegram requires this)

## Decision Log

| Decision | Alternatives Considered | Reason |
|---|---|---|
| Client-side search with 500 fetch limit | Server-side search | Simpler, sufficient for hundreds of claims |
| Send to self only (no recipient picker) | Multi-select recipients, single recipient from team list | Simplest flow; the person submitting always wants it for themselves |
| Two separate buttons (Send + Mark Submitted) | Single combined action | Actions are independent; user may want one without the other |
| Multi-select toggle on existing list | Separate submissions page | Avoids duplicate UI; YAGNI |
| Silently skip non-compiled claims on send | Block send if any selected claim is not compiled | Less friction; user sees a result summary after |

---

## Final Design

### 1. Claims List — Search & Filter

**Fetch limit:** `page_size` raised to 500 in the `useClaims` call for the broad "All" fetch.

**Search bar:** Single text input above the status tabs. Filters the in-memory list matching any of:
- `reference_code` (case-insensitive substring)
- `claimer.cca.name` (case-insensitive substring)
- `claimer.cca.portfolio.name` (case-insensitive substring)

**Date range:** A collapsible "Filter" row below the search bar with two date inputs (From / To). Filters on `created_at`. Both are optional independently.

**Interaction:** Search and date filters stack with the existing status tab filter. Clearing the search input and both date fields shows the full (status-filtered) list.

---

### 2. Multi-Select Mode

**Activation:** A "Select" button (or checkbox icon) in the top-right of the header. Tapping it:
- Hides the status tab row
- Shows a checkbox on each claim card
- Shows a floating bottom bar: `N selected · [Send to Telegram] [Mark Submitted]`

**Deactivation:** "Cancel" button replaces "Select" in the header. Clears all selections.

**Card behaviour:** Tapping a card in select mode toggles its checkbox (does not navigate). A "Select All" option appears in the header when multi-select is active.

**Floating bar:**
- Stays above any bottom padding/safe area
- Both buttons are always visible; "Send to Telegram" is disabled (greyed) if 0 claims selected
- Button labels show count: `Send (3)` / `Mark Submitted (3)`

---

### 3. Send to Telegram

**Flow:**
1. User taps "Send to Telegram"
2. Confirmation dialog: "Send N compiled PDFs to yourself on Telegram?"
3. On confirm → `POST /documents/send-telegram` with `{ claim_ids: [...] }`
4. Backend skips non-compiled claims, sends compiled PDF for each to the user's `telegram_id`
5. Result toast: "Sent 3 PDFs · 1 skipped (not compiled)"

**Error:** If the logged-in user has no `telegram_id`, show: "Your account has no Telegram ID linked. Ask the Finance Director to update your profile."

---

### 4. Mark as Submitted

**Flow:**
1. User taps "Mark Submitted"
2. Confirmation dialog: "Mark N claims as submitted?"
3. On confirm → `PATCH /claims/bulk` with `{ claim_ids: [...], status: "submitted" }`
4. Claim list refreshes; multi-select mode exits

---

### 5. Download Button (Claim Detail Page)

On `ClaimDetailPage`, if `claim.documents` contains a doc with `type === "compiled"`:
- Show a "Download PDF" button in the documents section
- Tapping it opens `imageUrl(doc.drive_file_id)` in a new tab (uses existing signed URL flow)

---

## Backend Changes

### `POST /documents/send-telegram`
- Auth: `require_auth`
- Body: `{ claim_ids: list[str] }`
- Looks up the logged-in user's `telegram_id` from `finance_team` via their auth token
- For each `claim_id`: fetches the current compiled document from `claim_documents`; downloads from R2; sends via `bot.send_document(chat_id=telegram_id, document=bytes, filename=...)`
- Returns: `{ sent: int, skipped: int, skipped_ids: list[str] }`

### `PATCH /claims/bulk`
- Auth: `require_auth`
- Body: `{ claim_ids: list[str], status: str }`
- Validates status is a known value
- Bulk-updates all matching claims
- Returns: `{ updated: int }`

## Frontend Changes

### `HomePage.jsx`
- Raise fetch limit to 500
- Add search bar + collapsible date range filter
- Add multi-select toggle, checkbox rendering, floating action bar
- Wire "Send to Telegram" and "Mark Submitted" to new API hooks

### `ClaimDetailPage.jsx`
- Add "Download PDF" button when compiled document exists

### `api/documents.js`
- Add `sendToTelegram({ claim_ids })` → `POST /documents/send-telegram`

### `api/claims.js`
- Add `bulkUpdateStatus({ claim_ids, status })` → `PATCH /claims/bulk`
