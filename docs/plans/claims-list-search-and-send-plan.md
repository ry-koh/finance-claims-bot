# Implementation Plan: Claims List Search, Multi-Select & Telegram Send

Design doc: `docs/designs/claims-list-search-and-send.md`

---

## Task 1 — Backend: `POST /documents/send-telegram`

**File:** `backend/app/routers/documents.py`

Add a Pydantic model and endpoint:

```python
class SendTelegramPayload(BaseModel):
    claim_ids: list[str]

@router.post("/send-telegram")
async def send_to_telegram(
    payload: SendTelegramPayload,
    member: dict = Depends(require_auth),
    db=Depends(get_supabase),
):
```

Logic:
1. Read `member["telegram_id"]`. If falsy, raise HTTP 400: `"Your account has no Telegram ID linked."`
2. For each `claim_id` in `payload.claim_ids`:
   - Fetch `claim_documents` where `claim_id=claim_id`, `type='compiled'`, `is_current=True`
   - If not found: add to `skipped_ids`, continue
   - Download bytes from R2: `r2_service.download_file(doc["drive_file_id"])`
   - Also fetch `reference_code` from claims table for the filename
   - Send via bot: `await bot.send_document(chat_id=int(member["telegram_id"]), document=bytes_io, filename=f"{reference_code}.pdf")`
   - Increment `sent` counter
3. Return `{ "sent": sent, "skipped": len(skipped_ids), "skipped_ids": skipped_ids }`

Bot instantiation: use `Bot(token=settings.TELEGRAM_BOT_TOKEN)` (same as bot.py), call `await bot.close()` in a finally block.

Import `from telegram import Bot` and `import io` (already present).

**Verification:** POST with a compiled claim_id → PDF arrives in Telegram DM. POST with non-compiled claim_id → skipped_ids contains it.

---

## Task 2 — Backend: `PATCH /claims/bulk`

**File:** `backend/app/routers/claims.py`

Add a Pydantic model and endpoint:

```python
class BulkStatusUpdate(BaseModel):
    claim_ids: list[str]
    status: ClaimStatus

@router.patch("/bulk")
async def bulk_update_status(
    payload: BulkStatusUpdate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
```

Logic:
1. Validate `payload.claim_ids` is non-empty; raise HTTP 422 if empty
2. `db.table("claims").update({"status": payload.status.value}).in_("id", payload.claim_ids).execute()`
3. Return `{ "updated": len(payload.claim_ids) }`

Route must be placed **before** `@router.patch("/{claim_id}")` to avoid path conflicts.

**Verification:** PATCH /claims/bulk with valid claim_ids and status="submitted" → claims updated in DB.

---

## Task 3 — Frontend: API additions

### `frontend/src/api/documents.js`

Add after existing exports:

```js
export const sendToTelegram = ({ claim_ids }) =>
  api.post('/documents/send-telegram', { claim_ids }).then((r) => r.data)

export function useSendToTelegram(options = {}) {
  return useMutation({
    mutationFn: sendToTelegram,
    ...options,
  })
}
```

### `frontend/src/api/claims.js`

Add after existing exports:

```js
export const bulkUpdateStatus = ({ claim_ids, status }) =>
  api.patch('/claims/bulk', { claim_ids, status }).then((r) => r.data)

export function useBulkUpdateStatus(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkUpdateStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}
```

**Verification:** Both exports exist and are importable.

---

## Task 4 — Frontend: `HomePage.jsx` — search, filter, multi-select

**File:** `frontend/src/pages/HomePage.jsx`

### 4a. Raise fetch limit

Change both `useClaims` calls from `page_size: 50` to `page_size: 500`.

### 4b. Search and date filter state

Add at the top of `HomePage`:
```js
const [search, setSearch] = useState('')
const [filterOpen, setFilterOpen] = useState(false)
const [dateFrom, setDateFrom] = useState('')
const [dateTo, setDateTo] = useState('')
```

Add a `filteredClaims` memo that applies search + date range on top of the existing `claims` list:
```js
const filteredClaims = useMemo(() => {
  let result = claims
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    result = result.filter(c =>
      (c.reference_code ?? '').toLowerCase().includes(q) ||
      (c.claimer?.cca?.name ?? '').toLowerCase().includes(q) ||
      (c.claimer?.cca?.portfolio?.name ?? '').toLowerCase().includes(q)
    )
  }
  if (dateFrom) {
    result = result.filter(c => c.created_at >= dateFrom)
  }
  if (dateTo) {
    // Add one day so "to" date is inclusive
    const to = new Date(dateTo)
    to.setDate(to.getDate() + 1)
    result = result.filter(c => new Date(c.created_at) < to)
  }
  return result
}, [claims, search, dateFrom, dateTo])
```

Replace `claims` with `filteredClaims` in the render list.

### 4c. Search bar UI

Add between the `<h1>` and the status tabs:
```jsx
<div className="flex gap-2 mt-2">
  <input
    type="text"
    value={search}
    onChange={e => setSearch(e.target.value)}
    placeholder="Search by ref code, CCA, portfolio…"
    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
  />
  <button
    onClick={() => setFilterOpen(f => !f)}
    className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterOpen ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'}`}
  >
    Filter
  </button>
