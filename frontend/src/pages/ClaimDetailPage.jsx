import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useClaim, useUpdateClaim, useDeleteClaim, CLAIM_KEYS } from '../api/claims'
import { useGenerateDocuments, useCompileDocuments, useUploadScreenshot } from '../api/documents'
import { useSendEmail, useResendEmail } from '../api/email'

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

const WBS_OPTIONS = ['SA', 'SU', 'SC', 'SO', 'SV']

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
  const currentIdx = statusIndex(claim.status)

  const steps = [
    {
      label: 'Email',
      description: 'Send email to treasurer',
      doneAt: 'email_sent',
      activeAt: ['draft', 'email_sent'],
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
          {isCurrent && claim.status === 'draft' && (
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
        const isCurrent = step.activeAt.includes(claim.status)
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

  // UI state
  const [editMode, setEditMode] = useState(false)
  const [editFields, setEditFields] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [staleDocsWarning, setStaleDocsWarning] = useState(false)
  const [actionError, setActionError] = useState(null)

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
              className="text-xs font-medium text-red-600 px-2 py-1 rounded-lg bg-red-50 active:bg-red-100"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
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
                  {WBS_OPTIONS.map((opt) => (
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

        {/* ── Receipts ── */}
        {claim.receipts?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Receipts ({claim.receipts.length})
            </h2>
            <div className="flex flex-col gap-2">
              {claim.receipts.map((r) => (
                <ReceiptRow key={r.id} receipt={r} />
              ))}
            </div>
          </div>
        )}

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

function ReceiptRow({ receipt }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
      <div className="flex-1">
        <p className="text-xs font-semibold text-gray-700">
          #{receipt.receipt_no} — {receipt.description ?? 'Receipt'}
        </p>
        <p className="text-xs text-gray-500">
          {receipt.category ?? '—'} · {formatAmount(receipt.amount)}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {receipt.receipt_image_drive_id && (
          <a
            href={driveUrl(receipt.receipt_image_drive_id)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 underline"
          >
            Receipt
          </a>
        )}
        {receipt.bank_screenshot_drive_id && (
          <a
            href={driveUrl(receipt.bank_screenshot_drive_id)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 underline"
          >
            Bank
          </a>
        )}
      </div>
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
