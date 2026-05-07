# Receipt Approval Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-click approval in the review panel with a full-page step-by-step wizard that walks finance team through every receipt, letting them assign category/GST/DR-CR per receipt, flag issues, and reconcile against bank transactions before approving.

**Architecture:** Single new page `ApprovalWizardPage.jsx` at route `/claims/:id/approve`. Wizard state lives in sessionStorage (key `approval_${claimId}`) and is written on every field change. On final Approve, the page batches PATCH calls to the existing receipt endpoint then calls the existing email-send endpoint. No backend changes needed.

**Tech Stack:** React 18, React Router v6, TanStack Query v5, Tailwind CSS. Reuses `FullscreenImageViewer` and `ViewOnlyThumb` components copied from `ClaimDetailPage.jsx`, and raw API functions `updateReceipt` from `api/receipts.js` and `sendEmail` from `api/email.js`, and `rejectReview` from `api/claims.js`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/pages/ApprovalWizardPage.jsx` | Entire wizard: state, per-receipt screen, summary screen, rejection modal |
| Modify | `frontend/src/App.jsx` | Add `/claims/:id/approve` route (finance team only) |
| Modify | `frontend/src/pages/ClaimDetailPage.jsx` | Replace "Approve & Send Email" with "Start Approval Process" button in `ReviewPanel` |

---

## Background for the implementer

### Data shapes you will use from `useClaim(id).data`

```js
claim = {
  id: string,
  receipts: [
    {
      id: string,
      description: string,
      company: string,
      receipt_no: string,
      date: string,          // "YYYY-MM-DD"
      amount: number,
      line_item_id: string | null,
      bank_transaction_id: string | null,
      images: [{ drive_file_id: string }],
    }
  ],
  bank_transactions: [
    {
      id: string,
      amount: number,
      images: [{ drive_file_id: string }],
      refunds: [{ id: string, amount: number, drive_file_id: string | null }],
    }
  ],
  line_items: [
    {
      id: string,
      category: string,
      gst_code: 'IE' | 'I9' | 'L9',
      dr_cr: 'DR' | 'CR',
      total_amount: number,
    }
  ],
}
```

### Utility functions to copy-paste from ClaimDetailPage.jsx

```js
function imageUrl(gcsPath) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(gcsPath)}`
}

function formatAmount(amount) {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
```

### sessionStorage state shape

```js
// key: `approval_${claimId}`
{
  step: 0,           // 0..N-1 = receipt index; N = summary
  selections: {
    [receiptId]: {
      category: string,          // required; '' = not yet set
      gst_code: 'IE' | 'I9' | 'L9',
      dr_cr: 'DR' | 'CR',
      remark: string             // '' = not flagged
    }
  }
}
```

### API calls you will use (raw functions, NOT hooks — to call imperatively on approve)

```js
// from api/receipts.js
import { updateReceipt } from '../api/receipts'
// updateReceipt({ id, category, gst_code, dr_cr, confirm_category_change: true })

// from api/email.js
import { sendEmail } from '../api/email'
// sendEmail(claimId)

// from api/claims.js
import { rejectReview } from '../api/claims'
// rejectReview({ claimId: id, comment: string })
```

---

## Task 1: Route and shell page

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `frontend/src/pages/ApprovalWizardPage.jsx`

- [ ] **Step 1: Add the route in App.jsx**

In `App.jsx`, inside the non-treasurer routes block (after `<Route path="claims/:id" ...>`), add:

```jsx
import ApprovalWizardPage from './pages/ApprovalWizardPage'
// ...
<Route path="claims/:id/approve" element={<ApprovalWizardPage />} />
```

The full non-treasurer block should look like:

```jsx
) : (
  <>
    <Route index element={<HomePage />} />
    <Route path="claims/new" element={<NewClaimPage />} />
    <Route path="claims/:id" element={<ClaimDetailPage />} />
    <Route path="claims/:id/approve" element={<ApprovalWizardPage />} />
    <Route path="identifiers" element={<IdentifierDataPage />} />
    {isDirector && (
      <>
        <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
      </>
    )}
  </>
)}
```

- [ ] **Step 2: Create shell ApprovalWizardPage.jsx**

```jsx
import { useParams, useNavigate } from 'react-router-dom'
import { useClaim } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'

export default function ApprovalWizardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: claim, isLoading } = useClaim(id)

  if (!isFinanceTeam) {
    navigate('/', { replace: true })
    return null
  }

  if (isLoading || !claim) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <p className="p-4 text-sm text-gray-500">Approval wizard — {claim.reference_code}</p>
    </div>
  )
}
```

