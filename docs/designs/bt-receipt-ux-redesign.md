# BT & Receipt UX Redesign — Design Document

## Understanding Summary

- **What:** Redesign receipt image upload and bank transaction UX in the Finance Claims Mini App
- **Why:** Current receipt-centric BT linking breaks down when one BT covers many receipts; image upload buried at bottom of form
- **Who:** Finance team members submitting claims via Telegram Mini App
- **Key constraints:** Auto-generate remarks for refunds and cross-split BTs; all uploads accept images + PDFs
- **Non-goals:** Refund-to-receipt linking (not needed for remarks); cross-claim remarks for non-split scenarios

---

## Data Model Changes

### Migration 007

```sql
-- Add amount to bank_transactions
ALTER TABLE bank_transactions ADD COLUMN amount DECIMAL(10,2) NOT NULL DEFAULT 0;

-- New refunds table
CREATE TABLE bank_transaction_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  drive_file_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON bank_transaction_refunds(bank_transaction_id);
```

**Computed (not stored):**
- `net_amount` = `amount − SUM(refunds.amount)`
- `tally_ok` = `net_amount === SUM(linked receipt amounts)`
- Split half (A/B/C) = derived from `line_item_index` at generation time
- Suffixed reference codes (003A, 003B) = appended only in generated PDFs

---

## Backend Changes

### `bank_transactions` router
- `POST ""` — add `amount: float` form field
- `POST /{bt_id}/refunds` — create refund: `amount` (form) + image file → Drive upload → insert `bank_transaction_refunds`
- `DELETE /{bt_id}/refunds/{refund_id}` — delete refund
- `PATCH /{bt_id}` — update BT amount

### `claims.py` GET `/{claim_id}`
Fetch refunds alongside BTs:
```python
btr_resp = db.table("bank_transaction_refunds").select("*").in_("bank_transaction_id", bt_ids).execute()
refunds_by_bt = {}
for ref in btr_resp.data:
    refunds_by_bt.setdefault(ref["bank_transaction_id"], []).append(ref)
for bt in bank_transactions:
    bt["refunds"] = refunds_by_bt.get(bt["id"], [])
    bt["net_amount"] = bt["amount"] - sum(r["amount"] for r in bt["refunds"])
```

### `documents.py` `generate_documents`

**Split detection:**
```python
line_items = claim["line_items"]  # ordered by line_item_index

if len(line_items) <= 5:
    halves = [(line_items, "")]           # no suffix
else:
    chunks = [line_items[0:5], line_items[5:10], line_items[10:]]
    halves = [(chunk, suffix) for chunk, suffix in zip(
        [c for c in chunks if c], ['A', 'B', 'C']
    )]
```

**Per-half document generation:**
- LOA: filter receipts/BTs to those relevant to this half; BTs spanning this half appear after their last linked receipt in this half; unlinked receipts at end
- RFP/Summary: only line items in this half
- Reference code: `base_code + suffix` (e.g. `2526-VPE-HPB-003A`)

**Remarks auto-generation** (after all PDFs generated, before status update):
```python
remarks_lines = []

# Refund remarks — per BT with refunds
for bt in bank_transactions:
    if bt["refunds"]:
        refund_amounts = [r["amount"] for r in bt["refunds"]]
        total_refunded = sum(refund_amounts)
        net = bt["amount"] - total_refunded
        if len(refund_amounts) == 1:
            remarks_lines.append(f"1. An item was refunded and the amount refunded is ${refund_amounts[0]:.2f}")
        else:
            amounts_str = " and ".join(f"${a:.2f}" for a in refund_amounts)
            remarks_lines.append(f"1. Items were refunded — {amounts_str}")
        remarks_lines.append(f"2. Initial Bank Transaction is ${bt['amount']:.2f}")
        formula = " - ".join([f"${bt['amount']:.2f}"] + [f"${a:.2f}" for a in refund_amounts])
        remarks_lines.append(f"3. Total Amount is {formula} = ${net:.2f}")

# Cross-split remarks — per BT spanning multiple halves
if len(halves) > 1:
    for bt in bank_transactions:
        # group linked receipts by half
        half_sums = {}  # suffix -> sum of receipt amounts
        for receipt in linked_receipts_for_bt:
            half = get_half_suffix(receipt, halves)
            half_sums[half] = half_sums.get(half, 0) + receipt["amount"]
        if len(half_sums) > 1:
            for suffix, local_sum in half_sums.items():
                other_parts = {s: v for s, v in half_sums.items() if s != suffix}
                other_str = " and ".join(
                    f"Claim ID {base_code}{s} value of ${v:.2f}"
                    for s, v in other_parts.items()
                )
                calc_str = " + ".join(
                    f"${v:.2f} ({base_code}{s})" for s, v in half_sums.items()
                )
                remarks_lines.append(
                    f"1. Bank Transaction shows ${bt['amount']:.2f} as it includes {other_str} as well"
                )
                remarks_lines.append(
                    f"2. {calc_str} = ${bt['amount']:.2f} (Bank Transaction)"
                )

# Persist — replace AUTO block or append
auto_block = "\n".join(remarks_lines)
existing = claim.get("remarks") or ""
import re
if "<!-- AUTO -->" in existing:
    new_remarks = re.sub(r"<!-- AUTO -->.*<!-- /AUTO -->", f"<!-- AUTO -->{auto_block}<!-- /AUTO -->", existing, flags=re.DOTALL)
else:
    new_remarks = existing + ("\n\n" if existing else "") + f"<!-- AUTO -->{auto_block}<!-- /AUTO -->"
db.table("claims").update({"remarks": new_remarks}).eq("id", claim_id).execute()
```

