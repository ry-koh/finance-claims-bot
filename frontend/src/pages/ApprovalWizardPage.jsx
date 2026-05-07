import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useClaim, rejectReview, CLAIM_KEYS } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'
import { CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'
import { updateReceipt } from '../api/receipts'
import { sendEmail } from '../api/email'

// ─── Utilities ────────────────────────────────────────────────────────────────

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

function InfoRow({ label, value, bold = false }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{value || '—'}</span>
    </div>
  )
}

// ─── Fullscreen image viewer ──────────────────────────────────────────────────

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

// ─── Segmented control ────────────────────────────────────────────────────────

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

// ─── sessionStorage helpers ───────────────────────────────────────────────────

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
  if (!claimId) return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(claimId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(claimId, state) {
  if (!claimId) return
  try {
    sessionStorage.setItem(STORAGE_KEY(claimId), JSON.stringify(state))
  } catch {}
}

export function clearDraft(claimId) {
  if (!claimId) return
  sessionStorage.removeItem(STORAGE_KEY(claimId))
}

// ─── Rejection modal ──────────────────────────────────────────────────────────

function RejectModal({ receipts, selections, onConfirm, onCancel, loading }) {
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

// ─── Per-receipt screen ───────────────────────────────────────────────────────

function ReceiptStep({ receipt, selection, allSelections, bankTransactions, stepNum, totalSteps, onUpdate, onNext, onBack, onReject }) {
  const bt = bankTransactions.find((b) => b.id === receipt.bank_transaction_id) ?? null
  const btNet = bt
    ? Number(bt.amount ?? 0) - (bt.refunds ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
    : null

  function handleCategoryChange(cat) {
    const entries = Object.entries(allSelections)
    const myIdx = entries.findIndex(([rid]) => rid === receipt.id)
    if (myIdx === -1) { onUpdate({ category: cat }); return }
    const match = entries.slice(0, myIdx).find(([, s]) => s.category === cat)
    if (match) {
      onUpdate({ category: cat, gst_code: match[1].gst_code, dr_cr: match[1].dr_cr })
    } else {
      onUpdate({ category: cat })
    }
  }

  const canNext = (selection?.category ?? '').trim() !== ''

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        <button type="button" onClick={onBack} className="text-blue-600 text-sm font-medium px-1 py-1 active:text-blue-800">
          ← Back
        </button>
        <span className="text-sm font-semibold text-gray-800">Receipt {stepNum} of {totalSteps}</span>
        <button type="button" onClick={onReject} className="text-red-600 text-sm font-medium px-1 py-1 active:text-red-800">
          Reject
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-24">
        {/* Receipt images */}
        {(receipt.images ?? []).length > 0 && (
          <div className="flex flex-col gap-2">
            {receipt.images.map((img, i) => (
              <FullWidthImage key={img.drive_file_id ?? i} src={imageUrl(img.drive_file_id)} label={receipt.description} />
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
              value={selection?.category ?? ''}
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
            <SegmentedControl options={GST_CODES} value={selection?.gst_code ?? 'IE'} onChange={(v) => onUpdate({ gst_code: v })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">DR / CR</label>
            <SegmentedControl options={DR_CR_OPTIONS} value={selection?.dr_cr ?? 'DR'} onChange={(v) => onUpdate({ dr_cr: v })} />
          </div>
        </div>

        {/* Flag note */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-xs font-medium text-gray-700 mb-1">Flag note (optional)</label>
          <input
            type="text"
            value={selection?.remark ?? ''}
            onChange={(e) => onUpdate({ remark: e.target.value })}
            placeholder="e.g. Amount doesn't match BT"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3">
        <button type="button" onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 active:bg-gray-100">
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

// ─── Summary screen ───────────────────────────────────────────────────────────

function SummaryScreen({ receipts, bankTransactions, selections, onApprove, onBack, onReject, approving }) {
  // Group receipts by category
  const groups = {}
  for (const r of receipts) {
    const sel = selections[r.id] ?? {}
    const cat = sel.category || '(unassigned)'
    if (!groups[cat]) groups[cat] = { receipts: [], gst_codes: new Set(), dr_crs: new Set() }
    groups[cat].receipts.push(r)
    if (sel.gst_code) groups[cat].gst_codes.add(sel.gst_code)
    if (sel.dr_cr) groups[cat].dr_crs.add(sel.dr_cr)
  }

  const totalReceipts = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalBtNet = bankTransactions.reduce((s, bt) => {
    const refundTotal = (bt.refunds ?? []).reduce((rs, ref) => rs + Number(ref.amount ?? 0), 0)
    return s + Number(bt.amount ?? 0) - refundTotal
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

        {/* Receipts grouped by category */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-1">Receipts by Category</p>
          {Object.entries(groups).map(([cat, group]) => {
            const gstLabel = group.gst_codes.size === 1 ? [...group.gst_codes][0] : 'varies'
            const drCrLabel = group.dr_crs.size === 1 ? [...group.dr_crs][0] : 'varies'
            return (
            <div key={cat} className="border-t border-gray-100 first:border-t-0">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                <span className="text-sm font-semibold text-gray-800">{cat}</span>
                <div className="flex gap-1">
                  <span className="text-[10px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">{gstLabel}</span>
                  <span className="text-[10px] bg-gray-200 text-gray-700 rounded px-1.5 py-0.5 font-medium">{drCrLabel}</span>
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
            )
          })}
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
        <button type="button" onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 active:bg-gray-100">
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ApprovalWizardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: claim, isLoading } = useClaim(id)
  const queryClient = useQueryClient()

  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState({})
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [approving, setApproving] = useState(false)
  const initializedRef = useRef(false)

  // Restore or init draft once claim loads
  useEffect(() => {
    if (!claim || initializedRef.current) return
    initializedRef.current = true
    const draft = loadDraft(id)
    if (draft) {
      setStep(draft.step)
      setSelections(draft.selections)
    } else {
      setSelections(initSelections(claim))
    }
  }, [claim, id])

  // Persist on every change
  useEffect(() => {
    if (!initializedRef.current) return
    saveDraft(id, { step, selections })
  }, [step, selections, id])

  function updateSelection(receiptId, patch) {
    setSelections((prev) => ({
      ...prev,
      [receiptId]: { ...prev[receiptId], ...patch },
    }))
  }

  if (!isFinanceTeam) return <Navigate to="/" replace />

  if (isLoading || !claim || !initializedRef.current) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const receipts = claim.receipts ?? []
  const bankTransactions = claim.bank_transactions ?? []
  const totalSteps = receipts.length

  async function handleReject(comment) {
    setRejecting(true)
    try {
      await rejectReview({ claimId: id, comment })
      clearDraft(id)
      navigate(`/claims/${id}`)
    } catch {
      // leave modal open — user can retry
    } finally {
      setRejecting(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    try {
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
      await sendEmail(id)
      clearDraft(id)
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
      navigate(`/claims/${id}`)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : err?.message || 'Unknown error'
      alert(`Approval failed: ${msg}`)
    } finally {
      setApproving(false)
    }
  }

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
        <ReceiptStep
          receipt={receipt}
          selection={selections[receipt.id]}
          allSelections={selections}
          bankTransactions={bankTransactions}
          stepNum={step + 1}
          totalSteps={totalSteps}
          onUpdate={(patch) => updateSelection(receipt.id, patch)}
          onNext={handleNext}
          onBack={handleBack}
          onReject={() => setShowRejectModal(true)}
        />
      </>
    )
  }

  // step === totalSteps → summary
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
      <SummaryScreen
        receipts={receipts}
        bankTransactions={bankTransactions}
        selections={selections}
        onApprove={handleApprove}
        onBack={() => setStep(totalSteps - 1)}
        onReject={() => setShowRejectModal(true)}
        approving={approving}
      />
    </>
  )
}