- [ ] **Step 3: Verify route works**

Run the dev server (`npm run dev` in `frontend/`), navigate to a claim in `pending_review` status, manually go to `/claims/<id>/approve` in the URL. Confirm you see "Approval wizard — <ref code>" without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/ApprovalWizardPage.jsx
git commit -m "feat: add approval wizard route and shell page"
```

---

## Task 2: Wizard state management

**Files:**
- Modify: `frontend/src/pages/ApprovalWizardPage.jsx`

- [ ] **Step 1: Add state initializer and sessionStorage helpers**

Add these functions at the top of the file (before the component):

```js
const STORAGE_KEY = (claimId) => `approval_${claimId}`

function initSelections(claim) {
  const lineItemMap = Object.fromEntries(
    (claim.line_items ?? []).map((li) => [li.id, li])
  )
  const selections = {}
  for (const r of claim.receipts ?? []) {
    const li = r.line_item_id ? lineItemMap[r.line_item_id] : null
    selections[r.id] = {
      category: li?.category ?? '',
      gst_code: li?.gst_code ?? 'IE',
      dr_cr: li?.dr_cr ?? 'DR',
      remark: '',
    }
  }
  return selections
}

function loadDraft(claimId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(claimId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(claimId, state) {
  try {
    sessionStorage.setItem(STORAGE_KEY(claimId), JSON.stringify(state))
  } catch {}
}

function clearDraft(claimId) {
  sessionStorage.removeItem(STORAGE_KEY(claimId))
}
```

- [ ] **Step 2: Wire state into the component**

Replace the component body with state initialization:

```jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useClaim } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'

// ... (paste helpers from step 1 above)

export default function ApprovalWizardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: claim, isLoading } = useClaim(id)

  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState({})
  const [initialized, setInitialized] = useState(false)

  // Restore or init draft once claim loads
  useEffect(() => {
    if (!claim || initialized) return
    const draft = loadDraft(id)
    if (draft) {
      setStep(draft.step)
      setSelections(draft.selections)
    } else {
      setSelections(initSelections(claim))
    }
    setInitialized(true)
  }, [claim, id, initialized])

  // Persist on every change
  useEffect(() => {
    if (!initialized) return
    saveDraft(id, { step, selections })
  }, [step, selections, id, initialized])

  function updateSelection(receiptId, patch) {
    setSelections((prev) => ({
      ...prev,
      [receiptId]: { ...prev[receiptId], ...patch },
    }))
  }

  if (!isFinanceTeam) {
    navigate('/', { replace: true })
    return null
  }

  if (isLoading || !claim || !initialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const receipts = claim.receipts ?? []
  const bankTransactions = claim.bank_transactions ?? []
  const totalSteps = receipts.length  // step N = summary

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <p className="p-4 text-sm text-gray-500">
        Step {step} of {totalSteps} — {claim.reference_code}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Verify sessionStorage persists**

Open the wizard, open browser DevTools → Application → Session Storage. Confirm `approval_<id>` appears and updates. Navigate away and back — confirm step is restored.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ApprovalWizardPage.jsx
git commit -m "feat: approval wizard sessionStorage state management"
```

---

## Task 3: Per-receipt screen

**Files:**
- Modify: `frontend/src/pages/ApprovalWizardPage.jsx`

- [ ] **Step 1: Add shared utility functions and components inside the file**

Add these before the default export:

```jsx
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'

function imageUrl(gcsPath) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(gcsPath)}`
}
function formatAmount(v) {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}
function formatDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function FullscreenImageViewer({ src, onClose }) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black" onClick={onClose}>
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onClose} className="text-white/70 text-sm font-medium px-2 py-1 active:text-white">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Attachment" className="max-w-full max-h-full object-contain rounded" />
      </div>
    </div>,
    document.body
  )
}

function FullWidthImage({ src, label }) {
  const [viewing, setViewing] = useState(false)
  return (
    <>
      {viewing && <FullscreenImageViewer src={src} onClose={() => setViewing(false)} />}
      <button
        type="button"
        onClick={() => setViewing(true)}
        className="w-full rounded-xl overflow-hidden bg-gray-200 active:opacity-75"
      >
        <img src={src} alt={label} className="w-full object-contain max-h-64" />
      </button>
    </>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-300">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
            value === opt
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 active:bg-gray-100'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add the ReceiptStep component**

```jsx
function ReceiptStep({ receipt, selection, allSelections, bankTransactions, stepNum, totalSteps, onUpdate, onNext, onBack, onReject }) {
  // Find linked bank transaction
  const bt = bankTransactions.find((b) => b.id === receipt.bank_transaction_id) ?? null
  const btNet = bt
    ? bt.amount - (bt.refunds ?? []).reduce((s, r) => s + Number(r.amount), 0)
    : null

  // Category auto-fill: when user picks a category used by a previous receipt, copy gst_code + dr_cr
  function handleCategoryChange(cat) {
    const entries = Object.entries(allSelections)
    const myIdx = entries.findIndex(([rid]) => rid === receipt.id)
    const match = entries.slice(0, myIdx).find(([, s]) => s.category === cat)
    if (match) {
      onUpdate({ category: cat, gst_code: match[1].gst_code, dr_cr: match[1].dr_cr })
    } else {
      onUpdate({ category: cat })
    }
  }

  const canNext = selection.category.trim() !== ''

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        <button
          type="button"
          onClick={onBack}
          className="text-blue-600 text-sm font-medium px-1 py-1 active:text-blue-800"
        >
          ← Back
        </button>
        <span className="text-sm font-semibold text-gray-800">
          Receipt {stepNum} of {totalSteps}
        </span>
        <button
          type="button"
          onClick={onReject}
          className="text-red-600 text-sm font-medium px-1 py-1 active:text-red-800"
        >
          Reject
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-24">
        {/* Receipt images */}
        {(receipt.images ?? []).length > 0 && (
          <div className="flex flex-col gap-2">
            {receipt.images.map((img) => (
              <FullWidthImage key={img.drive_file_id} src={imageUrl(img.drive_file_id)} label={receipt.description} />
            ))}
          </div>
        )}

        {/* Receipt info */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Receipt Info</p>
          <InfoRow label="Description" value={receipt.description} />
          <InfoRow label="Company" value={receipt.company} />
          <InfoRow label="Receipt No." value={receipt.receipt_no} />
          <InfoRow label="Date" value={formatDate(receipt.date)} />
          <InfoRow label="Amount" value={formatAmount(receipt.amount)} bold />
        </div>

        {/* Bank transaction block */}
        {bt && (
          <div className="bg-white rounded-xl border border-blue-100 p-4 flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Bank Transaction</p>
            <InfoRow label="Gross" value={formatAmount(bt.amount)} />
            {(bt.refunds ?? []).map((ref, i) => (
              <InfoRow key={ref.id ?? i} label={`Refund ${i + 1}`} value={`− ${formatAmount(ref.amount)}`} />
            ))}
            <div className="border-t border-gray-100 pt-1.5 mt-0.5">
              <InfoRow label="Net" value={formatAmount(btNet)} bold />
            </div>
          </div>
        )}

        {/* Finance fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Finance Fields</p>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <input
              list={`cat-list-${receipt.id}`}
              value={selection.category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              placeholder="Select or type category…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <datalist id={`cat-list-${receipt.id}`}>
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">GST Code</label>
            <SegmentedControl
              options={GST_CODES}
              value={selection.gst_code}
              onChange={(v) => onUpdate({ gst_code: v })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">DR / CR</label>
            <SegmentedControl
              options={DR_CR_OPTIONS}
              value={selection.dr_cr}
              onChange={(v) => onUpdate({ dr_cr: v })}
            />
          </div>
        </div>

        {/* Flag note */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-xs font-medium text-gray-700 mb-1">Flag note (optional)</label>
          <input
            type="text"
            value={selection.remark}
            onChange={(e) => onUpdate({ remark: e.target.value })}
            placeholder="e.g. Amount doesn't match BT"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 active:bg-gray-100"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 active:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function InfoRow({ label, value, bold = false }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{value || '—'}</span>
    </div>
  )
}
```

- [ ] **Step 3: Wire ReceiptStep into the main component**

Replace the return statement in `ApprovalWizardPage` with:

```jsx
const receipts = claim.receipts ?? []
const bankTransactions = claim.bank_transactions ?? []
const totalSteps = receipts.length

function handleNext() {
  setStep((s) => s + 1)
}
function handleBack() {
  if (step === 0) {
    navigate(`/claims/${id}`)
  } else {
    setStep((s) => s - 1)
  }
}

if (step < totalSteps) {
  const receipt = receipts[step]
  return (
    <ReceiptStep
      receipt={receipt}
      selection={selections[receipt.id] ?? { category: '', gst_code: 'IE', dr_cr: 'DR', remark: '' }}
      allSelections={selections}
      bankTransactions={bankTransactions}
      stepNum={step + 1}
      totalSteps={totalSteps}
      onUpdate={(patch) => updateSelection(receipt.id, patch)}
      onNext={handleNext}
      onBack={handleBack}
      onReject={() => setShowRejectModal(true)}
    />
  )
}

// step === totalSteps → summary (placeholder for now)
return <div className="p-4 text-sm">Summary — TODO</div>
```

Also add `const [showRejectModal, setShowRejectModal] = useState(false)` to the component state.

- [ ] **Step 4: Verify per-receipt screen**

Navigate to the wizard for a claim with receipts. Verify:
- Receipt image displays full width
- Info rows show correct data
- Bank transaction block appears only for receipts with a linked BT, refunds are listed
- Category input shows datalist suggestions
- GST + DR/CR segmented controls work
- Next is disabled until category is filled
- Back on step 0 goes to claim detail page
- Back on step 1+ goes to previous receipt
- sessionStorage updates on every action

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ApprovalWizardPage.jsx
git commit -m "feat: approval wizard per-receipt screen"
```

---

## Task 4: Rejection modal

**Files:**
- Modify: `frontend/src/pages/ApprovalWizardPage.jsx`

- [ ] **Step 1: Add RejectModal component**

```jsx
function RejectModal({ receipts, selections, onConfirm, onCancel, loading }) {
  // Pre-fill from accumulated per-receipt remarks
  const prefilled = receipts
    .map((r, i) => {
      const remark = selections[r.id]?.remark?.trim()
      return remark ? `Receipt ${i + 1} — ${remark}` : null
    })
    .filter(Boolean)
    .join('\n')

  const [comment, setComment] = useState(prefilled)

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end p-4">
      <div className="bg-white rounded-2xl w-full p-4 max-w-sm mx-auto">
        <h3 className="font-bold text-gray-900 mb-1">Reject Submission</h3>
        <p className="text-sm text-gray-500 mb-3">
          Tell the treasurer what needs to be fixed. Flagged receipts are pre-filled below.
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3 resize-none"
          placeholder="e.g. Receipt 2 — amount doesn't match bank transaction."
        />
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(comment)}
            disabled={!comment.trim() || loading}
            className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send Rejection'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 2: Wire rejection into ApprovalWizardPage**

Add to the component's imports and state:

```jsx
import { rejectReview } from '../api/claims'

// inside component:
const [showRejectModal, setShowRejectModal] = useState(false)
const [rejecting, setRejecting] = useState(false)

async function handleReject(comment) {
  setRejecting(true)
  try {
    await rejectReview({ claimId: id, comment })
    clearDraft(id)
    navigate(`/claims/${id}`)
  } catch {
    // leave modal open on error
  } finally {
    setRejecting(false)
  }
}
```

Then render the modal conditionally (add this before all return statements — render it portaled so it appears regardless of which screen is showing):

```jsx
// At top of render, before the if(step < totalSteps) branch:
return (
  <>
    {showRejectModal && (
      <RejectModal
        receipts={receipts}
        selections={selections}
        onConfirm={handleReject}
        onCancel={() => setShowRejectModal(false)}
        loading={rejecting}
      />
    )}
    {step < totalSteps ? (
      <ReceiptStep
        // ... same props as before ...
        onReject={() => setShowRejectModal(true)}
      />
    ) : (
      <div className="p-4 text-sm">Summary — TODO</div>
    )}
  </>
)
```

- [ ] **Step 3: Verify rejection flow**

Open wizard, add a flag note to receipt 1, advance to receipt 2, click "Reject". Confirm:
- Modal opens with receipt 1's flag note pre-filled
- Textarea is editable
- "Send Rejection" disabled when textarea empty
- On confirm, claim goes back to draft and app navigates to claim detail
- sessionStorage entry is cleared

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ApprovalWizardPage.jsx
git commit -m "feat: approval wizard rejection modal with accumulated remarks"
```

---

## Task 5: Summary screen and approve action

**Files:**
- Modify: `frontend/src/pages/ApprovalWizardPage.jsx`

- [ ] **Step 1: Add the SummaryScreen component**

```jsx
function SummaryScreen({ claim, receipts, bankTransactions, selections, onApprove, onBack, onReject, approving }) {
  // Group receipts by category
  const groups = {}
  for (const r of receipts) {
    const sel = selections[r.id] ?? {}
    const cat = sel.category || '(unassigned)'
    if (!groups[cat]) groups[cat] = { receipts: [], gst_code: sel.gst_code, dr_cr: sel.dr_cr }
    groups[cat].receipts.push(r)
  }

  const totalReceipts = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalBtNet = bankTransactions.reduce((s, bt) => {
    const refunds = (bt.refunds ?? []).reduce((rs, ref) => rs + Number(ref.amount ?? 0), 0)
    return s + Number(bt.amount ?? 0) - refunds
  }, 0)
  const reconciled = Math.abs(totalReceipts - totalBtNet) <= 0.01

  const flagged = receipts
    .map((r, i) => ({ i, remark: selections[r.id]?.remark?.trim() }))
    .filter(({ remark }) => remark)

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        <button type="button" onClick={onBack} className="text-blue-600 text-sm font-medium px-1 py-1 active:text-blue-800">
          ← Back
        </button>
        <span className="text-sm font-semibold text-gray-800">Review Summary</span>
        <button type="button" onClick={onReject} className="text-red-600 text-sm font-medium px-1 py-1 active:text-red-800">
          Reject
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-24">

        {/* Flagged banner */}
        {flagged.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-800 mb-1">Flagged Receipts</p>
            {flagged.map(({ i, remark }) => (
              <p key={i} className="text-xs text-amber-700">Receipt {i + 1} — {remark}</p>
            ))}
            <p className="text-xs text-amber-600 mt-1">Resolve by rejecting, or clear the notes before approving.</p>
          </div>
        )}

        {/* Receipts grouped by line item */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-1">Receipts by Category</p>
          {Object.entries(groups).map(([cat, group]) => (
            <div key={cat} className="border-t border-gray-100 first:border-t-0">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                <span className="text-sm font-semibold text-gray-800">{cat}</span>
                <div className="flex gap-1">
                  <span className="text-[10px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">{group.gst_code}</span>
                  <span className="text-[10px] bg-gray-200 text-gray-700 rounded px-1.5 py-0.5 font-medium">{group.dr_cr}</span>
                </div>
              </div>
              {group.receipts.map((r) => (
                <div key={r.id} className="flex justify-between items-center px-4 py-1.5 text-sm border-t border-gray-50">
                  <span className="text-gray-700 truncate">{r.description || '—'}</span>
                  <span className="text-gray-900 font-medium shrink-0 ml-2">{formatAmount(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-1.5 text-sm border-t border-gray-200 bg-gray-50">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-semibold">
                  {formatAmount(group.receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0))}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Bank transactions */}
        {bankTransactions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-1">Bank Transactions</p>
            {bankTransactions.map((bt, i) => {
              const refundTotal = (bt.refunds ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
              const net = Number(bt.amount ?? 0) - refundTotal
              return (
                <div key={bt.id} className="border-t border-gray-100 px-4 py-2 flex flex-col gap-0.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">BT {i + 1} gross</span>
                    <span>{formatAmount(bt.amount)}</span>
                  </div>
                  {(bt.refunds ?? []).map((ref, j) => (
                    <div key={ref.id ?? j} className="flex justify-between text-sm text-red-600">
                      <span>Refund {j + 1}</span>
                      <span>− {formatAmount(ref.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-0.5 mt-0.5">
                    <span className="text-gray-700">Net</span>
                    <span>{formatAmount(net)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Reconciliation */}
        <div className={`rounded-xl border p-4 ${reconciled ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex justify-between text-sm mb-1">
            <span className={reconciled ? 'text-green-700' : 'text-amber-700'}>Total receipts</span>
            <span className="font-semibold">{formatAmount(totalReceipts)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className={reconciled ? 'text-green-700' : 'text-amber-700'}>Total net BTs</span>
            <span className="font-semibold">{formatAmount(totalBtNet)}</span>
          </div>
          {reconciled ? (
            <p className="text-xs text-green-700 font-semibold">✓ Amounts match</p>
          ) : (
            <p className="text-xs text-amber-700">⚠ Amounts do not match — please verify before approving</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 active:bg-gray-100"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-50 active:bg-green-700"
        >
          {approving ? 'Approving…' : 'Approve & Send Email'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add approve handler and wire summary screen**

In the component, add:

```jsx
import { sendEmail } from '../api/email'
import { updateReceipt } from '../api/receipts'
import { useQueryClient } from '@tanstack/react-query'
import { CLAIM_KEYS } from '../api/claims'

// inside component:
const queryClient = useQueryClient()
const [approving, setApproving] = useState(false)

async function handleApprove() {
  setApproving(true)
  try {
    // PATCH each receipt with its category/gst_code/dr_cr
    for (const receipt of receipts) {
      const sel = selections[receipt.id]
      if (!sel?.category) continue
      await updateReceipt({
        id: receipt.id,
        category: sel.category,
        gst_code: sel.gst_code,
        dr_cr: sel.dr_cr,
        confirm_category_change: true,
      })
    }
    // Send email / approve
    await sendEmail(id)
    clearDraft(id)
    queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
    navigate(`/claims/${id}`)
  } catch (err) {
    alert('Approval failed: ' + (err?.response?.data?.detail || err?.message || 'Unknown error'))
  } finally {
    setApproving(false)
  }
}
```

Then update the return statement's summary branch:

```jsx
{step < totalSteps ? (
  <ReceiptStep ... />
) : (
  <SummaryScreen
    claim={claim}
    receipts={receipts}
    bankTransactions={bankTransactions}
    selections={selections}
    onApprove={handleApprove}
    onBack={() => setStep(totalSteps - 1)}
    onReject={() => setShowRejectModal(true)}
    approving={approving}
  />
)}
```

- [ ] **Step 3: Verify summary screen and approve**

Go through all receipts in the wizard, reach the summary. Verify:
- Categories, GST codes, DR/CR are grouped correctly
- Bank transactions show gross, each refund, and net
- Reconciliation row is green when totals match, amber when they don't
- Flagged banner shows when any receipt has a remark
- "Approve & Send Email" calls the API, navigates back to claim detail
- After approval, claim status has changed and categories are assigned on receipts

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ApprovalWizardPage.jsx
git commit -m "feat: approval wizard summary screen and approve action"
```

---

## Task 6: Wire entry point in ClaimDetailPage

**Files:**
- Modify: `frontend/src/pages/ClaimDetailPage.jsx` (ReviewPanel component, lines ~1027–1042)

- [ ] **Step 1: Import useNavigate in ClaimDetailPage (already imported — verify)**

`useNavigate` is already imported at line 3: `import { useParams, useNavigate } from 'react-router-dom'`. No change needed.

- [ ] **Step 2: Update ReviewPanel to accept navigate prop and replace button**

The `ReviewPanel` component (around line 982) currently receives `{ claim, onApprove, onReject, approving }`. Change it to also accept `onStartApproval`:

```jsx
function ReviewPanel({ claim, onApprove, onReject, onStartApproval, approving }) {
```

Then replace the approve button (lines ~1028–1035):

```jsx
<div className="flex gap-2">
  <button
    onClick={onStartApproval}
    className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1 active:bg-blue-700"
  >
    Start Approval Process
  </button>
  <button
    onClick={() => setShowRejectModal(true)}
    className="flex-1 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold"
  >
    Reject
  </button>
</div>
```

- [ ] **Step 3: Pass onStartApproval from the parent**

Find where `ReviewPanel` is rendered in the main `ClaimDetailPage` component (search for `<ReviewPanel`). Add `onStartApproval` and remove `onApprove` and `approving` (those were for the old direct-approve button which is now gone):

```jsx
<ReviewPanel
  claim={claim}
  onReject={/* keep existing handler */}
  onStartApproval={() => navigate(`/claims/${id}/approve`)}
/>
```

Also remove the `onApprove` and `approving` parameters from the `ReviewPanel` function signature since they are no longer used.

- [ ] **Step 4: Verify entry point**

Open a claim in `pending_review` status. Confirm:
- ReviewPanel shows "Start Approval Process" (blue) and "Reject" buttons
- Clicking "Start Approval Process" navigates to `/claims/<id>/approve`
- Clicking "Reject" still opens the existing rejection modal on the claim detail page
- "Approve & Send Email" button is gone from ReviewPanel

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ClaimDetailPage.jsx
git commit -m "feat: replace approve button with Start Approval Process in ReviewPanel"
```

---

## Self-review checklist (for implementer)

After all tasks:

- [ ] Navigating back from step 0 goes to claim detail (not crashes)
- [ ] sessionStorage draft is cleared on both approve and reject outcomes
- [ ] Category auto-fill copies gst_code + dr_cr from the earlier receipt with the same category
- [ ] Rejection modal is pre-filled from flag notes, textarea required before confirming
- [ ] Reconciliation shows green when `|totalReceipts - totalBtNet| <= 0.01`
- [ ] Approve POSTes to existing email-send endpoint AFTER all PATCH calls complete
- [ ] Finance team with `role === 'director'` or `role === 'member'` can access the route; treasurer role is redirected