---

## Frontend Changes

### `ClaimDetailPage.jsx` — layout restructure

**Replace current receipts + BT sections with:**

```
[Bank Transactions section]
  Header: "Bank Transactions (N)"  [+ Add]
  BT cards (expandable):
    Collapsed: "Bank Tx 1 · $126.62 · net $83.72 · 2 imgs · ✓"
    Expanded:
      Images row: [IMG 1] [IMG 2]
      Refunds row: Refund 1 · $42.90 · [img link]
      ──────────────
      Receipt rows (ReceiptRow component)
      [+ Add Receipt]

[Unlinked Receipts section]
  Header: "Unlinked Receipts (N)"  [+ Add]
  Receipt rows (ReceiptRow component)
```

**BT bottom sheet modal** (`BtModal` component):
- `amount` number input
- Multi-upload images/PDFs
- Refunds: `+ Add Refund` → each row: amount input + file upload + remove button
- Save / Cancel

**BT card state:** `expandedBtId` (one open at a time), `showBtModal`, `editingBt`

### `ReceiptInlineForm` changes
- Move image upload section to **top** of form
- Remove `btMode`, `btDriveIds`, `selectedBtId` state
- Accept `bankTransactionId` prop (null = unlinked, id = pre-linked)
- Update file `accept` to include `application/pdf`

### `frontend/src/api/bankTransactions.js` — new hooks
- `useUpdateBankTransaction` — `PATCH /bank-transactions/{id}`
- `useCreateBtRefund` — `POST /bank-transactions/{id}/refunds`
- `useDeleteBtRefund` — `DELETE /bank-transactions/{id}/refunds/{refund_id}`

---

## LOA Ordering (per half)

```
(Receipts linked to BT1 in this half) → BT1 images
(Receipts linked to BT2 in this half) → BT2 images
...
Unlinked receipts (no BT)
```

- A BT spanning both halves appears in **both** LOA A and LOA B
- A BT with no linked receipts: just its images, no preceding receipts

---

## Decision Log

| # | Decision | Alternatives | Why |
|---|----------|-------------|-----|
| 1 | BT-first UI | Receipts-first, wizard | Mirrors real workflow |
| 2 | BT creation in bottom sheet | Inline form | Refunds + multi-upload cramped inline on mobile |
| 3 | Receipt images at top of form | Bottom (current) | User references image while filling details |
| 4 | BT context as prop, no selector in form | Dropdown | Opening from BT card makes selection implicit |
| 5 | Refund-to-receipt link skipped | Optional FK | Not needed for remarks |
| 6 | Remarks generated at doc generation time | Real-time | Split halves only determined at generation |
| 7 | Sentinel marker for remarks replacement | Always append | Prevents duplicates on regeneration |
| 8 | 3A/3B suffix computed at generation, not stored | Store in DB | Claim is one logical unit; suffix is presentational |
| 9 | First 5 line items → A, next 5 → B, >10 → C | Manual assignment | Deterministic, no user input needed |
| 10 | Cross-split BT appears in both LOAs | One LOA only | Both halves must account for full BT |
| 11 | Unlinked receipts after all BT groups in LOA | Before, interleaved | BT groups are primary structure |
