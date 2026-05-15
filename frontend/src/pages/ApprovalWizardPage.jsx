import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useClaim, rejectReview, updateClaim, CLAIM_KEYS } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'
import { CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'
import { updateReceipt, replaceReceiptImage } from '../api/receipts'
import { replaceBankTransactionImage, replaceBtRefundFile } from '../api/bankTransactions'
import { sendEmail } from '../api/email'
import ImageCropModal from '../components/ImageCropModal'
import CroppableThumb from '../components/CroppableThumb'
import { imageUrl } from '../api/images'
import { getClaimReadiness } from '../utils/claimReadiness'

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatAmount(v) {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}
function formatDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function getFxImageIds(receipt) {
  const ids = Array.isArray(receipt?.exchange_rate_screenshot_drive_ids)
    ? receipt.exchange_rate_screenshot_drive_ids.filter(Boolean)
    : []
  const legacyId = receipt?.exchange_rate_screenshot_drive_id
  if (legacyId && !ids.includes(legacyId)) return [legacyId, ...ids]
  return ids
}

function refundFileIds(refund) {
  const ids = []
  if (refund?.drive_file_id) ids.push(refund.drive_file_id)
  for (const fileId of refund?.extra_drive_file_ids ?? []) {
    if (fileId && !ids.includes(fileId)) ids.push(fileId)
  }
  return ids
}

function toAmount(value) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function receiptSpendAmount(receipt) {
  return toAmount(receipt?.amount)
}

function receiptClaimedAmount(receipt) {
  return toAmount(receipt?.claimed_amount ?? receipt?.amount)
}

function refundTotal(bt) {
  return (bt?.refunds ?? []).reduce((sum, refund) => sum + toAmount(refund.amount), 0)
}

function bankTransactionNetAmount(bt) {
  return toAmount(bt?.amount) - refundTotal(bt)
}

function linkedReceipts(bt, receipts) {
  return receipts.filter((receipt) => receipt.bank_transaction_id === bt.id)
}

function amountMatches(a, b) {
  return Math.abs(toAmount(a) - toAmount(b)) <= 0.01
}

function amountDifference(a, b) {
  return toAmount(a) - toAmount(b)
}

function receiptImages(receipt) {
  return (receipt?.images ?? []).filter((img) => img?.drive_file_id)
}

function isBankOnlyReceipt(receipt) {
  return /^BT\d+$/i.test(receipt?.receipt_no || '') && Boolean(receipt?.bank_transaction_id)
}

function isTextEntryTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'))
}

function bankImages(bt) {
  return (bt?.images ?? []).filter((img) => img?.drive_file_id)
}

function compactName(claim) {
  return claim?.one_off_name || claim?.claimer?.name || 'Unknown claimer'
}

const WBS_OPTIONS = [
  { value: 'SA', label: 'Student Account' },
  { value: 'MF', label: 'Master Fund' },
  { value: 'MBH', label: 'MBH' },
  { value: 'OTHERS', label: 'Others' },
]

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