</div>
{filterOpen && (
  <div className="flex gap-2 mt-2">
    <div className="flex-1">
      <label className="text-xs text-gray-500">From</label>
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 mt-0.5" />
    </div>
    <div className="flex-1">
      <label className="text-xs text-gray-500">To</label>
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 mt-0.5" />
    </div>
  </div>
)}
```

### 4d. Multi-select state and hooks

Add:
```js
const [selectMode, setSelectMode] = useState(false)
const [selectedIds, setSelectedIds] = useState(new Set())
const sendMutation = useSendToTelegram()
const bulkStatusMutation = useBulkUpdateStatus()
const [actionResult, setActionResult] = useState(null) // toast message
```

Import `useSendToTelegram` from `../api/documents` and `useBulkUpdateStatus` from `../api/claims`.

Toggle helpers:
```js
const toggleSelect = (id) => setSelectedIds(prev => {
  const next = new Set(prev)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
})
const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
```

### 4e. Header changes

In select mode, replace the `<h1>` row with:
```jsx
{selectMode ? (
  <div className="flex items-center justify-between mb-2">
    <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
    <div className="flex gap-2">
      <button onClick={() => setSelectedIds(new Set(filteredClaims.map(c => c.id)))}
        className="text-xs text-blue-600 font-medium">Select All</button>
      <button onClick={exitSelectMode}
        className="text-xs text-gray-500 font-medium">Cancel</button>
    </div>
  </div>
) : (
  <div className="flex items-center justify-between mb-3">
    <h1 className="text-lg font-bold text-gray-900">Claims</h1>
    <button onClick={() => setSelectMode(true)}
      className="text-sm text-blue-600 font-medium">Select</button>
  </div>
)}
```

Hide the status tab row when `selectMode` is true.

### 4f. ClaimCard checkbox

Pass `selectMode`, `selected`, `onToggle` props to `ClaimCard`. When `selectMode`:
- Wrap the card in a div with `onClick={() => onToggle(claim.id)}`
- Show a checkbox circle at top-right: filled blue circle with checkmark if selected, empty gray circle if not
- Remove the `onClick={onClick}` navigate handler in select mode

### 4g. Floating action bar

Add at the bottom of the page JSX, outside the list:
```jsx
{selectMode && (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3 shadow-lg">
    <button
      disabled={selectedIds.size === 0 || sendMutation.isPending}
      onClick={handleSendToTelegram}
      className="flex-1 bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold py-2.5 rounded-xl"
    >
      {sendMutation.isPending ? 'Sending…' : `Send (${selectedIds.size})`}
    </button>
    <button
      disabled={selectedIds.size === 0 || bulkStatusMutation.isPending}
      onClick={handleMarkSubmitted}
      className="flex-1 bg-green-600 disabled:bg-green-300 text-white text-sm font-semibold py-2.5 rounded-xl"
    >
      {bulkStatusMutation.isPending ? 'Updating…' : `Mark Submitted (${selectedIds.size})`}
    </button>
  </div>
)}
```

Add bottom padding to the list when `selectMode` is active so content isn't hidden under the bar: `pb-24` on the list container.

### 4h. Action handlers and confirmation

```js
const [confirmAction, setConfirmAction] = useState(null) // 'send' | 'submit' | null

const handleSendToTelegram = () => setConfirmAction('send')
const handleMarkSubmitted = () => setConfirmAction('submit')

const handleConfirm = async () => {
  const ids = [...selectedIds]
  setConfirmAction(null)
  if (confirmAction === 'send') {
    const result = await sendMutation.mutateAsync({ claim_ids: ids })
    setActionResult(`Sent ${result.sent} PDF${result.sent !== 1 ? 's' : ''}${result.skipped ? ` · ${result.skipped} skipped` : ''}`)
    exitSelectMode()
  } else if (confirmAction === 'submit') {
    await bulkStatusMutation.mutateAsync({ claim_ids: ids, status: 'submitted' })
    setActionResult(`Marked ${ids.length} claim${ids.length !== 1 ? 's' : ''} as submitted`)
    exitSelectMode()
  }
}
```

Confirmation dialog (simple modal, same pattern as delete confirmation in ClaimDetailPage):
```jsx
{confirmAction && (
  <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
    <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl mb-4 mx-4">
      <h3 className="text-base font-semibold text-gray-900 mb-2">
        {confirmAction === 'send' ? 'Send to Telegram?' : 'Mark as Submitted?'}
      </h3>
      <p className="text-sm text-gray-500 mb-5">
        {confirmAction === 'send'
          ? `Send ${selectedIds.size} compiled PDF${selectedIds.size !== 1 ? 's' : ''} to yourself on Telegram. Claims without a compiled PDF will be skipped.`
          : `Mark ${selectedIds.size} claim${selectedIds.size !== 1 ? 's' : ''} as submitted. This cannot be undone easily.`}
      </p>
      <div className="flex gap-3">
        <button onClick={() => setConfirmAction(null)}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">
          Cancel
        </button>
        <button onClick={handleConfirm}
          className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold">
          Confirm
        </button>
      </div>
    </div>
  </div>
)}
```

Toast (auto-dismiss after 3 seconds):
```jsx
{actionResult && (
  <div className="fixed top-4 left-4 right-4 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50 text-center">
    {actionResult}
  </div>
)}
```
Use a `useEffect` to clear `actionResult` after 3000ms whenever it changes.

**Verification:** Search filters the list correctly. Date range works. Multi-select mode enters/exits cleanly. Send and Mark Submitted trigger correct API calls and show confirmation + toast.

---

## Task 5 — Frontend: `ClaimDetailPage.jsx` — Download button

**File:** `frontend/src/pages/ClaimDetailPage.jsx`

In the documents section, find where `claim.documents` is rendered. Add a download button for the compiled doc:

```jsx
{(() => {
  const compiled = (claim.documents ?? []).find(d => d.type === 'compiled')
  if (!compiled) return null
  return (
    <a
      href={imageUrl(compiled.drive_file_id)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl"
    >
      Download Compiled PDF
    </a>
  )
})()}
```

The `imageUrl` helper already exists in the file. No new imports needed.

**Verification:** When a compiled document exists, the button appears and opens the PDF in a new tab.
