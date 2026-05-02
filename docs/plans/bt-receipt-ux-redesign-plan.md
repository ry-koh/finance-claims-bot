# Implementation Plan: BT & Receipt UX Redesign

Design doc: `docs/designs/bt-receipt-ux-redesign.md`

---

## Task 1 — DB Migration: BT amount + refunds table

**File:** `supabase/migrations/007_bt_refunds.sql`

Create the migration file with:
```sql
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bank_transaction_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  drive_file_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bt_refunds_bt_id ON bank_transaction_refunds(bank_transaction_id);
```

Note: This migration must be manually applied in Supabase before the backend tasks will work end-to-end.

**Verification:** File exists and SQL is valid.

---

## Task 2 — Backend: BT router — amount + refund endpoints

**File:** `backend/app/routers/bank_transactions.py`

Changes:
1. Add `amount: float = Form(...)` to `POST ""` (create BT). Store in DB.
2. Add `PATCH /{bt_id}` — update BT amount. Accepts `amount: float = Form(...)`.
3. Add `POST /{bt_id}/refunds` — create refund:
   - Form fields: `amount: float`
   - File: `file: UploadFile`
   - Upload file to Drive (same folder as BT's claim)
   - Insert into `bank_transaction_refunds`
   - Return created record
4. Add `DELETE /{bt_id}/refunds/{refund_id}` — delete refund record from DB.

Route ordering: place `POST /{bt_id}/refunds` and `DELETE /{bt_id}/refunds/{refund_id}` BEFORE `DELETE /{bt_id}` to avoid path conflicts.

To get the claim folder for the refund upload: join `bank_transactions` → `claims` → `reference_code` → `drive_service.get_claim_folder_id(reference_code)`.

**Verification:** All 4 endpoints exist and return correct shapes.

---

## Task 3 — Backend: claims.py — fetch refunds + net_amount on BTs

**File:** `backend/app/routers/claims.py`

In `get_claim` (GET `/{claim_id}`), after the existing block that fetches `bank_transaction_images` and attaches `bt["images"]`, add:

```python
# Fetch refunds for all bank transactions
if bank_transactions:
    btr_resp = db.table("bank_transaction_refunds").select("*").in_(
        "bank_transaction_id", bt_ids
    ).order("created_at").execute()
    refunds_by_bt: dict = {}
    for ref in btr_resp.data:
        refunds_by_bt.setdefault(ref["bank_transaction_id"], []).append(ref)
    for bt in bank_transactions:
        bt["refunds"] = refunds_by_bt.get(bt["id"], [])
        bt["net_amount"] = float(bt["amount"] or 0) - sum(float(r["amount"]) for r in bt["refunds"])
else:
    for bt in bank_transactions:
        bt["refunds"] = []
        bt["net_amount"] = float(bt.get("amount") or 0)
```

**Verification:** GET /claims/{id} response includes `bank_transactions[].refunds` and `bank_transactions[].net_amount`.

---

## Task 4 — Backend: documents.py + pdf.py — 3A/3B splitting + remarks

### 4a. `pdf.py` — update `generate_loa` signature

`generate_loa(claim, receipts, bank_transactions=None, reference_code_override=None)`

- Use `reference_code_override` (if provided) instead of `claim["reference_code"]` in document headers.
- Receipts and bank_transactions are already pre-filtered to this half by the caller.
- No other logic changes needed in pdf.py for splitting — the caller handles filtering.

### 4b. `documents.py` — `generate_documents` full rewrite of the generation block

Replace the current single-pass generation with:

```python
line_items = claim.get("line_items", [])  # already ordered by line_item_index
base_code = claim["reference_code"]

# Determine halves
if len(line_items) <= 5:
    halves = [(line_items, "")]
else:
    chunks = [line_items[i:i+5] for i in range(0, len(line_items), 5)]
    suffixes = ["A", "B", "C"]
    halves = list(zip(chunks, suffixes[:len(chunks)]))

# For each half: collect receipts, generate docs
for half_items, suffix in halves:
    ref_code = base_code + suffix  # e.g. "2526-VPE-HPB-003A" or "2526-VPE-HPB-003" if no suffix

    # Collect receipts for this half (flatten line items)
    half_receipt_ids = {
        r["id"]
        for item in half_items
        for r in item.get("receipts", [])
    }

    # Filter all_receipts to this half (preserving images already attached)
    half_receipts = [r for r in all_receipts if r["id"] in half_receipt_ids]

    # Determine which BTs are relevant to this half
    # A BT is relevant if ANY of its linked receipts are in this half, OR if it has no linked receipts
    def bt_relevant(bt):
        linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
        if not linked:
            return True  # BT with no receipts — include in first half only
        return any(r["id"] in half_receipt_ids for r in linked)

    # For "no receipts" BTs: only include in first half to avoid duplication
    def bt_relevant_strict(bt, is_first_half):
        linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
        if not linked:
            return is_first_half
        return any(r["id"] in half_receipt_ids for r in linked)

    is_first = (suffix == halves[0][1])
    half_bts = [bt for bt in bank_transactions if bt_relevant_strict(bt, is_first)]

    # Generate LOA
    loa_bytes = pdf_service.generate_loa(claim, half_receipts, half_bts, reference_code_override=ref_code)
    doc_suffix = f"_{suffix}" if suffix else ""
    _save_document(claim_id, f"loa{doc_suffix}", loa_bytes, f"LOA - {ref_code}.pdf", folder_id, db)
    generated.append(f"loa{doc_suffix}")

    # Generate Summary + RFP per half
    summary_bytes = pdf_service.generate_summary(claim, half_items, finance_director, folder_id, reference_code_override=ref_code)
    _save_document(claim_id, f"summary{doc_suffix}", summary_bytes, f"Summary - {ref_code}.pdf", folder_id, db)
    generated.append(f"summary{doc_suffix}")

    rfp_bytes = pdf_service.generate_rfp(claim, half_items, finance_director, folder_id, reference_code_override=ref_code)
    _save_document(claim_id, f"rfp{doc_suffix}", rfp_bytes, f"RFP - {ref_code}.pdf", folder_id, db)
    generated.append(f"rfp{doc_suffix}")
```

### 4c. `documents.py` — remarks auto-generation

After all PDFs are generated, compute and persist remarks:

```python
remarks_lines = []

# Refund remarks
for bt in bank_transactions:
    if bt.get("refunds"):
        refund_amounts = [float(r["amount"]) for r in bt["refunds"]]
        total_refunded = sum(refund_amounts)
        net = float(bt["amount"]) - total_refunded
        if len(refund_amounts) == 1:
            remarks_lines.append(f"1. An item was refunded and the amount refunded is ${refund_amounts[0]:.2f}")
        else:
            amounts_str = " and ".join(f"${a:.2f}" for a in refund_amounts)
            remarks_lines.append(f"1. Items were refunded — {amounts_str}")
        remarks_lines.append(f"2. Initial Bank Transaction is ${float(bt['amount']):.2f}")
        formula = " - ".join([f"${float(bt['amount']):.2f}"] + [f"${a:.2f}" for a in refund_amounts])
        remarks_lines.append(f"3. Total Amount is {formula} = ${net:.2f}")

# Cross-split remarks (only when there are multiple halves)
if len(halves) > 1:
    # Build map: line_item_id -> suffix
    li_to_suffix = {}
    for items, suffix in halves:
        for item in items:
            li_to_suffix[item["id"]] = suffix

    # Build map: receipt_id -> suffix
    r_to_suffix = {}
    for r in all_receipts:
        if r.get("line_item_id") in li_to_suffix:
            r_to_suffix[r["id"]] = li_to_suffix[r["line_item_id"]]

    for bt in bank_transactions:
        linked = [r for r in all_receipts if r.get("bank_transaction_id") == bt["id"]]
        if not linked:
            continue
        half_sums = {}
        for r in linked:
            s = r_to_suffix.get(r["id"], halves[0][1])
            half_sums[s] = half_sums.get(s, 0.0) + float(r["amount"])

        if len(half_sums) > 1:
            # Generate one remark entry per half
            for suffix, local_sum in half_sums.items():
                other_parts = [(s, v) for s, v in half_sums.items() if s != suffix]
                other_str = " and ".join(
                    f"Claim ID {base_code}{s} value of ${v:.2f}" for s, v in other_parts
                )
                calc_str = " + ".join(
                    f"${v:.2f} ({base_code}{s})" for s, v in sorted(half_sums.items())
                )
                remarks_lines.append(
                    f"1. Bank Transaction shows ${float(bt['amount']):.2f} as it includes {other_str} as well"
                )
                remarks_lines.append(
                    f"2. {calc_str} = ${float(bt['amount']):.2f} (Bank Transaction)"
                )

if remarks_lines:
    import re
    auto_block = "\n".join(remarks_lines)
    existing = claim.get("remarks") or ""
    sentinel_re = re.compile(r"<!-- AUTO -->.*?<!-- /AUTO -->", re.DOTALL)
    new_block = f"<!-- AUTO -->\n{auto_block}\n<!-- /AUTO -->"
    if sentinel_re.search(existing):
        new_remarks = sentinel_re.sub(new_block, existing)
    else:
        new_remarks = (existing + "\n\n" + new_block).strip()
    db.table("claims").update({"remarks": new_remarks}).eq("id", claim_id).execute()
```

Also update `generate_summary` and `generate_rfp` in `pdf.py` to accept and use `reference_code_override` parameter.

**Verification:** For a claim with > 5 line items, `generate_documents` produces separate LOA/RFP/Summary files for each half. Remarks are appended to claim.

---

## Task 5 — Frontend: bankTransactions.js — new hooks + amount

**File:** `frontend/src/api/bankTransactions.js`

1. Update `createBankTransaction` to include `amount` in the FormData:
   ```js
   form.append('amount', String(body.amount))
   ```

2. Add `updateBankTransaction`:
   ```js
   export const updateBankTransaction = ({ id, amount }) => {
     const form = new FormData()
     form.append('amount', String(amount))
     return api.patch(`/bank-transactions/${id}`, form).then(r => r.data)
   }
   ```

3. Add `createBtRefund`:
   ```js
   export const createBtRefund = ({ btId, amount, file }) => {
     const form = new FormData()
     form.append('amount', String(amount))
     form.append('file', file)
     return api.post(`/bank-transactions/${btId}/refunds`, form).then(r => r.data)
   }
   ```

4. Add `deleteBtRefund`:
   ```js
   export const deleteBtRefund = ({ btId, refundId }) =>
     api.delete(`/bank-transactions/${btId}/refunds/${refundId}`).then(r => r.data)
   ```

5. Add corresponding hooks `useUpdateBankTransaction`, `useCreateBtRefund`, `useDeleteBtRefund` — all invalidate `CLAIM_KEYS.all` on success (import from claims.js or use a shared key).

**Verification:** All 4 new functions and hooks exported correctly.

---

## Task 6 — Frontend: ClaimDetailPage.jsx — full restructure

**File:** `frontend/src/pages/ClaimDetailPage.jsx`

### 6a. ReceiptInlineForm changes
- Move image upload section to the TOP of the form (before description field)
- Update file `accept` to include `application/pdf`
- Remove `btMode`, `btDriveIds`, `selectedBtId` state entirely
- Remove bank transaction radio button section
- Add `bankTransactionId` prop (passed from parent, null or UUID string)
- Pass `bankTransactionId` in the `onSave` payload

### 6b. New `BtModal` component
Bottom sheet modal for creating/editing a bank transaction. Props: `claimId`, `initial` (null=new, bt object=edit), `onClose`, `onSaved`.

Form fields:
- `amount` number input (required)
- Multi-upload images/PDFs section (same pattern as receipt images — upload immediately on file select, show drive links, allow remove)
- Refunds section: `+ Add Refund` button; each refund row: amount input + file upload button + spinner + remove button
- Save / Cancel buttons

On Save:
1. If new: call `createBankTransaction({ claim_id, amount })` → get bt_id
2. Upload any queued BT images via `uploadBankTransactionImage({ btId, file })`
3. For each refund: call `createBtRefund({ btId, amount, file })`
4. Call `onSaved()` → parent invalidates claim query

On Edit (initial provided):
- Pre-fill amount
- Show existing images (links only, no re-upload needed unless adding more)
- Show existing refunds (links + amounts, allow adding new ones only — no delete of existing in v1 for simplicity)
- On save: call `updateBankTransaction({ id, amount })` + upload new images/refunds

### 6c. New `BtCard` component
Expandable card. Props: `bt`, `claimId`, `linkedReceipts`, `onEdit`, `onDelete`, `onAddReceipt`.

Collapsed view:
```
▶ Bank Tx 1 · $126.62 · net $83.72 · 2 imgs · [✓ / ⚠]
```

Tally: compute `net_amount` from `bt.net_amount`; compare to sum of `linkedReceipts` amounts.

Expanded view:
- Images row: drive links
- Refunds row (if any): each refund as `Refund · $42.90 · [view]`
- Divider
- `linkedReceipts.map(r => <ReceiptRow ... />)`
- `[+ Add Receipt]` button
- `[Edit BT]` `[Delete BT]` buttons

### 6d. Page-level state additions
```js
const [expandedBtId, setExpandedBtId] = useState(null)
const [showBtModal, setShowBtModal] = useState(false)
const [editingBt, setEditingBt] = useState(null)
```

### 6e. Page layout restructure
Replace the current "Receipts" and "Bank Transactions" sections with:

```jsx
{/* Bank Transactions */}
<div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
  <div className="flex items-center justify-between mb-3">
    <h2>Bank Transactions ({claim.bank_transactions?.length ?? 0})</h2>
    <button onClick={() => { setEditingBt(null); setShowBtModal(true) }}>+ Add</button>
  </div>
  {(claim.bank_transactions ?? []).map(bt => {
    const linked = (claim.receipts ?? []).filter(r => r.bank_transaction_id === bt.id)
    return (
      <BtCard
        key={bt.id}
        bt={bt}
        claimId={id}
        linkedReceipts={linked}
        expanded={expandedBtId === bt.id}
        onToggle={() => setExpandedBtId(expandedBtId === bt.id ? null : bt.id)}
        onEdit={() => { setEditingBt(bt); setShowBtModal(true) }}
        onDelete={() => handleDeleteBt(bt.id)}
        onAddReceipt={() => handleAddReceiptToBt(bt.id)}
      />
    )
  })}
</div>

{/* Unlinked Receipts */}
<div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
  <div className="flex items-center justify-between mb-3">
    <h2>Unlinked Receipts ({unlinkedReceipts.length})</h2>
    <button onClick={() => setShowAddUnlinked(true)}>+ Add</button>
  </div>
  {unlinkedReceipts.map(r => <ReceiptRow ... />)}
</div>

{/* BT Modal */}
{showBtModal && (
  <BtModal
    claimId={id}
    initial={editingBt}
    onClose={() => setShowBtModal(false)}
    onSaved={() => { setShowBtModal(false); invalidateClaim() }}
  />
)}
```

`unlinkedReceipts = (claim.receipts ?? []).filter(r => !r.bank_transaction_id)`

Also add `handleAddReceiptToBt(btId)` which sets `addingReceiptForBtId = btId` and opens the receipt form inside the BT card.

**Verification:** BT cards show correctly; adding a receipt from within a BT card pre-links it; unlinked receipts section shows receipts with no BT; BT modal opens/closes and creates BTs with amount and images.