function CroppableFullImage({ src, label, onCropped, reuploading = false }) {
  const [viewing, setViewing] = useState(false)
  const [cropping, setCropping] = useState(false)
  return (
    <>
      {viewing && <FullscreenImageViewer src={src} onClose={() => setViewing(false)} />}
      {cropping && createPortal(
        <ImageCropModal
          src={src}
          fileNumber={1}
          fileTotal={1}
          onConfirm={(f) => { setCropping(false); onCropped?.(f) }}
          onCancel={() => setCropping(false)}
        />,
        document.body
      )}
      <div className="relative w-full rounded-xl overflow-hidden bg-gray-200">
        <button type="button" onClick={() => setViewing(true)} className="w-full active:opacity-75 block">
          <img src={src} alt={label} className="w-full object-contain max-h-64" />
        </button>
        <button
          type="button"
          onClick={() => setCropping(true)}
          disabled={reuploading}
          className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-medium px-2 py-1 rounded-lg active:bg-black/80 disabled:opacity-50"
        >
          {reuploading ? '…' : '✂ Crop'}
        </button>
        {reuploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl pointer-events-none">
            <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
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

// ─── Mobile approval workspace ────────────────────────────────────────────────

function ReviewPill({ tone = 'neutral', children }) {
  const toneClass = {
    neutral: 'bg-gray-100 text-gray-700 border-gray-200',
    good: 'bg-green-50 text-green-700 border-green-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-red-50 text-red-700 border-red-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  }[tone]

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}>
      {children}
    </span>
  )
}

function MobileStat({ label, value, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'border-gray-200 bg-white text-gray-900',
    good: 'border-green-200 bg-green-50 text-green-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-800',
  }[tone]

  return (
    <div className={`min-w-0 rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="mt-1 text-base font-bold tabular-nums">{value}</p>
    </div>
  )
}

function SectionBlock({ title, subtitle, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
      className="rounded-xl border border-gray-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-gray-900">
        <span>{title}</span>
        {subtitle && <span className="text-[11px] font-medium text-gray-500">{subtitle}</span>}
      </summary>
      <div className="border-t border-gray-100 p-3">
        {children}
      </div>
    </details>
  )
}

function EmptyEvidence({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-red-200 bg-red-50 px-3 py-4 text-center text-xs font-medium text-red-700">
      {children}
    </div>
  )
}

function EvidenceImageGrid({ title, images, emptyText, onCropped, replacingImages }) {
  return (
    <SectionBlock title={title} subtitle={`${images.length} image${images.length === 1 ? '' : 's'}`}>
      {images.length === 0 ? (
        <EmptyEvidence>{emptyText}</EmptyEvidence>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {images.map((img, index) => (
            <div key={img.id ?? img.drive_file_id} className="min-w-0">
              <p className="mb-1.5 text-[11px] font-medium text-gray-500">{title} {index + 1}</p>
              <CroppableFullImage
                src={imageUrl(img.drive_file_id)}
                label={`${title} ${index + 1}`}
                reuploading={replacingImages?.[img.id]}
                onCropped={(file) => onCropped?.(img, file)}
              />
            </div>
          ))}
        </div>
      )}
    </SectionBlock>
  )
}

function ClaimDetailsPanel({ claim, claimTotal, claimerName, ccaName, portfolioName, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    claim_description: claim.claim_description || '',
    date: claim.date || '',
    wbs_account: claim.wbs_account || 'SA',
    remarks: claim.remarks || '',
  })

  useEffect(() => {
    if (editing) return
    setDraft({
      claim_description: claim.claim_description || '',
      date: claim.date || '',
      wbs_account: claim.wbs_account || 'SA',
      remarks: claim.remarks || '',
    })
  }, [claim.claim_description, claim.date, claim.wbs_account, claim.remarks, editing])

  async function handleSave() {
    const description = draft.claim_description.trim()
    if (!description) {
      alert('Claim description is required.')
      return
    }
    if (!draft.date) {
      alert('Claim date is required.')
      return
    }
    const saved = await onSave({
      claim_description: description,
      date: draft.date,
      wbs_account: draft.wbs_account,
      remarks: draft.remarks,
    })
    if (saved !== false) setEditing(false)
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Claim details</p>
          <h1 className="mt-1 text-lg font-bold leading-tight text-gray-900">{claim.claim_description || 'No claim description'}</h1>
          <p className="mt-1 text-xs text-gray-500">
            {claimerName} - {ccaName}{portfolioName ? ` / ${portfolioName}` : ''}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Use a clear title in title case, e.g. Master's Gift to Bryan Ong.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-gray-900">{formatAmount(claimTotal)}</p>
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            className="mt-2 text-xs font-bold text-blue-600"
          >
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Claim description</label>
            <input
              value={draft.claim_description}
              onChange={(e) => setDraft((prev) => ({ ...prev, claim_description: e.target.value }))}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Master's Gift to Bryan Ong"
            />
            <p className="mt-1 text-xs text-gray-500">Keep it short, max 5 words. Use proper names and title case.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Claim date</label>
              <input
                type="date"
                value={draft.date || ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Fund</label>
              <select
                value={draft.wbs_account || 'SA'}
                onChange={(e) => setDraft((prev) => ({ ...prev, wbs_account: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {WBS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Remarks</label>
            <textarea
              rows={2}
              value={draft.remarks}
              onChange={(e) => setDraft((prev) => ({ ...prev, remarks: e.target.value }))}
              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="- Optional remark"
            />
            <p className="mt-1 text-xs text-gray-500">Format each line as: - remark</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save details'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function ReceiptInfoPanel({ receipt, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    description: receipt.description || '',
    company: receipt.company || '',
    date: receipt.date || '',
    receipt_no: receipt.receipt_no || '',
    amount: String(receipt.amount ?? ''),
    claimed_amount: receipt.claimed_amount == null ? '' : String(receipt.claimed_amount),
    payer_name: receipt.payer_name || '',
    payer_email: receipt.payer_email || '',
  })

  useEffect(() => {
    if (editing) return
    setDraft({
      description: receipt.description || '',
      company: receipt.company || '',
      date: receipt.date || '',
      receipt_no: receipt.receipt_no || '',
      amount: String(receipt.amount ?? ''),
      claimed_amount: receipt.claimed_amount == null ? '' : String(receipt.claimed_amount),
      payer_name: receipt.payer_name || '',
      payer_email: receipt.payer_email || '',
    })
  }, [
    receipt.description,
    receipt.company,
    receipt.date,
    receipt.receipt_no,
    receipt.amount,
    receipt.claimed_amount,
    receipt.payer_name,
    receipt.payer_email,
    editing,
  ])

  async function handleSave() {
    const amount = Number(draft.amount)
    const claimedRaw = draft.claimed_amount.trim()
    const claimedAmount = claimedRaw ? Number(claimedRaw) : null
    if (!draft.description.trim()) {
      alert('Receipt description is required.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid receipt amount.')
      return
    }
    if (claimedRaw && (!Number.isFinite(claimedAmount) || claimedAmount <= 0)) {
      alert('Enter a valid claimed amount, or leave it blank.')
      return
    }
    const saved = await onSave({
      description: draft.description.trim(),
      company: draft.company.trim(),
      date: draft.date,
      receipt_no: draft.receipt_no.trim(),
      amount,
      claimed_amount: claimedAmount,
      payer_name: draft.payer_name.trim(),
      payer_email: draft.payer_email.trim(),
    })
    if (saved !== false) setEditing(false)
  }

  return (
    <SectionBlock title="Receipt Details" subtitle={receipt.receipt_no || 'No receipt no.'}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-gray-500">
            Check the receipt details before attachments. Keep descriptions proper and readable.
          </p>
          <button type="button" onClick={() => setEditing((open) => !open)} className="shrink-0 text-xs font-bold text-blue-600">
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Receipt description</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Master's Gift to Bryan Ong"
              />
              <p className="mt-1 text-xs text-gray-500">Use title case and proper names.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Company</label>
                <input
                  value={draft.company}
                  onChange={(e) => setDraft((prev) => ({ ...prev, company: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Company / vendor"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Receipt no.</label>
                <input
                  value={draft.receipt_no}
                  onChange={(e) => setDraft((prev) => ({ ...prev, receipt_no: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Receipt number"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Date</label>
                <input
                  type="date"
                  value={draft.date || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Receipt amount</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Claimed amount</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={draft.claimed_amount}
                  onChange={(e) => setDraft((prev) => ({ ...prev, claimed_amount: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Full amount"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Invoice name</label>
                <input
                  value={draft.payer_name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, payer_name: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Name on invoice"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Invoice email</label>
                <input
                  type="email"
                  value={draft.payer_email}
                  onChange={(e) => setDraft((prev) => ({ ...prev, payer_email: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="person@example.com"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save receipt'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <InfoRow label="Description" value={receipt.description} bold />
            <InfoRow label="Company" value={receipt.company} />
            <InfoRow label="Date" value={formatDate(receipt.date)} />
            <InfoRow label="Receipt No." value={receipt.receipt_no} />
            <InfoRow label="Receipt Amount" value={formatAmount(receiptSpendAmount(receipt))} bold />
            {receipt.claimed_amount != null && (
              <InfoRow label="Claimed Amount" value={`${formatAmount(receiptClaimedAmount(receipt))} claimed`} bold />
            )}
            <InfoRow label="Payer" value={receipt.payer_name} />
            <InfoRow label="Payer Email" value={receipt.payer_email} />
          </div>
        )}
      </div>
    </SectionBlock>
  )
}

function FxEvidencePanel({ receipt }) {
  const fxIds = getFxImageIds(receipt)
  if (!receipt.is_foreign_currency && fxIds.length === 0) return null

  return (
    <SectionBlock title="Exchange Rate Evidence" subtitle={fxIds.length ? `${fxIds.length} image${fxIds.length === 1 ? '' : 's'}` : 'Missing'}>
      {fxIds.length === 0 ? (
        <EmptyEvidence>Foreign currency receipt needs an exchange rate screenshot.</EmptyEvidence>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {fxIds.map((driveId, index) => (
            <div key={driveId}>
              <p className="mb-1.5 text-[11px] font-medium text-gray-500">FX screenshot {index + 1}</p>
              <FullWidthImage src={imageUrl(driveId)} label={`FX screenshot ${index + 1}`} />
            </div>
          ))}
        </div>
      )}
    </SectionBlock>
  )
}

function AmountCheck({ receipt, linkedBt, allReceipts }) {
  const receiptSpend = receiptSpendAmount(receipt)
  const claimed = receiptClaimedAmount(receipt)

  if (!linkedBt) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-red-800">Bank link missing</p>
          <ReviewPill tone="bad">Check needed</ReviewPill>
        </div>
        <p className="mt-1 text-xs text-red-700">No bank transaction is linked to this receipt.</p>
      </div>
    )
  }

  const linked = linkedReceipts(linkedBt, allReceipts)
  const linkedSpend = linked.reduce((sum, r) => sum + receiptSpendAmount(r), 0)
  const btNet = bankTransactionNetAmount(linkedBt)
  const diff = amountDifference(linkedSpend, btNet)
  const matches = amountMatches(linkedSpend, btNet)

  return (
    <div className={`rounded-xl border p-3 ${matches ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${matches ? 'text-green-800' : 'text-amber-900'}`}>Amount tally</p>
        <ReviewPill tone={matches ? 'good' : 'warn'}>{matches ? 'Matches' : 'Mismatch'}</ReviewPill>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white/80 p-2">
          <p className="text-gray-500">This receipt</p>
          <p className="font-bold text-gray-900 tabular-nums">{formatAmount(receiptSpend)}</p>
        </div>
        <div className="rounded-lg bg-white/80 p-2">
          <p className="text-gray-500">Claimed</p>
          <p className="font-bold text-gray-900 tabular-nums">{formatAmount(claimed)}</p>
        </div>
        <div className="rounded-lg bg-white/80 p-2">
          <p className="text-gray-500">Linked receipts</p>
          <p className="font-bold text-gray-900 tabular-nums">{formatAmount(linkedSpend)}</p>
        </div>
        <div className="rounded-lg bg-white/80 p-2">
          <p className="text-gray-500">Bank net</p>
          <p className="font-bold text-gray-900 tabular-nums">{formatAmount(btNet)}</p>
        </div>
      </div>
      {!matches && (
        <p className="mt-2 text-xs font-medium text-amber-800">
          Difference: {formatAmount(Math.abs(diff))}. Check refunds, partial claim, or linked receipts.
        </p>
      )}
    </div>
  )
}

function BankEvidencePanel({ bt, allReceipts, onReplaceBtImage, onReplaceRefundImage, replacingImages }) {
  if (!bt) {
    return (
      <SectionBlock title="Bank Transaction Screenshot">
        <EmptyEvidence>No linked bank transaction for this receipt.</EmptyEvidence>
      </SectionBlock>
    )
  }

  const images = bankImages(bt)
  const linked = linkedReceipts(bt, allReceipts)
  const linkedSpend = linked.reduce((sum, receipt) => sum + receiptSpendAmount(receipt), 0)
  const net = bankTransactionNetAmount(bt)

  return (
    <SectionBlock title="Bank Transaction Screenshot" subtitle={`Net ${formatAmount(net)}`}>
      <div className="mb-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-gray-500">Bank gross</p>
            <p className="font-bold text-gray-900 tabular-nums">{formatAmount(bt.amount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Refunds</p>
            <p className="font-bold text-gray-900 tabular-nums">{formatAmount(refundTotal(bt))}</p>
          </div>
          <div>
            <p className="text-gray-500">Bank net</p>
            <p className="font-bold text-gray-900 tabular-nums">{formatAmount(net)}</p>
          </div>
          <div>
            <p className="text-gray-500">Linked receipts</p>
            <p className="font-bold text-gray-900 tabular-nums">{formatAmount(linkedSpend)}</p>
          </div>
        </div>
      </div>

      {images.length === 0 ? (
        <EmptyEvidence>Bank transaction screenshot is missing.</EmptyEvidence>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {images.map((img, index) => (
            <CroppableFullImage
              key={img.id ?? img.drive_file_id}
              src={imageUrl(img.drive_file_id)}
              label={`Bank transaction ${index + 1}`}
              reuploading={replacingImages?.[img.id]}
              onCropped={(file) => onReplaceBtImage?.(img, bt.id, file)}
            />
          ))}
        </div>
      )}

      {(bt.refunds ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-600">Refund proof</p>
          {bt.refunds.map((refund, index) => {
            const fileIds = refundFileIds(refund)
            return (
              <div key={refund.id ?? index} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900">Refund {index + 1}</p>
                  <p className="text-xs text-gray-500">{formatAmount(refund.amount)}</p>
                </div>
                {fileIds.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {fileIds.map((fileId, fileIdx) => (
                      <CroppableThumb
                        key={fileId}
                        src={imageUrl(fileId)}
                        label={`Refund ${index + 1} file ${fileIdx + 1}`}
                        reuploading={replacingImages?.[`${refund.id}:${fileId}`]}
                        onCropped={(file) => onReplaceRefundImage?.(refund, bt.id, fileId, file)}
                        thumbSize="w-16 h-16"
                      />
                    ))}
                  </div>
                ) : (
                  <ReviewPill tone="bad">Missing file</ReviewPill>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionBlock>
  )
}

function FinanceFields({ receipt, selection, allSelections, onUpdate }) {
  const current = {
    category: '',
    gst_code: 'IE',
    dr_cr: 'DR',
    remark: '',
    ...(selection ?? {}),
  }

  function handleCategoryChange(category) {
    const entries = Object.entries(allSelections)
    const myIdx = entries.findIndex(([receiptId]) => receiptId === receipt.id)
    const priorMatch = myIdx > -1
      ? entries.slice(0, myIdx).find(([, item]) => item.category === category)
      : null

    if (priorMatch) {
      onUpdate({ category, gst_code: priorMatch[1].gst_code, dr_cr: priorMatch[1].dr_cr })
    } else {
      onUpdate({ category })
    }
  }

  return (
    <SectionBlock title="Finance Coding" subtitle={current.category || 'Category needed'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Category *</label>
          <select
            value={current.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className={`w-full rounded-xl border px-3 py-3 text-sm focus:outline-none focus:ring-2 ${
              current.category
                ? 'border-gray-300 bg-white focus:ring-blue-300'
                : 'border-red-300 bg-red-50 focus:ring-red-200'
            }`}
          >
            <option value="">Select category</option>
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">GST</label>
            <SegmentedControl options={GST_CODES} value={current.gst_code} onChange={(gst_code) => onUpdate({ gst_code })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">DR / CR</label>
            <SegmentedControl options={DR_CR_OPTIONS} value={current.dr_cr} onChange={(dr_cr) => onUpdate({ dr_cr })} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Issue note for rejection</label>
          <input
            value={current.remark}
            onChange={(e) => onUpdate({ remark: e.target.value })}
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
            placeholder="e.g. Amount mismatch"
          />
        </div>
      </div>
    </SectionBlock>
  )
}

function ReceiptReviewCard({
  receipt,
  receiptIndex,
  claim,
  allReceipts,
  bankTransactions,
  selection,
  allSelections,
  onUpdate,
  onSaveReceiptDetails,
  savingReceiptDetails,
  onReplaceReceiptImage,
  onReplaceBtImage,
  onReplaceRefundImage,
  replacingImages,
}) {
  const images = receiptImages(receipt)
  const linkedBt = bankTransactions.find((bt) => bt.id === receipt.bank_transaction_id)
  const hasCategory = Boolean(selection?.category)
  const hasReceiptImage = images.length > 0
  const hasBankImage = linkedBt ? bankImages(linkedBt).length > 0 : false
  const bankLinked = Boolean(linkedBt)
  const amountOk = linkedBt
    ? amountMatches(
        linkedReceipts(linkedBt, allReceipts).reduce((sum, r) => sum + receiptSpendAmount(r), 0),
        bankTransactionNetAmount(linkedBt)
      )
    : false

  return (
    <article id={`receipt-${receipt.id}`} className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Receipt {receiptIndex + 1}</p>
            <h2 className="mt-1 text-base font-bold leading-tight text-gray-900">{receipt.description || claim.claim_description || 'Untitled receipt'}</h2>
            <p className="mt-1 text-xs text-gray-500">
              Claim: {claim.claim_description || 'No claim description'}
            </p>
          </div>
          <p className="shrink-0 text-base font-bold tabular-nums text-gray-900">
            {formatAmount(receiptClaimedAmount(receipt))}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ReviewPill tone={hasCategory ? 'good' : 'bad'}>{hasCategory ? 'Category set' : 'No category'}</ReviewPill>
          <ReviewPill tone={hasReceiptImage ? 'good' : 'bad'}>{hasReceiptImage ? 'Receipt proof' : 'No receipt proof'}</ReviewPill>
          <ReviewPill tone={bankLinked && hasBankImage ? 'good' : 'bad'}>{bankLinked && hasBankImage ? 'Bank proof' : 'Bank proof needed'}</ReviewPill>
          <ReviewPill tone={amountOk ? 'good' : 'warn'}>{amountOk ? 'Amounts tally' : 'Check amount'}</ReviewPill>
        </div>
      </div>

      <div className="space-y-3 bg-gray-50 p-3">
        <ReceiptInfoPanel
          receipt={receipt}
          onSave={(patch) => onSaveReceiptDetails?.(receipt.id, patch)}
          saving={savingReceiptDetails}
        />
        <EvidenceImageGrid
          title="Receipt Screenshot"
          images={images}
          emptyText="Receipt screenshot is missing."
          replacingImages={replacingImages}
          onCropped={(img, file) => onReplaceReceiptImage?.(img, receipt.id, file)}
        />
        <BankEvidencePanel
          bt={linkedBt}
          allReceipts={allReceipts}
          onReplaceBtImage={onReplaceBtImage}
          onReplaceRefundImage={onReplaceRefundImage}
          replacingImages={replacingImages}
        />
        <FxEvidencePanel receipt={receipt} />
        <AmountCheck receipt={receipt} linkedBt={linkedBt} allReceipts={allReceipts} />
        <FinanceFields
          receipt={receipt}
          selection={selection}
          allSelections={allSelections}
          onUpdate={onUpdate}
        />
      </div>
    </article>
  )
}

function BankOnlyCard({ bt, index, allReceipts, onReplaceBtImage, onReplaceRefundImage, replacingImages }) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bank-only transaction {index + 1}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-gray-900">No linked receipt</h2>
          <p className="text-base font-bold tabular-nums text-gray-900">{formatAmount(bankTransactionNetAmount(bt))}</p>
        </div>
        <p className="mt-1 text-xs text-gray-500">Review this separately if the claim is intentionally bank-only.</p>
      </div>
      <div className="bg-gray-50 p-3">
        <BankEvidencePanel
          bt={bt}
          allReceipts={allReceipts}
          onReplaceBtImage={onReplaceBtImage}
          onReplaceRefundImage={onReplaceRefundImage}
          replacingImages={replacingImages}
        />
      </div>
    </article>
  )
}

function ApprovalWorkspace({
  claim,
  receipts,
  bankTransactions,
  selections,
  onUpdateSelection,
  onSaveClaimDetails,
  savingClaimDetails,
  onSaveReceiptDetails,
  savingReceiptDetails,
  onApprove,
  onBack,
  onReject,
  approving,
  onReplaceReceiptImage,
  onReplaceBtImage,
  onReplaceRefundImage,
  replacingImages,
}) {
  const [fieldFocused, setFieldFocused] = useState(false)
  const readiness = getClaimReadiness({ ...claim, receipts, bank_transactions: bankTransactions })
  const missingCategories = receipts.filter((receipt) => !selections[receipt.id]?.category)
  const missingReceiptImages = receipts.filter((receipt) => !isBankOnlyReceipt(receipt) && receiptImages(receipt).length === 0)
  const bankTransactionsMissingImages = bankTransactions.filter((bt) => bankImages(bt).length === 0)
  const amountMismatches = bankTransactions.filter((bt) => {
    const linked = linkedReceipts(bt, receipts)
    if (linked.length === 0) return false
    const linkedSpend = linked.reduce((sum, receipt) => sum + receiptSpendAmount(receipt), 0)
    return !amountMatches(linkedSpend, bankTransactionNetAmount(bt))
  })
  const totalClaimed = receipts.reduce((sum, receipt) => sum + receiptClaimedAmount(receipt), 0)
  const totalReceiptSpend = receipts.reduce((sum, receipt) => sum + receiptSpendAmount(receipt), 0)
  const totalBankNet = bankTransactions.reduce((sum, bt) => sum + bankTransactionNetAmount(bt), 0)
  const bankOnlyTransactions = bankTransactions.filter((bt) => linkedReceipts(bt, receipts).length === 0)
  const claimTotal = toAmount(claim.total_amount ?? totalClaimed)
  const canApprove = missingCategories.length === 0 && readiness.blockers.length === 0
  const claimerName = compactName(claim)
  const ccaName = claim.cca?.name || 'No CCA'
  const portfolioName = claim.cca?.portfolio?.name
  const showActionBar = !fieldFocused

  return (
    <div
      className={`mobile-page min-h-screen bg-gray-50 ${showActionBar ? 'pb-28' : 'pb-4'}`}
      onFocusCapture={(event) => {
        if (isTextEntryTarget(event.target)) setFieldFocused(true)
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (!nextTarget || !event.currentTarget.contains(nextTarget) || !isTextEntryTarget(nextTarget)) {
          setFieldFocused(false)
        }
      }}
    >
      <div className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <button type="button" onClick={onBack} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 active:bg-gray-100">
            Back
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900">{claim.reference_code ?? `Claim #${claim.id}`}</p>
            <p className="truncate text-xs text-gray-500">Finance approval</p>
          </div>
          <button type="button" onClick={onReject} className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 active:bg-red-100">
            Reject
          </button>
        </div>
      </div>

      <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
        <ClaimDetailsPanel
          claim={claim}
          claimTotal={claimTotal}
          claimerName={claimerName}
          ccaName={ccaName}
          portfolioName={portfolioName}
          onSave={onSaveClaimDetails}
          saving={savingClaimDetails}
        />

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Review checks</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MobileStat label="Claim total" value={formatAmount(claimTotal)} />
            <MobileStat label="Receipt spend" value={formatAmount(totalReceiptSpend)} />
            <MobileStat label="Bank net" value={formatAmount(totalBankNet)} tone={amountMismatches.length ? 'warn' : 'good'} />
            <MobileStat label="Need category" value={String(missingCategories.length)} tone={missingCategories.length ? 'bad' : 'good'} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {readiness.blockers.length > 0 && (
              <ReviewPill tone="bad">{readiness.blockers.length} blocker{readiness.blockers.length === 1 ? '' : 's'}</ReviewPill>
            )}
            {readiness.warnings.length > 0 && (
              <ReviewPill tone="warn">{readiness.warnings.length} review warning{readiness.warnings.length === 1 ? '' : 's'}</ReviewPill>
            )}
            <ReviewPill tone={missingReceiptImages.length ? 'bad' : 'good'}>
              {missingReceiptImages.length ? `${missingReceiptImages.length} receipt proof missing` : 'Receipt proof ready'}
            </ReviewPill>
            <ReviewPill tone={bankTransactionsMissingImages.length ? 'bad' : 'good'}>
              {bankTransactionsMissingImages.length ? `${bankTransactionsMissingImages.length} bank proof missing` : 'Bank proof ready'}
            </ReviewPill>
            <ReviewPill tone={amountMismatches.length ? 'warn' : 'good'}>
              {amountMismatches.length ? `${amountMismatches.length} amount mismatch` : 'Amounts tally'}
            </ReviewPill>
          </div>

          {(readiness.blockers.length > 0 || readiness.warnings.length > 0) && (
            <div className="mt-3 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50 p-3">
              {readiness.blockers.map((issue) => (
                <p key={issue.id} className="text-xs font-semibold text-red-700">{issue.issue}</p>
              ))}
              {readiness.warnings.map((issue) => (
                <p key={issue.id} className="text-xs font-medium text-amber-800">{issue.issue}</p>
              ))}
            </div>
          )}

          {(claim.remarks || claim.treasurer_notes) && (
            <div className="mt-3 space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
              {claim.remarks && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Remarks</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{claim.remarks}</p>
                </div>
              )}
              {claim.treasurer_notes && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Treasurer notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{claim.treasurer_notes}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {receipts.length > 0 && (
          <nav className="sticky top-[65px] z-20 -mx-4 border-y border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {receipts.map((receipt, index) => {
                const missingCategory = !selections[receipt.id]?.category
                const linkedBt = bankTransactions.find((bt) => bt.id === receipt.bank_transaction_id)
                const linkedSpend = linkedBt
                  ? linkedReceipts(linkedBt, receipts).reduce((sum, r) => sum + receiptSpendAmount(r), 0)
                  : 0
                const amountOk = linkedBt ? amountMatches(linkedSpend, bankTransactionNetAmount(linkedBt)) : false
                return (
                  <a
                    key={receipt.id}
                    href={`#receipt-${receipt.id}`}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      missingCategory || !amountOk
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-green-200 bg-green-50 text-green-700'
                    }`}
                  >
                    R{index + 1}
                  </a>
                )
              })}
            </div>
          </nav>
        )}

        {receipts.length === 0 ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">No receipts attached</p>
            <p className="mt-1 text-xs text-amber-800">Review the bank transactions below before approving.</p>
          </section>
        ) : (
          receipts.map((receipt, index) => (
            <ReceiptReviewCard
              key={receipt.id}
              receipt={receipt}
              receiptIndex={index}
              claim={claim}
              allReceipts={receipts}
              bankTransactions={bankTransactions}
              selection={selections[receipt.id]}
              allSelections={selections}
              onUpdate={(patch) => onUpdateSelection(receipt.id, patch)}
              onSaveReceiptDetails={onSaveReceiptDetails}
              savingReceiptDetails={Boolean(savingReceiptDetails?.[receipt.id])}
              onReplaceReceiptImage={onReplaceReceiptImage}
              onReplaceBtImage={onReplaceBtImage}
              onReplaceRefundImage={onReplaceRefundImage}
              replacingImages={replacingImages}
            />
          ))
        )}

        {bankOnlyTransactions.length > 0 && (
          <section className="space-y-3">
            <div className="px-1">
              <h2 className="text-sm font-bold text-gray-900">Bank-only transactions</h2>
              <p className="mt-1 text-xs text-gray-500">These bank transactions are not linked to a receipt.</p>
            </div>
            {bankOnlyTransactions.map((bt, index) => (
              <BankOnlyCard
                key={bt.id}
                bt={bt}
                index={index}
                allReceipts={receipts}
                onReplaceBtImage={onReplaceBtImage}
                onReplaceRefundImage={onReplaceRefundImage}
                replacingImages={replacingImages}
              />
            ))}
          </section>
        )}
      </main>

      {showActionBar && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white px-4 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <button type="button" onClick={onReject} className="rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 active:bg-red-50">
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={!canApprove || approving}
              className="min-w-0 flex-1 rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white active:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500"
            >
              {approving
                ? 'Approving...'
                : readiness.blockers.length
                ? `Fix ${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? '' : 's'}`
                : canApprove
                ? 'Approve & Send Email'
                : `Fill ${missingCategories.length} category`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReceiptStep({ receipt, selection, allSelections, bankTransactions, stepNum, totalSteps, onUpdate, onNext, onBack, onReject, onReplaceReceiptImage, onReplaceBtImage, onReplaceRefundImage, replacingImages }) {
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
  const fxImageIds = getFxImageIds(receipt)

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

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-32">
        {/* Receipt images */}
        {(receipt.images ?? []).length > 0 && (
          <div className="flex flex-col gap-2">
            {receipt.images.map((img, i) => (
              <CroppableFullImage
                key={img.id ?? i}
                src={imageUrl(img.drive_file_id)}
                label={receipt.description}
                reuploading={replacingImages?.[img.id]}
                onCropped={(file) => onReplaceReceiptImage?.(img, receipt.id, file)}
              />
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
          {receipt.is_foreign_currency && (
            <InfoRow
              label="Foreign Exchange"
              value={fxImageIds.length > 0 ? `${fxImageIds.length} screenshot${fxImageIds.length === 1 ? '' : 's'} attached` : 'Screenshot missing'}
              bold
            />
          )}
          {receipt.claimed_amount != null && (
            <InfoRow
              label="Claimed Amount"
              value={`${formatAmount(receipt.claimed_amount)} (partial)`}
              bold
            />
          )}
        </div>

        {receipt.is_foreign_currency && (
          <div className={`rounded-xl border p-4 flex flex-col gap-3 ${fxImageIds.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${fxImageIds.length > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                Foreign Exchange Evidence
              </p>
              <p className={`text-xs mt-0.5 ${fxImageIds.length > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                This receipt was marked as charged in foreign currency.
              </p>
            </div>
            {fxImageIds.length > 0 ? (
              <div className="flex flex-col gap-2">
                {fxImageIds.map((driveFileId, i) => (
                  <FullWidthImage
                    key={`${driveFileId}-${i}`}
                    src={imageUrl(driveFileId)}
                    label={`Exchange rate screenshot ${i + 1}`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-red-700">Exchange-rate screenshot is missing.</p>
            )}
          </div>
        )}

        {/* Bank transactions — all BTs, linked one highlighted */}
        {bankTransactions.length > 0 && (
          <div className="flex flex-col gap-2">
            {bankTransactions.map((bt, i) => {
              const isLinked = bt.id === receipt.bank_transaction_id
              const btNet = Number(bt.amount ?? 0) - (bt.refunds ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
              return (
                <div key={bt.id} className={`rounded-xl border p-4 flex flex-col gap-1.5 ${isLinked ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${isLinked ? 'text-blue-600' : 'text-gray-500'}`}>
                    Bank Transaction {i + 1}{isLinked ? ' — linked' : ''}
                  </p>
                  <InfoRow label="Gross" value={formatAmount(bt.amount)} />
                  {(bt.images ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {bt.images.map((img, k) => img.drive_file_id && (
                        <CroppableThumb
                          key={img.id ?? k}
                          src={imageUrl(img.drive_file_id)}
                          label="BT screenshot"
                          reuploading={replacingImages?.[img.id]}
                          onCropped={(file) => onReplaceBtImage?.(img, bt.id, file)}
                          thumbSize="w-16 h-16"
                        />
                      ))}
                    </div>
                  )}
                  {(bt.refunds ?? []).map((ref, j) => (
                    <div key={ref.id ?? j} className="flex flex-col gap-1 mt-0.5">
                      <InfoRow label={`Refund ${j + 1}`} value={`− ${formatAmount(ref.amount)}`} />
                      {(ref.drive_file_id || (ref.extra_drive_file_ids ?? []).length > 0) && (
                        <div className="flex flex-wrap gap-2">
                          {ref.drive_file_id && (
                            <CroppableThumb
                              src={imageUrl(ref.drive_file_id)}
                              label="Refund screenshot"
                              reuploading={replacingImages?.[`${ref.id}:${ref.drive_file_id}`]}
                              onCropped={(file) => onReplaceRefundImage?.(ref, bt.id, ref.drive_file_id, file)}
                              thumbSize="w-16 h-16"
                            />
                          )}
                          {(ref.extra_drive_file_ids ?? []).map((fid, k) => fid && (
                            <CroppableThumb
                              key={fid}
                              src={imageUrl(fid)}
                              label="Refund screenshot"
                              reuploading={replacingImages?.[`${ref.id}:${fid}`]}
                              onCropped={(file) => onReplaceRefundImage?.(ref, bt.id, fid, file)}
                              thumbSize="w-16 h-16"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-gray-100 pt-1.5 mt-0.5">
                    <InfoRow label="Net" value={formatAmount(btNet)} bold />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Finance fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Finance Fields</p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              value={selection?.category ?? ''}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            >
              <option value="">Select category…</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
      <div
        className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 px-4 pt-3 flex gap-3"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
      >
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

function SummaryScreen({ receipts, bankTransactions, selections, onApprove, onBack, onReject, approving, onReplaceBtImage, onReplaceRefundImage, replacingImages }) {
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

  // BT reconciliation uses full receipt amounts (what was actually debited from bank)
  const totalReceiptSpend = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  // Claimed total may differ for partial claims
  const totalClaimed = receipts.reduce((s, r) => s + Number(r.claimed_amount ?? r.amount ?? 0), 0)
  const isPartial = receipts.some((r) => r.claimed_amount != null)
  const totalBtNet = bankTransactions.reduce((s, bt) => {
    const refundTotal = (bt.refunds ?? []).reduce((rs, ref) => rs + Number(ref.amount ?? 0), 0)
    return s + Number(bt.amount ?? 0) - refundTotal
  }, 0)
  const bankOnly = receipts.length === 0 && bankTransactions.length > 0
  const reconciled = bankOnly || Math.abs(totalReceiptSpend - totalBtNet) <= 0.01

  const flagged = receipts
    .map((r, i) => ({ i, remark: selections[r.id]?.remark?.trim() }))
    .filter(({ remark }) => remark)

  const fxReceipts = receipts
    .map((r, i) => ({ receipt: r, i, fxImageIds: getFxImageIds(r) }))
    .filter(({ receipt }) => receipt.is_foreign_currency)

  const uncategorised = receipts
    .map((r, i) => ({ i, description: r.description || `Receipt ${i + 1}` }))
    .filter(({ i }) => !selections[receipts[i].id]?.category)

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

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-32">
        {/* Uncategorised banner */}
        {uncategorised.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-orange-800 mb-1">Receipts Without Category</p>
            {uncategorised.map(({ i, description }) => (
              <p key={i} className="text-xs text-orange-700">Receipt {i + 1} — {description}</p>
            ))}
            <p className="text-xs text-orange-600 mt-1">These receipts will be saved without a category. You can still approve.</p>
          </div>
        )}

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

        {fxReceipts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-800 mb-1">Foreign Exchange Receipts</p>
            {fxReceipts.map(({ receipt, i, fxImageIds }) => (
              <p key={receipt.id} className={`text-xs ${fxImageIds.length > 0 ? 'text-amber-700' : 'text-red-700 font-semibold'}`}>
                Receipt {i + 1} — {receipt.description || 'Receipt'} — {fxImageIds.length > 0 ? `${fxImageIds.length} screenshot${fxImageIds.length === 1 ? '' : 's'}` : 'exchange-rate screenshot missing'}
              </p>
            ))}
          </div>
        )}

        {/* Receipts grouped by category */}
        {receipts.length > 0 ? (
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
                  <div className="min-w-0">
                    <span className="text-gray-700 truncate block">{r.description || '—'}</span>
                    {r.is_foreign_currency && (
                      <span className="text-[10px] font-semibold text-amber-700">
                        FX · {getFxImageIds(r).length || 'no'} screenshot{getFxImageIds(r).length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-gray-900 font-medium">{formatAmount(r.claimed_amount ?? r.amount)}</span>
                    {r.claimed_amount != null && (
                      <p className="text-[10px] text-gray-400">full {formatAmount(r.amount)}</p>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex justify-between px-4 py-1.5 text-sm border-t border-gray-200 bg-gray-50">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-semibold">
                  {formatAmount(group.receipts.reduce((s, r) => s + Number(r.claimed_amount ?? r.amount ?? 0), 0))}
                </span>
              </div>
            </div>
            )
          })}
        </div>
        ) : (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-800">Bank transaction only</p>
            <p className="mt-1 text-xs text-blue-700">
              This claim has no receipt rows. Review the bank transaction screenshots below before approving.
            </p>
          </div>
        )}

        {/* Bank transactions */}
        {bankTransactions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-1">Bank Transactions</p>
            {bankTransactions.map((bt, i) => {
              const refundTotal = (bt.refunds ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
              const net = Number(bt.amount ?? 0) - refundTotal
              return (
                <div key={bt.id} className="border-t border-gray-100 px-4 py-2 flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">BT {i + 1} gross</span>
                    <span>{formatAmount(bt.amount)}</span>
                  </div>
                  {(bt.images ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {bt.images.map((img, k) => img.drive_file_id && (
                        <CroppableThumb
                          key={img.id ?? k}
                          src={imageUrl(img.drive_file_id)}
                          label="BT screenshot"
                          reuploading={replacingImages?.[img.id]}
                          onCropped={(file) => onReplaceBtImage?.(img, bt.id, file)}
                          thumbSize="w-16 h-16"
                        />
                      ))}
                    </div>
                  )}
                  {(bt.refunds ?? []).map((ref, j) => (
                    <div key={ref.id ?? j} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm text-red-600">
                        <span>Refund {j + 1}</span>
                        <span>− {formatAmount(ref.amount)}</span>
                      </div>
                      {(ref.drive_file_id || (ref.extra_drive_file_ids ?? []).length > 0) && (
                        <div className="flex flex-wrap gap-2">
                          {ref.drive_file_id && (
                            <CroppableThumb
                              src={imageUrl(ref.drive_file_id)}
                              label="Refund screenshot"
                              reuploading={replacingImages?.[`${ref.id}:${ref.drive_file_id}`]}
                              onCropped={(file) => onReplaceRefundImage?.(ref, bt.id, ref.drive_file_id, file)}
                              thumbSize="w-16 h-16"
                            />
                          )}
                          {(ref.extra_drive_file_ids ?? []).map((fid, k) => fid && (
                            <CroppableThumb
                              key={fid}
                              src={imageUrl(fid)}
                              label="Refund screenshot"
                              reuploading={replacingImages?.[`${ref.id}:${fid}`]}
                              onCropped={(file) => onReplaceRefundImage?.(ref, bt.id, fid, file)}
                              thumbSize="w-16 h-16"
                            />
                          ))}
                        </div>
                      )}
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
          {isPartial && !bankOnly && (
            <div className="flex justify-between text-sm mb-1">
              <span className="text-blue-700">Total claimed</span>
              <span className="font-semibold text-blue-700">{formatAmount(totalClaimed)}</span>
            </div>
          )}
          {!bankOnly && (
          <div className="flex justify-between text-sm mb-1">
            <span className={reconciled ? 'text-green-700' : 'text-amber-700'}>
              Total receipt spend{isPartial ? ' (full)' : ''}
            </span>
            <span className="font-semibold">{formatAmount(totalReceiptSpend)}</span>
          </div>
          )}
          <div className="flex justify-between text-sm mb-2">
            <span className={reconciled ? 'text-green-700' : 'text-amber-700'}>
              {bankOnly ? 'Total bank transactions' : 'Total net BTs'}
            </span>
            <span className="font-semibold">{formatAmount(totalBtNet)}</span>
          </div>
          {bankOnly ? (
            <p className="text-xs text-green-700 font-semibold">Ready for bank-transaction-only approval</p>
          ) : reconciled ? (
            <p className="text-xs text-green-700 font-semibold">✓ Amounts match</p>
          ) : (
            <p className="text-xs text-amber-700">⚠ Amounts do not match — please verify before approving</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 px-4 pt-3 flex gap-3"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
      >
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

  const [selections, setSelections] = useState({})
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [savingClaimDetails, setSavingClaimDetails] = useState(false)
  const [savingReceiptDetails, setSavingReceiptDetails] = useState({})
  const [replacingImages, setReplacingImages] = useState({})
  const initializedRef = useRef(false)

  // Restore or init draft once claim loads
  useEffect(() => {
    if (!claim || initializedRef.current) return
    initializedRef.current = true
    const draft = loadDraft(id)
    if (draft) {
      setSelections(draft.selections ?? initSelections(claim))
    } else {
      setSelections(initSelections(claim))
    }
  }, [claim, id])

  // Persist on every change
  useEffect(() => {
    if (!initializedRef.current) return
    saveDraft(id, { selections })
  }, [selections, id])

  function updateSelection(receiptId, patch) {
    setSelections((prev) => ({
      ...prev,
      [receiptId]: { ...prev[receiptId], ...patch },
    }))
  }

  async function handleReplaceReceiptImage(img, receiptId, file) {
    setReplacingImages((prev) => ({ ...prev, [img.id]: true }))
    try {
      await replaceReceiptImage({ receiptId, imageId: img.id, file })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
    } catch {
      alert('Failed to update image. Please try again.')
    } finally {
      setReplacingImages((prev) => ({ ...prev, [img.id]: false }))
    }
  }

  async function handleReplaceBtImage(img, btId, file) {
    setReplacingImages((prev) => ({ ...prev, [img.id]: true }))
    try {
      await replaceBankTransactionImage({ btId, imageId: img.id, file })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
    } catch {
      alert('Failed to update image. Please try again.')
    } finally {
      setReplacingImages((prev) => ({ ...prev, [img.id]: false }))
    }
  }

  async function handleReplaceRefundImage(ref, btId, oldFileId, file) {
    const replacementKey = `${ref.id}:${oldFileId}`
    setReplacingImages((prev) => ({ ...prev, [replacementKey]: true }))
    try {
      await replaceBtRefundFile({ btId, refundId: ref.id, oldFileId, file })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
    } catch {
      alert('Failed to update image. Please try again.')
    } finally {
      setReplacingImages((prev) => ({ ...prev, [replacementKey]: false }))
    }
  }

  async function handleSaveClaimDetails(patch) {
    setSavingClaimDetails(true)
    try {
      await updateClaim({ id, ...patch })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
      return true
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : err?.message || 'Unknown error'
      alert(`Claim update failed: ${msg}`)
      return false
    } finally {
      setSavingClaimDetails(false)
    }
  }

  async function handleSaveReceiptDetails(receiptId, patch) {
    setSavingReceiptDetails((prev) => ({ ...prev, [receiptId]: true }))
    try {
      await updateReceipt({ id: receiptId, confirm_category_change: true, ...patch })
      if ('amount' in patch || 'claimed_amount' in patch) {
        const updatedReceipts = (claim.receipts ?? []).map((receipt) =>
          receipt.id === receiptId ? { ...receipt, ...patch } : receipt
        )
        const total = updatedReceipts.reduce(
          (sum, receipt) => sum + Number(receipt.claimed_amount ?? receipt.amount ?? 0),
          0
        )
        await updateClaim({ id, total_amount: total })
      }
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
      return true
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : err?.message || 'Unknown error'
      alert(`Receipt update failed: ${msg}`)
      return false
    } finally {
      setSavingReceiptDetails((prev) => ({ ...prev, [receiptId]: false }))
    }
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

  async function handleReject(comment) {
    setRejecting(true)
    try {
      await rejectReview({ claimId: id, comment })
      clearDraft(id)
      navigate(`/claims/${id}`)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : err?.message || 'Unknown error'
      alert(`Rejection failed: ${msg}`)
    } finally {
      setRejecting(false)
    }
  }

  async function handleApprove() {
    const readiness = getClaimReadiness({ ...claim, receipts, bank_transactions: bankTransactions })
    if (readiness.blockers.length > 0) {
      alert(readiness.blockers.map((issue) => issue.issue).join('\n'))
      return
    }
    const missingCategories = receipts.filter((r) => !selections[r.id]?.category)
    if (missingCategories.length > 0) {
      alert(`Fill category for ${missingCategories.length} receipt(s) before approving.`)
      return
    }
    if (!window.confirm('Approve this claim and send the confirmation email?')) return

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

  // Mobile approval workspace
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
      <ApprovalWorkspace
        claim={claim}
        receipts={receipts}
        bankTransactions={bankTransactions}
        selections={selections}
        onUpdateSelection={updateSelection}
        onSaveClaimDetails={handleSaveClaimDetails}
        savingClaimDetails={savingClaimDetails}
        onSaveReceiptDetails={handleSaveReceiptDetails}
        savingReceiptDetails={savingReceiptDetails}
        onApprove={handleApprove}
        onBack={() => navigate(`/claims/${id}`)}
        onReject={() => setShowRejectModal(true)}
        approving={approving}
        onReplaceReceiptImage={handleReplaceReceiptImage}
        onReplaceBtImage={handleReplaceBtImage}
        onReplaceRefundImage={handleReplaceRefundImage}
        replacingImages={replacingImages}
      />
    </>
  )
}
