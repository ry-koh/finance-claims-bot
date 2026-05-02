import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useClaim, useUpdateClaim, useDeleteClaim, CLAIM_KEYS } from '../api/claims'
import { useGenerateDocuments, useCompileDocuments, useUploadScreenshot } from '../api/documents'
import { useSendEmail, useResendEmail } from '../api/email'
import { useCreateReceipt, useUpdateReceipt, useDeleteReceipt, uploadReceiptImage } from '../api/receipts'
import {
  createBankTransaction, uploadBankTransactionImage, updateBankTransaction, createBtRefund,
  useDeleteBankTransaction, useDeleteBtRefund,
} from '../api/bankTransactions'
import { WBS_ACCOUNTS, CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_ORDER = [
  'draft',
  'email_sent',
  'screenshot_pending',
  'screenshot_uploaded',
  'docs_generated',
  'compiled',
  'submitted',
  'reimbursed',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function statusIndex(status) {
  const idx = STATUS_ORDER.indexOf(status)
  return idx === -1 ? -1 : idx
}

function driveUrl(id) {
  return `https://drive.google.com/file/d/${id}/view`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner({ small }) {
  const size = small ? 'w-4 h-4 border-2' : 'w-5 h-5 border-2'
  return (
    <span
      className={`${size} border-current border-t-transparent rounded-full animate-spin inline-block`}
    />
  )
}

function ActionButton({ onClick, disabled, loading, children, variant = 'primary', className = '' }) {
  const base = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'
  const variants = {
    primary: 'bg-blue-600 text-white active:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-700 active:bg-gray-200',
    danger: 'bg-red-600 text-white active:bg-red-700',
    warning: 'bg-amber-500 text-white active:bg-amber-600',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

// Vertical stepper pipeline
function StatusPipeline({ claim, onAction }) {
  const displayStatus = claim.status === 'error' ? 'screenshot_uploaded' : claim.status
  const currentIdx = statusIndex(displayStatus)

  const steps = [
    {
      label: 'Email',
      description: 'Send email to treasurer',
      doneAt: 'email_sent',
      activeAt: ['draft'],
      render: ({ isDone, isCurrent }) => (
        <div className="flex items-center gap-2 flex-wrap">
          {isDone && (
            <ActionButton
              variant="secondary"
              onClick={() => onAction('resend')}
              loading={onAction.loading?.resend}
            >
              Resend
            </ActionButton>
          )}
          {isCurrent && displayStatus === 'draft' && (
            <ActionButton
              onClick={() => onAction('send')}
              loading={onAction.loading?.send}
            >
              Send Email
            </ActionButton>
          )}
        </div>
      ),
    },
    {
      label: 'Screenshot',
      description: 'Upload email screenshot',
      doneAt: 'screenshot_uploaded',
      activeAt: ['email_sent', 'screenshot_pending'],
      render: ({ isCurrent }) =>
        isCurrent ? (
          <ScreenshotUploadButton claimId={claim.id} onAction={onAction} />
        ) : null,
    },
    {
      label: 'Documents',
      description: 'Generate claim documents',
      doneAt: 'docs_generated',
      activeAt: ['screenshot_uploaded', 'docs_generated'],
      render: ({ isCurrent }) =>
        isCurrent ? (
          <ActionButton
            onClick={() => onAction('generate')}
            loading={onAction.loading?.generate}
          >
            Generate Docs
          </ActionButton>
        ) : null,
    },
    {
      label: 'Compile PDF',
      description: 'Compile into single PDF',
      doneAt: 'compiled',
      activeAt: ['docs_generated'],
      render: ({ isCurrent }) =>
        isCurrent ? (
          <ActionButton
            onClick={() => onAction('compile')}
            loading={onAction.loading?.compile}
          >
            Compile PDF
          </ActionButton>
        ) : null,
    },
    {
      label: 'Submitted',
      description: 'Mark claim as submitted',
      doneAt: 'submitted',
      activeAt: ['compiled'],
      render: ({ isCurrent }) =>
        isCurrent ? (
          <ActionButton
            variant="warning"
            onClick={() => onAction('submit')}
            loading={onAction.loading?.submit}
          >
            Mark Submitted
          </ActionButton>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, idx) => {
        const doneIdx = statusIndex(step.doneAt)
        const isDone = currentIdx >= doneIdx && doneIdx !== -1
        const isCurrent = step.activeAt.includes(displayStatus)
        const isLocked = !isDone && !isCurrent

        return (
          <div key={step.label} className="flex gap-3 relative">
            {/* Vertical line */}
            {idx < steps.length - 1 && (
              <div
                className={`absolute left-[15px] top-[28px] w-0.5 h-full -z-0 ${
                  isDone ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            )}

            {/* Icon */}
            <div
              className={`relative z-10 mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                isDone
                  ? 'bg-green-500 text-white'
                  : isCurrent
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isDone ? '✓' : idx + 1}
            </div>

            {/* Content */}
            <div className="flex-1 pb-5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p
                    className={`text-sm font-semibold leading-tight ${
                      isLocked ? 'text-gray-400' : 'text-gray-800'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className={`text-xs mt-0.5 ${isLocked ? 'text-gray-300' : 'text-gray-500'}`}>
                    {step.description}
                  </p>
                </div>
                <div className="mt-0.5">
                  {step.render({ isDone, isCurrent, isLocked })}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Screenshot upload — plain file input
function ScreenshotUploadButton({ claimId, onAction }) {
  const fileRef = useRef(null)
  return (
    <>
      <ActionButton
        onClick={() => fileRef.current?.click()}
        loading={onAction.loading?.screenshot}
      >
        Upload Screenshot
      </ActionButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onAction('screenshot', file)
        }}
      />
    </>
  )
}

// Tag input for other_emails
function TagInput({ value = [], onChange }) {
  const [input, setInput] = useState('')

  function addTag(raw) {
    const tag = raw.trim()
    if (!tag) return
    if (!value.includes(tag)) onChange([...value, tag])
    setInput('')
  }

  function removeTag(tag) {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div className="flex flex-wrap gap-1 p-2 border border-gray-300 rounded-lg min-h-[40px] bg-white">
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-blue-500 hover:text-blue-700 leading-none"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="email"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addTag(input)
          }
          if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => addTag(input)}
        placeholder={value.length === 0 ? 'Add email, press Enter' : ''}
        className="flex-1 min-w-[120px] outline-none text-sm bg-transparent"
      />
    </div>
  )
}

// ─── BtModal ──────────────────────────────────────────────────────────────────

function BtModal({ claimId, initial, onClose, onSaved }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount ?? '') : '')
  const [btImages, setBtImages] = useState([]) // queued File objects
  const [refunds, setRefunds] = useState([]) // [{ amount: '', file: null, uploading: false }]
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  function addRefund() {
    setRefunds((prev) => [...prev, { amount: '', file: null, uploading: false }])
  }

  function removeRefund(idx) {
    setRefunds((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateRefund(idx, patch) {
    setRefunds((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErr('Enter a valid amount.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      let btId
      if (initial) {
        await updateBankTransaction({ btId: initial.id, amount: Number(amount) })
        btId = initial.id
      } else {
        const created = await createBankTransaction({ claimId, amount: Number(amount) })
        btId = created.id
      }

      for (const file of btImages) {
        await uploadBankTransactionImage({ btId, file })
      }

      for (const refund of refunds) {
        if (!refund.amount || !refund.file) continue
        await createBtRefund({ btId, amount: Number(refund.amount), file: refund.file })
      }

      onSaved()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to save bank transaction.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="bg-white w-full max-w-lg rounded-t-2xl shadow-xl p-5 pb-8 flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">
            {initial ? 'Edit Bank Transaction' : 'New Bank Transaction'}
          </p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {err && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</p>
        )}

        {/* Amount */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount *</label>
          <input
            className={inputCls}
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {/* BT Images */}
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Bank Screenshots</p>
          {btImages.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {btImages.map((file, i) => (
                <div key={i} className="flex items-center gap-1 bg-gray-100 rounded px-2 py-0.5 text-xs">
                  <span className="text-gray-700 truncate max-w-[120px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setBtImages((prev) => prev.filter((_, j) => j !== i))}
                    className="text-red-400 ml-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1 cursor-pointer text-xs text-blue-600 font-medium">
            <input
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
              className="hidden"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) setBtImages((prev) => [...prev, ...files])
              }}
            />
            + Add screenshot
          </label>
        </div>

        {/* Refunds */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-600">Refunds</p>
            <button
              type="button"
              onClick={addRefund}
              className="text-xs text-blue-600 font-medium"
            >
              + Add Refund
            </button>
          </div>
          {refunds.map((refund, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1.5">
              <input
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-24"
                type="number"
                placeholder="Amount"
                value={refund.amount}
                onChange={(e) => updateRefund(idx, { amount: e.target.value })}
              />
              <label className="flex items-center gap-1 cursor-pointer text-xs text-blue-600 font-medium flex-1 truncate">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) updateRefund(idx, { file })
                  }}
                />
                {refund.uploading ? <Spinner small /> : (refund.file ? refund.file.name : '+ File')}
              </label>
              <button
                type="button"
                onClick={() => removeRefund(idx)}
                className="text-red-400 text-sm"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Spinner small />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-2 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BtCard ───────────────────────────────────────────────────────────────────

function BtCard({
  bt, btIndex, claimId, linkedReceipts, expanded, onToggle, onEdit, onDelete, onAddReceipt,
  saving, addingReceipt, onReceiptSaved, onReceiptCancelled, onEditReceipt, onDeleteReceipt, receiptSaving,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const netAmount = bt.net_amount != null ? bt.net_amount : bt.amount
  const receiptSum = linkedReceipts.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const tally = Math.abs((netAmount ?? 0) - receiptSum) < 0.005

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="text-gray-400 text-xs">{expanded ? '▼' : '▶'}</span>
        <span className="flex-1 text-xs font-semibold text-gray-700">
          Bank Tx {btIndex}
          {bt.amount != null && ` · ${formatAmount(bt.amount)}`}
          {netAmount != null && bt.refunds?.length > 0 && ` · net ${formatAmount(netAmount)}`}
          {` · ${bt.images?.length ?? 0} img`}
        </span>
        <span className={`text-xs font-semibold ${tally ? 'text-green-600' : 'text-amber-500'}`}>
          {tally ? '✓' : '⚠'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 py-2.5 flex flex-col gap-2">
          {/* Images row */}
          {bt.images?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {bt.images.map((img, i) => (
                <a
                  key={img.id}
                  href={driveUrl(img.drive_file_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 underline"
                >
                  Screenshot {i + 1}
                </a>
              ))}
            </div>
          )}

          {/* Refunds row */}
          {bt.refunds?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {bt.refunds.map((ref, i) => (
                <span key={ref.id ?? i} className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  Refund {i + 1}: {formatAmount(ref.amount)}
                  {ref.drive_file_id && (
                    <a href={driveUrl(ref.drive_file_id)} target="_blank" rel="noreferrer"
                      className="ml-1 text-blue-600 underline">file</a>
                  )}
                </span>
              ))}
            </div>
          )}

          {(bt.images?.length > 0 || bt.refunds?.length > 0) && (
            <div className="border-t border-gray-100" />
          )}

          {/* Linked receipts */}
          <div className="flex flex-col">
            {linkedReceipts.map((r) => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                claimId={claimId}
                onEdit={(fields) => onEditReceipt(r, fields)}
                onDelete={() => onDeleteReceipt(r)}
                saving={receiptSaving}
              />
            ))}
            {!linkedReceipts.length && !addingReceipt && (
              <p className="text-xs text-gray-400 py-1">No receipts linked</p>
            )}
          </div>

          {/* Inline add receipt form */}
          {addingReceipt && (
            <ReceiptInlineForm
              bankTransactionId={bt.id}
              onSave={onReceiptSaved}
              onCancel={onReceiptCancelled}
              saving={receiptSaving}
              claimId={claimId}
            />
          )}

          {/* Footer actions */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            {!addingReceipt && (
              <button
                type="button"
                onClick={onAddReceipt}
                className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg bg-blue-50"
              >
                + Add Receipt
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="text-xs text-gray-600 font-medium px-2 py-1 rounded-lg bg-gray-100"
            >
              Edit
            </button>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg bg-red-50"
              >
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { onDelete(); setConfirmDelete(false) }}
                  disabled={saving}
                  className="text-xs bg-red-600 text-white font-medium px-2 py-1 rounded-lg disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Spinner small />}
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs bg-gray-100 text-gray-700 font-medium px-2 py-1 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClaimDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Queries
  const { data: claim, isLoading, isError, refetch } = useClaim(id)

  // Mutations
  const sendEmailMut = useSendEmail()
  const resendEmailMut = useResendEmail()
  const uploadScreenshotMut = useUploadScreenshot()
  const generateDocsMut = useGenerateDocuments()
  const compileDocsMut = useCompileDocuments()
  const updateClaimMut = useUpdateClaim()
  const deleteClaimMut = useDeleteClaim()
  const createReceiptMut = useCreateReceipt()
  const updateReceiptMut = useUpdateReceipt()
  const deleteReceiptMut = useDeleteReceipt()
  const deleteBtMut = useDeleteBankTransaction(id)

  // UI state
  const [editMode, setEditMode] = useState(false)
  const [editFields, setEditFields] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [staleDocsWarning, setStaleDocsWarning] = useState(false)
  const [actionError, setActionError] = useState(null)

  // BT + receipt UX state
  const [expandedBtId, setExpandedBtId] = useState(null)
  const [showBtModal, setShowBtModal] = useState(false)
  const [editingBt, setEditingBt] = useState(null)
  const [addingReceiptForBtId, setAddingReceiptForBtId] = useState(null)
  const [showAddUnlinked, setShowAddUnlinked] = useState(false)

  // Loading map passed to pipeline
  const loadingMap = {
    send: sendEmailMut.isPending,
    resend: resendEmailMut.isPending,
    screenshot: uploadScreenshotMut.isPending,
    generate: generateDocsMut.isPending,
    compile: compileDocsMut.isPending,
    submit: updateClaimMut.isPending,
  }

  function invalidateClaim() {
    queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
  }

  // Action dispatcher
  function handleAction(type, payload) {
    setActionError(null)

    const errHandler = (err) => {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        'Action failed. Please try again.'
      setActionError(msg)
    }

    if (type === 'send') {
      sendEmailMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'resend') {
      resendEmailMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'screenshot') {
      uploadScreenshotMut.mutate(
        { claimId: id, file: payload },
        { onSuccess: invalidateClaim, onError: errHandler }
      )
    } else if (type === 'generate') {
      generateDocsMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'compile') {
      compileDocsMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'submit') {
      updateClaimMut.mutate(
        { id, status: 'submitted' },
        { onSuccess: invalidateClaim, onError: errHandler }
      )
    }
  }

  // Attach loading map as property so pipeline can read it
  handleAction.loading = loadingMap

  // Edit mode
  function startEdit() {
    if (!claim) return
    setEditFields({
      claim_description: claim.claim_description ?? '',
      remarks: claim.remarks ?? '',
      date: claim.date ?? '',
      wbs_account: claim.wbs_account ?? '',
      transport_form_needed: claim.transport_form_needed ?? false,
      other_emails: claim.other_emails ?? [],
    })
    setEditMode(true)
  }

  function cancelEdit() {
    setEditMode(false)
    setEditFields({})
  }

  function handleSave() {
    updateClaimMut.mutate(
      { id, ...editFields },
      {
        onSuccess: (data) => {
          setEditMode(false)
          setEditFields({})
          const stale = data?.stale_documents ?? []
          if (stale.length > 0) setStaleDocsWarning(true)
          invalidateClaim()
        },
        onError: (err) => {
          const msg =
            err?.response?.data?.detail ||
            err?.message ||
            'Failed to save changes.'
          setActionError(msg)
        },
      }
    )
  }

  function handleDelete() {
    deleteClaimMut.mutate(
      { id },
      {
        onSuccess: () => navigate('/'),
        onError: (err) => {
          setShowDeleteConfirm(false)
          const msg =
            err?.response?.data?.detail ||
            err?.message ||
            'Failed to delete claim.'
          setActionError(msg)
        },
      }
    )
  }

  // ─── BT handler ─────────────────────────────────────────────────────────────

  function handleDeleteBt(btId) {
    deleteBtMut.mutate(btId, {
      onSuccess: invalidateClaim,
      onError: (err) => setActionError(err?.response?.data?.detail || 'Failed to delete bank transaction.'),
    })
  }

  // ─── Receipt helpers ─────────────────────────────────────────────────────────

  function recalcAndUpdateTotal(updatedReceipts) {
    const total = updatedReceipts.reduce((s, r) => s + Number(r.amount), 0)
    updateClaimMut.mutate({ id, total_amount: total }, { onSuccess: invalidateClaim })
  }

  function handleAddReceipt(fields) {
    createReceiptMut.mutate(
      { claim_id: id, ...fields },
      {
        onSuccess: () => {
          const updated = [...(claim.receipts ?? []), fields]
          recalcAndUpdateTotal(updated)
        },
        onError: (err) => setActionError(err?.response?.data?.detail || 'Failed to add receipt.'),
      }
    )
  }

  function handleEditReceipt(receipt, fields) {
    updateReceiptMut.mutate(
      { id: receipt.id, confirm_category_change: true, ...fields },
      {
        onSuccess: () => {
          const updated = (claim.receipts ?? []).map((r) =>
            r.id === receipt.id ? { ...r, ...fields } : r
          )
          recalcAndUpdateTotal(updated)
        },
        onError: (err) => setActionError(err?.response?.data?.detail || 'Failed to update receipt.'),
      }
    )
  }

  function handleDeleteReceipt(receipt) {
    deleteReceiptMut.mutate(receipt.id, {
      onSuccess: () => {
        const updated = (claim.receipts ?? []).filter((r) => r.id !== receipt.id)
        recalcAndUpdateTotal(updated)
      },
      onError: (err) => setActionError(err?.response?.data?.detail || 'Failed to delete receipt.'),
    })
  }

  // ─── Loading / error states ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    )
  }

  if (isError || !claim) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 px-4">
        <p className="text-gray-500 text-sm text-center">Failed to load claim.</p>
        <button
          onClick={() => refetch()}
          className="text-sm text-blue-600 font-medium underline"
        >
          Try again
        </button>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const claimer = claim.claimer ?? {}
  const cca = claimer.cca ?? {}
  const portfolio = cca.portfolio ?? {}
  const showErrorBanner = claim.status === 'error' && !errorDismissed

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-6">
      {/* ── Header ── */}
      <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-100 sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 active:bg-gray-200 shrink-0"
            aria-label="Back"
          >
            ←
          </button>

          <h1 className="flex-1 text-sm font-semibold text-gray-900 truncate">
            {claim.reference_code ?? `Claim #${claim.claim_number ?? id}`}
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            {!editMode ? (
              <button
                onClick={startEdit}
                className="text-xs font-medium text-blue-600 px-2 py-1 rounded-lg bg-blue-50 active:bg-blue-100"
              >
                Edit
              </button>
            ) : null}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={editMode}
              className="text-xs font-medium text-red-600 px-2 py-1 rounded-lg bg-red-50 active:bg-red-100 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 flex flex-col gap-4">
        {/* ── Error banner (claim.status === 'error') ── */}
        {showErrorBanner && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Error</p>
              <p className="text-xs text-red-600 mt-0.5">
                {claim.error_message || 'An error occurred with this claim.'}
              </p>
              <div className="mt-2">
                <ActionButton
                  variant="danger"
                  onClick={() => handleAction('generate')}
                  loading={handleAction.loading?.generate}
                >
                  Retry: Generate Documents
                </ActionButton>
              </div>
            </div>
            <button
              onClick={() => setErrorDismissed(true)}
              className="text-red-400 hover:text-red-600 text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Action error banner ── */}
        {actionError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="flex-1 text-xs text-red-600">{actionError}</p>
            <button
              onClick={() => setActionError(null)}
              className="text-red-400 hover:text-red-600 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Stale documents warning ── */}
        {staleDocsWarning && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="flex-1 text-xs text-amber-700 font-medium">
              Documents are outdated and need to be regenerated.
            </p>
            <button
              onClick={() => setStaleDocsWarning(false)}
              className="text-amber-400 hover:text-amber-600 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Claim info card ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Claim Info</h2>
            {editMode && (
              <div className="flex gap-2">
                <ActionButton
                  variant="secondary"
                  onClick={cancelEdit}
                  disabled={updateClaimMut.isPending}
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  onClick={handleSave}
                  loading={updateClaimMut.isPending}
                >
                  Save
                </ActionButton>
              </div>
            )}
          </div>

          {editMode ? (
            <div className="flex flex-col gap-3">
              {/* Description */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editFields.claim_description}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, claim_description: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={editFields.remarks}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, remarks: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={editFields.date}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, date: e.target.value }))
                  }
                  className="w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* WBS Account */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">WBS Account</label>
                <select
                  value={editFields.wbs_account}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, wbs_account: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                >
                  {WBS_ACCOUNTS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Transport form needed */}
              <div className="flex items-center gap-2">
                <input
                  id="transport_needed"
                  type="checkbox"
                  checked={editFields.transport_form_needed}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, transport_form_needed: e.target.checked }))
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="transport_needed" className="text-sm text-gray-700">
                  Transport form needed
                </label>
              </div>

              {/* Other emails */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Other Emails</label>
                <TagInput
                  value={editFields.other_emails}
                  onChange={(val) =>
                    setEditFields((f) => ({ ...f, other_emails: val }))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <InfoRow label="Claimer" value={claimer.name ?? '—'} />
              <InfoRow
                label="CCA / Portfolio"
                value={
                  cca.name
                    ? `${cca.name}${portfolio.name ? ` / ${portfolio.name}` : ''}`
                    : '—'
                }
              />
              <InfoRow label="Total Amount" value={formatAmount(claim.total_amount)} bold />
              <InfoRow label="Date" value={formatDate(claim.date)} />
              <InfoRow label="WBS Account" value={claim.wbs_account ?? '—'} />
              <InfoRow label="WBS No." value={claim.wbs_no ?? '—'} />
              <InfoRow label="Description" value={claim.claim_description ?? '—'} />
              {claim.remarks && <InfoRow label="Remarks" value={claim.remarks} />}
              {claim.other_emails?.length > 0 && (
                <InfoRow
                  label="Other Emails"
                  value={claim.other_emails.join(', ')}
                />
              )}
              <InfoRow
                label="Transport Form"
                value={claim.transport_form_needed ? 'Yes' : 'No'}
              />
            </div>
          )}
        </div>

        {/* ── Status Pipeline ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Progress</h2>
          <StatusPipeline claim={claim} onAction={handleAction} />
        </div>

        {/* ── Bank Transactions ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Bank Transactions ({claim.bank_transactions?.length ?? 0})
            </h2>
            <button
              onClick={() => { setEditingBt(null); setShowBtModal(true) }}
              className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg bg-blue-50"
            >
              + Add
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {(claim.bank_transactions ?? []).map((bt, idx) => {
              const linked = (claim.receipts ?? []).filter(r => r.bank_transaction_id === bt.id)
              return (
                <BtCard
                  key={bt.id}
                  bt={bt}
                  btIndex={idx + 1}
                  claimId={id}
                  linkedReceipts={linked}
                  expanded={expandedBtId === bt.id}
                  onToggle={() => setExpandedBtId(expandedBtId === bt.id ? null : bt.id)}
                  onEdit={() => { setEditingBt(bt); setShowBtModal(true) }}
                  onDelete={() => handleDeleteBt(bt.id)}
                  onAddReceipt={() => setAddingReceiptForBtId(bt.id)}
                  saving={deleteBtMut.isPending}
                  addingReceipt={addingReceiptForBtId === bt.id}
                  onReceiptSaved={(fields) => {
                    handleAddReceipt({ ...fields, bank_transaction_id: bt.id })
                    setAddingReceiptForBtId(null)
                  }}
                  onReceiptCancelled={() => setAddingReceiptForBtId(null)}
                  onEditReceipt={handleEditReceipt}
                  onDeleteReceipt={handleDeleteReceipt}
                  receiptSaving={createReceiptMut.isPending || updateReceiptMut.isPending || deleteReceiptMut.isPending}
                />
              )
            })}
            {!(claim.bank_transactions?.length) && (
              <p className="text-xs text-gray-400 text-center py-2">No bank transactions</p>
            )}
          </div>
        </div>

        {/* ── Unlinked Receipts ── */}
        {(() => {
          const unlinked = (claim.receipts ?? []).filter(r => !r.bank_transaction_id)
          return (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Unlinked Receipts ({unlinked.length})
                </h2>
                {!showAddUnlinked && (
                  <button
                    onClick={() => setShowAddUnlinked(true)}
                    className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg bg-blue-50"
                  >
                    + Add
                  </button>
                )}
              </div>
              <div className="flex flex-col">
                {unlinked.map(r => (
                  <ReceiptRow
                    key={r.id}
                    receipt={r}
                    claimId={id}
                    onEdit={(fields) => handleEditReceipt(r, fields)}
                    onDelete={() => handleDeleteReceipt(r)}
                    saving={updateReceiptMut.isPending || deleteReceiptMut.isPending}
                  />
                ))}
                {!unlinked.length && !showAddUnlinked && (
                  <p className="text-xs text-gray-400 text-center py-2">No unlinked receipts</p>
                )}
              </div>
              {showAddUnlinked && (
                <ReceiptInlineForm
                  bankTransactionId={null}
                  onSave={(fields) => { handleAddReceipt(fields); setShowAddUnlinked(false) }}
                  onCancel={() => setShowAddUnlinked(false)}
                  saving={createReceiptMut.isPending}
                  claimId={id}
                />
              )}
            </div>
          )
        })()}

        {/* ── Documents ── */}
        {claim.documents?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Documents ({claim.documents.length})
            </h2>
            <div className="flex flex-col gap-2">
              {claim.documents.map((doc, idx) => (
                <DocumentRow key={doc.id ?? idx} doc={doc} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── BT Modal ── */}
      {showBtModal && (
        <BtModal
          claimId={id}
          initial={editingBt}
          onClose={() => { setShowBtModal(false); setEditingBt(null) }}
          onSaved={() => { setShowBtModal(false); setEditingBt(null); invalidateClaim() }}
        />
      )}

      {/* ── Delete confirmation dialog ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete Claim?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will soft-delete the claim. It can be restored later.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteClaimMut.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 active:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteClaimMut.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 text-white active:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteClaimMut.isPending && <Spinner small />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Small display helpers ────────────────────────────────────────────────────

function InfoRow({ label, value, bold }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-xs text-gray-400 pt-0.5">{label}</span>
      <span className={`flex-1 text-sm text-gray-800 ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  )
}

const EMPTY_RECEIPT_FIELDS = {
  description: '', amount: '', category: '', gst_code: 'IE',
  dr_cr: 'DR', receipt_no: '', company: '', date: '',
}

function ReceiptInlineForm({ initial, bankTransactionId, onSave, onCancel, saving, claimId }) {
  const [f, setF] = useState({ ...EMPTY_RECEIPT_FIELDS, ...initial })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const [err, setErr] = useState({})

  const [receiptImageDriveIds, setReceiptImageDriveIds] = useState(initial?.receipt_image_drive_ids ?? [])
  const [uploadingReceiptImg, setUploadingReceiptImg] = useState(false)

  async function handleReceiptImageFile(file) {
    if (!claimId) return
    setUploadingReceiptImg(true)
    try {
      const data = await uploadReceiptImage({ file, claim_id: claimId, image_type: 'receipt' })
      setReceiptImageDriveIds(prev => [...prev, data.drive_file_id])
    } catch(e) {
      // silent fail — user can retry
    } finally {
      setUploadingReceiptImg(false)
    }
  }

  function handleSave() {
    const e = {}
    if (!f.description.trim()) e.description = 'Required'
    if (!f.amount || isNaN(Number(f.amount)) || Number(f.amount) <= 0) e.amount = 'Enter valid amount'
    if (!f.category) e.category = 'Required'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({
      ...f,
      amount: Number(f.amount),
      receipt_image_drive_ids: receiptImageDriveIds,
      bank_transaction_id: bankTransactionId,
    })
  }

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'
  return (
    <div className="mt-2 pt-3 border-t border-gray-100 space-y-2">
      <p className="text-xs font-semibold text-gray-600">{initial ? 'Edit Receipt' : 'New Receipt'}</p>

      {/* Receipt Images — at the TOP */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Receipt Photos</p>
        {receiptImageDriveIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {receiptImageDriveIds.map((imgId, i) => (
              <div key={imgId} className="flex items-center gap-1 bg-gray-100 rounded px-2 py-0.5 text-xs">
                <a href={`https://drive.google.com/file/d/${imgId}/view`} target="_blank" rel="noreferrer" className="text-blue-600 underline">Photo {i+1}</a>
                <button type="button" onClick={() => setReceiptImageDriveIds(prev => prev.filter((_, j) => j !== i))} className="text-red-400 ml-1">×</button>
              </div>
            ))}
          </div>
        )}
        <label className="flex items-center gap-1 cursor-pointer text-xs text-blue-600 font-medium">
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
            className="hidden"
            disabled={uploadingReceiptImg || !claimId}
            onChange={e => { const file = e.target.files?.[0]; e.target.value=''; if(file) handleReceiptImageFile(file) }}
          />
          {uploadingReceiptImg ? 'Uploading…' : '+ Add receipt photo'}
        </label>
      </div>

      {/* Description */}
      <div>
        <input className={inputCls} placeholder="Description *" value={f.description} onChange={set('description')} />
        {err.description && <p className="text-xs text-red-500 mt-0.5">{err.description}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <input className={inputCls} type="number" placeholder="Amount *" value={f.amount} onChange={set('amount')} />
          {err.amount && <p className="text-xs text-red-500 mt-0.5">{err.amount}</p>}
        </div>
        <div>
          <select className={inputCls} value={f.category} onChange={set('category')}>
            <option value="">Category *</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {err.category && <p className="text-xs text-red-500 mt-0.5">{err.category}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={f.gst_code} onChange={set('gst_code')}>
          {GST_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={inputCls} value={f.dr_cr} onChange={set('dr_cr')}>
          {DR_CR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Receipt No." value={f.receipt_no} onChange={set('receipt_no')} />
        <input className={inputCls} placeholder="Company" value={f.company} onChange={set('company')} />
      </div>
      <div className="w-auto inline-block">
        <input
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-auto"
          type="date"
          value={f.date}
          onChange={set('date')}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="flex-1 bg-gray-100 text-gray-700 text-xs font-medium py-1.5 rounded disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReceiptRow({ receipt, onEdit, onDelete, saving, claimId }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <div className="py-2 border-b border-gray-50 last:border-0">
        <ReceiptInlineForm
          initial={{
            description: receipt.description ?? '',
            amount: String(receipt.amount ?? ''),
            category: receipt.category ?? '',
            gst_code: receipt.gst_code ?? 'IE',
            dr_cr: receipt.dr_cr ?? 'DR',
            receipt_no: receipt.receipt_no ?? '',
            company: receipt.company ?? '',
            date: receipt.date ?? '',
            receipt_image_drive_ids: receipt.images?.map(img => img.drive_file_id) ?? [],
          }}
          bankTransactionId={receipt.bank_transaction_id ?? null}
          onSave={(fields) => { onEdit(fields); setEditing(false) }}
          onCancel={() => setEditing(false)}
          saving={saving}
          claimId={claimId}
        />
      </div>
    )
  }

  return (
    <div className="py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-700">
            {receipt.receipt_no ? `#${receipt.receipt_no} — ` : ''}{receipt.description ?? 'Receipt'}
          </p>
          <p className="text-xs text-gray-500">
            {receipt.category ?? '—'} · {formatAmount(receipt.amount)}
            {receipt.company ? ` · ${receipt.company}` : ''}
          </p>
          <p className="text-xs text-gray-400">{receipt.gst_code} · {receipt.dr_cr}</p>
          {receipt.images?.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {receipt.images.length} receipt photo{receipt.images.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0 items-center">
          {receipt.receipt_image_drive_id && (
            <a href={driveUrl(receipt.receipt_image_drive_id)} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 underline">Receipt</a>
          )}
          <button onClick={() => setEditing(true)}
            className="text-xs text-blue-600 font-medium px-1.5 py-0.5 rounded hover:bg-blue-50">
            Edit
          </button>
          <button onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-500 font-medium px-1.5 py-0.5 rounded hover:bg-red-50">
            Del
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
          <p className="text-red-700 mb-2">Delete this receipt?</p>
          <div className="flex gap-2">
            <button onClick={() => { onDelete(); setConfirmDelete(false) }} disabled={saving}
              className="flex-1 bg-red-600 text-white rounded py-1 font-medium disabled:opacity-50">
              {saving ? '…' : 'Confirm'}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="flex-1 bg-gray-100 text-gray-700 rounded py-1 font-medium">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentRow({ doc }) {
  const typeLabel = (doc.document_type ?? doc.type ?? 'Document')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{typeLabel}</span>
      {doc.drive_file_id && (
        <a
          href={driveUrl(doc.drive_file_id)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 underline"
        >
          View
        </a>
      )}
    </div>
  )
}
