# Receipt Approval Wizard — Implementation Spec

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-click "Approve & Send Email" button with a step-by-step wizard that walks the finance team through every receipt before approval, ensuring nothing is missed.

**Architecture:** New full-page route `/claims/:id/approve` (`ApprovalWizardPage.jsx`). Pure frontend feature — no new backend endpoints needed. Wizard state is persisted to sessionStorage so progress survives accidental navigation. On final Approve, the page batches PATCH calls to existing receipt endpoints then calls the existing email-send endpoint.

**Tech Stack:** React, TanStack Query, React Router, Tailwind CSS. Reuses `FullscreenImageViewer`, `ViewOnlyThumb` from `ClaimDetailPage.jsx`, and existing API functions from `api/receipts.js`, `api/email.js`.

---

## Data Model

### sessionStorage key: `approval_${claimId}`

```js
{
  step: 0,          // 0..N-1 = receipt index; N = summary screen
  selections: {
    [receiptId]: {
      category: string,          // required before Next is enabled
      gst_code: 'IE' | 'I9' | 'L9',  // default 'IE'
      dr_cr: 'DR' | 'CR',            // default 'DR'
      remark: string                  // optional per-receipt flag note, default ''
    }
  }
}
```

State is written to sessionStorage on every step change (Next/Back) and on every field edit. Cleared on final Approve or Reject.

### Category auto-fill rule

When the finance team picks a category that has already been assigned to an earlier receipt in the same session, `gst_code` and `dr_cr` auto-fill to match that category's existing values (since both fields live on the line item, not the receipt). Fields remain editable.

---

## Screens

### A. Per-receipt screen (step 0 … N-1)

**Header row:**
- Left: back arrow (disabled on step 0)
- Centre: `Receipt X of Y`
- Right: "Reject Claim" button (red/destructive)

**Receipt images** — full-width, stacked vertically. Tap any image to open `FullscreenImageViewer`. Multiple images shown in order.

**Receipt info block:**
- Description, company, receipt no., date, amount (read-only display)

**Linked bank transaction block** (hidden if no BT linked to this receipt):
- BT gross amount
- Each refund: amount + view screenshot button
- Net: `$gross − $refund1 − ... = $net`

**Finance fields (all required; Next disabled until all three filled):**
- **Category** — text input with datalist suggestions from categories already used in this session + existing line items on the claim
- **GST code** — segmented control: `IE` / `I9` / `L9` (default `IE`)
- **DR/CR** — segmented control: `DR` / `CR` (default `DR`)

**Flag this receipt (optional):**
- Single-line text input labelled "Flag note (optional)"
- If filled, receipt is marked as flagged; note accumulates into rejection remarks

**Footer:**
- Left: `← Back`
- Right: `Next →` (disabled until category, gst_code, dr_cr all set)

---

### B. Rejection modal (accessible from any screen)

Triggered by "Reject Claim" button on any screen.

- Textarea pre-filled by concatenating all non-empty per-receipt remarks:
  ```
  Receipt 2 — <remark text>
  Receipt 4 — <remark text>
  ```
- Finance team can edit/append before confirming.
- On confirm: calls existing `POST /claims/:id/reject-review` with the remarks text, clears sessionStorage, navigates back to claim detail.
- Remarks textarea is required (cannot confirm with empty text).

---

### C. Summary screen (step N)

**Header row:**
- Left: `← Back` (goes to last receipt)
- Centre: "Review Summary"
- Right: "Reject Claim" button (red/destructive)

**Flagged receipts banner** (amber, shown only if any receipt has a non-empty remark):
- Lists each flagged receipt: `Receipt X — <note>`
- Prompts: "Resolve these issues by rejecting, or clear the notes before approving."

**Receipts grouped by line item:**
For each category group (sorted by category name):
- Category heading + GST code + DR/CR badge
- Each receipt row: description · date · amount
- Line item subtotal

**Bank transactions section:**
For each BT on the claim:
- Gross amount
- Each refund: `− $amount`
- Net amount

**Reconciliation row:**
- "Total receipts: $X.XX"
- "Total net bank transactions: $Y.YY"
- Green ✓ if amounts match (within $0.01 rounding tolerance)
- Amber ⚠ "Amounts do not match — please verify before approving" if they differ
- Mismatch does NOT block approval; it is advisory only.

**Footer:**
- Left: `← Back`
- Right: `Approve & Send Email` (blue, always enabled)

**On Approve (sequential):**
1. For each receipt, call `PATCH /receipts/:id` with `{ category, gst_code, dr_cr }` — existing backend assigns receipt to the correct line item (creating one if needed) and updates gst_code/dr_cr on the line item.
2. Call `POST /email/send/:claimId` (existing endpoint).
3. Clear `approval_${claimId}` from sessionStorage.
4. Navigate to `/claims/:id`.

---

## Entry Point

In `ClaimDetailPage.jsx`, inside `ReviewPanel`, replace the current "Approve & Send Email" button with **"Start Approval Process"** (navigates to `/claims/:id/approve`). The existing "Reject" button remains for cases where the finance team wants to reject without going through the wizard.

---

## Routing

Add route in `App.jsx`:
```jsx
<Route path="claims/:id/approve" element={<ApprovalWizardPage />} />
```
Accessible only to finance team (director or member role) — redirect to `/` otherwise.

---

## File Changes

| Action | File |
|--------|------|
| Create | `frontend/src/pages/ApprovalWizardPage.jsx` |
| Modify | `frontend/src/App.jsx` — add route |
| Modify | `frontend/src/pages/ClaimDetailPage.jsx` — swap button in ReviewPanel |

No backend changes required.

---

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| sessionStorage draft | Pure client state; save-on-each-Next | Survives accidental navigation without partial DB writes |
| No new backend endpoints | New `/approve` endpoint | Existing PATCH /receipts + POST /email/send cover all needs |
| Rejection modal pre-fills from per-receipt remarks | Separate rejection-remarks flow | One-shot send of all issues at end; finance team flags as they go |
| Mismatch warning advisory only | Block approval on mismatch | BT amounts may legitimately differ (partial claims, cross-claim BTs) |
| Category auto-fills gst_code/dr_cr | Always start blank | gst_code/dr_cr live on line item — same category must share them |
