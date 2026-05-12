import { useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useClaim, useClaimEvents, useUpdateClaim, useDeleteClaim, useSubmitForReview, useRejectReview, useSubmitClaim, useReimburseClaim, CLAIM_KEYS } from '../api/claims'
import { useGenerateDocuments, useCompileDocuments, useUploadScreenshot, useUploadMfApproval, submitTransportData } from '../api/documents'
import { useSendEmail, useResendEmail } from '../api/email'
import { useCreateReceipt, useUpdateReceipt, useDeleteReceipt, uploadReceiptImage } from '../api/receipts'
import { useCreatePayer, useDeletePayer, usePayers, useUpdatePayer } from '../api/payers'
import {
  useAttachmentRequests,
  useRequestAttachment,
  useUploadAttachmentFile,
  useDeleteAttachmentFile,
  useSubmitAttachments,
  useAcceptAttachments,
  useRejectAttachments,
  useDownloadAttachmentFile,
} from '../api/attachmentRequests'
import {
  createBankTransaction, uploadBankTransactionImage, updateBankTransaction, createBtRefund,
  deleteBankTransactionImage, deleteBtRefund, updateBtRefundFile,
  useDeleteBankTransaction,
} from '../api/bankTransactions'
import { useIsFinanceTeam, useIsTreasurer } from '../context/AuthContext'
import { WBS_ACCOUNTS, CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'
import ReceiptUploader from '../components/ReceiptUploader'
import DragDropZone from '../components/DragDropZone'
import CroppableThumb from '../components/CroppableThumb'
import PayerSelect from '../components/PayerSelect'
import { IconChevronLeft, IconFileText } from '../components/Icons'
import { getClaimReadiness } from '../utils/claimReadiness'
import {
  getTreasurerProgressMessage,
  getTreasurerStatusKey,
  getTreasurerStatusMeta,
  TREASURER_STATUS_META,
} from '../utils/treasurerStatus'
import { DEFAULT_MAX_UPLOAD_BYTES } from '../utils/uploadLimits'
import { friendlyError } from '../utils/errors'
import { documentUrl, imageUrl } from '../api/images'

// ─── Transport trips input ───────────────────────────────────────────────────

const EMPTY_TRIP = { from: '', to: '', purpose: '', date: '', time: '', amount: '', distance_km: '' }

// DD/MM/YYYY → YYYY-MM-DD (returns '' if invalid)
function parseDMY(dmy) {
  if (!dmy) return ''
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

// YYYY-MM-DD → DD/MM/YYYY (for display when loading saved trips)
function formatDMY(ymd) {
  if (!ymd) return ''
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

// HH:MM (24-hour) → H:MM AM/PM (for display when loading old-format times)
function format24To12(hm) {
  if (!hm) return ''
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return hm
  const h = parseInt(m[1], 10)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m[2]} ${period}`
}

function TransportTripsInput({ trips, onChange }) {
  function addTrip() {
    if (trips.length >= 3) return
    onChange([...trips, { ...EMPTY_TRIP }])
  }
  function removeTrip(i) {
    onChange(trips.filter((_, idx) => idx !== i))
  }
  function updateTrip(i, field, value) {
    onChange(trips.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  }
  const inputCls = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300'

  return (
    <div className="space-y-3 bg-blue-50 rounded-xl p-3">
      <p className="text-xs font-medium text-blue-700">Transport Trips (max 3)</p>
      {trips.length === 0 && <p className="text-xs text-gray-400">No trips added yet.</p>}
      {trips.map((trip, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">Trip {i + 1}</span>
            <button type="button" onClick={() => removeTrip(i)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Date</label>
              <input type="text" value={trip.date} onChange={(e) => updateTrip(i, 'date', e.target.value)} placeholder="DD/MM/YYYY" inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Time Started</label>
              <input type="text" value={trip.time} onChange={(e) => updateTrip(i, 'time', e.target.value)} placeholder="9:30 AM" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">From</label>
              <input value={trip.from} onChange={(e) => updateTrip(i, 'from', e.target.value)} placeholder="Origin" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500">To</label>
              <input value={trip.to} onChange={(e) => updateTrip(i, 'to', e.target.value)} placeholder="Destination" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">Purpose</label>
            <input value={trip.purpose} onChange={(e) => updateTrip(i, 'purpose', e.target.value)} placeholder="Purpose of trip" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Amount ($)</label>
              <input type="number" step="0.01" min="0" value={trip.amount} onChange={(e) => updateTrip(i, 'amount', e.target.value)} placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Distance (km)</label>
              <input type="number" step="0.1" min="0" value={trip.distance_km} onChange={(e) => updateTrip(i, 'distance_km', e.target.value)} placeholder="0.0" className={inputCls} />
            </div>
          </div>
        </div>
      ))}
      {trips.length < 3 && (
        <button
          type="button"
          onClick={addTrip}
          className="w-full py-2 rounded-lg border border-dashed border-blue-400 text-blue-600 text-sm font-medium"
        >
          + Add Trip
        </button>
      )}
    </div>
  )
}

// ─── Error helper ────────────────────────────────────────────────────────────

function extractError(err, fallback = 'An error occurred.') {
  const friendly = friendlyError(err, fallback)
  if (friendly) return friendly
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d))).join('; ')
  }
  return err?.message || fallback
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_ORDER = [
  'draft',
  'pending_review',
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

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizePayer(option) {
  if (!option?.name || !option?.email) return null
  return {
    id: option.id,
    owner_treasurer_id: option.owner_treasurer_id,
    name: option.name,
    email: cleanEmail(option.email),
    is_self: Boolean(option.is_self),
    is_saved: Boolean(option.is_saved),
  }
}

function claimDefaultPayer(claim) {
  if (!claim) return null
  const name = claim.one_off_name || claim.claimer?.name
  const email = cleanEmail(claim.one_off_email || claim.claimer?.email)
  if (!name || !email) return null
  return {
    id: claim.claimer_id ? `self:${claim.claimer_id}` : `one-off:${email}`,
    name,
    email,
    is_self: true,
    is_saved: false,
  }
}

function uniquePayers(payers) {
  const seen = new Set()
  return payers
    .map(normalizePayer)
    .filter((payer) => {
      if (!payer) return false
      const key = `${cleanEmail(payer.email)}:${payer.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
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

// For documents: Drive file IDs (no '/') use a Google Drive URL; R2 paths (with '/') use backend proxy
function docUrl(fileId) {
  return documentUrl(fileId)
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

function LoadingBar({ tone = 'blue', className = '' }) {
  const tones = {
    blue: 'bg-blue-100 text-blue-600',
    gray: 'bg-gray-100 text-gray-500',
  }
  return (
    <div className={`h-1.5 w-full min-w-[180px] overflow-hidden rounded-full ${tones[tone]} ${className}`}>
      <div className="indeterminate-progress h-full w-1/2 rounded-full bg-current" />
    </div>
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

function ReadinessPanel({ claim }) {
  const readiness = getClaimReadiness(claim)
  if (!readiness.checks.length) return null

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Pre-Review Checks</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Use this to catch missing files before the receipt-by-receipt review.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          readiness.isReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {readiness.isReady ? 'Ready' : `${readiness.missing.length} missing`}
        </span>
      </div>

      <div className="space-y-1.5">
        {readiness.checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              check.ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {check.ok ? '✓' : '!'}
            </span>
            <div className="min-w-0">
              <p className={check.ok ? 'text-gray-600' : 'font-medium text-amber-800'}>
                {check.ok ? check.label : check.issue}
              </p>
              {!check.ok && (
                <p className="text-gray-400">Still verify the actual receipt and bank transaction in the approval wizard.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TreasurerProgressPanel({ claim, onAction }) {
  const statusKey = getTreasurerStatusKey(claim)
  const meta = getTreasurerStatusMeta(claim)
  const message = getTreasurerProgressMessage(claim)
  const readiness = getClaimReadiness(claim)
  const blockingIssue = readiness.missing.find((check) =>
    ['evidence', 'receipt-images', 'bank-images', 'fx-screenshots'].includes(check.id)
  )
  const flow = ['draft', 'in_review', 'awaiting_submission', 'submitted', 'reimbursed']
  const flowKey = statusKey === 'needs_action' ? 'draft' : statusKey
  const currentIndex = Math.max(0, flow.indexOf(flowKey))

  return (
    <div className={`rounded-xl border p-4 ${meta.panel}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide opacity-75">Current Status</p>
          <h2 className="mt-0.5 text-base font-bold">{meta.label}</h2>
          {message && <p className="mt-1 text-sm opacity-90">{message}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>
          {meta.label}
        </span>
      </div>

      <div className="mb-3 space-y-1.5">
        {flow.map((key, idx) => {
          const stepMeta = TREASURER_STATUS_META[key]
          const active = key === flowKey
          const done = idx < currentIndex
          return (
            <div
              key={key}
              className={`treasurer-status-step flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold leading-tight ${
                active
                  ? 'treasurer-status-step-active shadow-sm'
                  : done
                  ? 'treasurer-status-step-done'
                  : 'treasurer-status-step-upcoming'
              }`}
            >
              <span className={`treasurer-status-step-dot flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                active ? 'treasurer-status-step-dot-active' : done ? 'treasurer-status-step-dot-done' : 'treasurer-status-step-dot-upcoming'
              }`}>
                {done ? 'OK' : idx + 1}
              </span>
              <span className="min-w-0 flex-1">{stepMeta.label}</span>
            </div>
          )
        })}
      </div>

      {claim.status === 'draft' && (
        <div className="space-y-2">
          {blockingIssue && (
            <p className="treasurer-status-warning rounded-lg px-2 py-1.5 text-xs font-medium">
              {blockingIssue.issue}
            </p>
          )}
          <ActionButton onClick={() => onAction('submitForReview')} loading={onAction.loading?.submitForReview}>
            Submit for Review
          </ActionButton>
        </div>
      )}
    </div>
  )
}

// Vertical stepper pipeline
function StatusPipeline({ claim, onAction, isTreasurer }) {
  const displayStatus =
    claim.status === 'error'
      ? 'screenshot_uploaded'
      : claim.status === 'attachment_requested' || claim.status === 'attachment_uploaded'
      ? 'submitted'
      : claim.status
  const currentIdx = statusIndex(displayStatus)

  const screenshotUploading = onAction.loading?.screenshot
  const isGeneratingOnServer = claim.error_message === '__generating__'
  // Docs are processing if: actively uploading screenshot, OR server sentinel is set
  const docsProcessing = screenshotUploading || isGeneratingOnServer

  const steps = [
    {
      label: 'Treasurer Submit Claim',
      description: 'Treasurer submits the claim for finance team review',
      doneAt: 'email_sent',
      activeAt: ['draft', 'pending_review'],
      render: ({ isCurrent }) => {
        if (!isTreasurer) return null
        if (isCurrent && displayStatus === 'draft') {
          return (
            <ActionButton onClick={() => onAction('submitForReview')} loading={onAction.loading?.submitForReview}>
              Submit for Review
            </ActionButton>
          )
        }
        if (isCurrent && displayStatus === 'pending_review') {
          return (
            <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-1 rounded-lg">
              Pending review
            </span>
          )
        }
        return null
      },
    },
    {
      label: 'Email',
      description: 'Confirmation email sent to treasurer once approved',
      doneAt: 'email_sent',
      activeAt: ['draft', 'pending_review'],
      render: ({ isDone, isCurrent }) => (
        <div className="flex flex-col items-start gap-1.5">
          {!isTreasurer && isCurrent && displayStatus === 'draft' && (
            <ActionButton onClick={() => onAction('send')} loading={onAction.loading?.send}>
              Send Email
            </ActionButton>
          )}
          {!isTreasurer && isDone && (
            <ActionButton variant="secondary" onClick={() => onAction('resend')} loading={onAction.loading?.resend}>
              Resend
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
      render: ({ isDone, isCurrent }) => (
        <div className="flex flex-col items-start gap-1">
          {!isTreasurer && isCurrent && <ScreenshotUploadButton claimId={claim.id} onAction={onAction} />}
          {!isTreasurer && isDone && <ScreenshotUploadButton claimId={claim.id} onAction={onAction} variant="secondary" />}
        </div>
      ),
    },
    {
      label: 'Documents',
      description: 'Generate claim documents',
      doneAt: 'docs_generated',
      activeAt: ['screenshot_uploaded', 'docs_generated'],
      render: ({ isDone, isCurrent }) => {
        if (docsProcessing) {
          return (
            <div className="flex w-full max-w-[260px] flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Spinner small />
                <span className="text-xs font-medium text-gray-600">Preparing documents...</span>
              </div>
              <LoadingBar />
              <p className="text-xs text-gray-400">Usually takes 1-3 minutes. Keep this page open.</p>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-start gap-1.5">
            {!isTreasurer && isCurrent && !isDone && (
              <ActionButton onClick={() => onAction('generate')} loading={onAction.loading?.generate}>
                Generate Docs
              </ActionButton>
            )}
            {!isTreasurer && isDone && (
              <ActionButton variant="secondary" onClick={() => onAction('generate')} loading={onAction.loading?.generate}>
                Regenerate
              </ActionButton>
            )}
          </div>
        )
      },
    },
    {
      label: 'Compile PDF',
      description: 'Compile into single PDF',
      doneAt: 'compiled',
      activeAt: ['docs_generated'],
      render: ({ isDone, isCurrent }) => {
        if (docsProcessing) {
          return (
            <div className="flex w-full max-w-[240px] flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Spinner small />
                <span className="text-xs text-gray-400">Queued after generation</span>
              </div>
              <LoadingBar tone="gray" />
            </div>
          )
        }
        return (
          <div className="flex flex-col items-start gap-1.5">
            {!isTreasurer && isCurrent && !isDone && (
              <ActionButton onClick={() => onAction('compile')} loading={onAction.loading?.compile}>
                Compile PDF
              </ActionButton>
            )}
            {!isTreasurer && isDone && (
              <ActionButton variant="secondary" onClick={() => onAction('compile')} loading={onAction.loading?.compile}>
                Recompile
              </ActionButton>
            )}
          </div>
        )
      },
    },
    {
      label: 'Submitted',
      description: 'Mark claim as submitted',
      doneAt: 'submitted',
      activeAt: ['compiled'],
      render: ({ isCurrent }) =>
        isCurrent && !isTreasurer ? (
          <ActionButton variant="warning" onClick={() => onAction('submit')} loading={onAction.loading?.submit}>
            Mark Submitted
          </ActionButton>
        ) : null,
    },
    {
      label: 'Reimbursed',
      description: 'Mark claim as reimbursed',
      doneAt: 'reimbursed',
      activeAt: ['submitted'],
      render: ({ isCurrent }) =>
        isCurrent && !isTreasurer ? (
          <ActionButton variant="warning" onClick={() => onAction('reimburse')} loading={onAction.loading?.reimburse}>
            Mark Reimbursed
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

// Screenshot upload — drag-drop zone
function ScreenshotUploadButton({ claimId, onAction, variant = 'primary' }) {
  const loading = onAction.loading?.screenshot
  return (
    <div className="flex flex-col gap-1 w-full">
      <DragDropZone
        label={variant === 'secondary' ? 'Re-upload Screenshot' : 'Upload Screenshot'}
        onFiles={(files) => onAction('screenshot', files)}
        multiple
        loading={loading}
        compact
        withCrop
        maxTotalBytes={DEFAULT_MAX_UPLOAD_BYTES}
      />
      {loading && (
        <div className="w-full max-w-[260px] space-y-1.5">
          <LoadingBar />
          <p className="text-xs text-gray-500">Uploading and generating documents. This may take 1-3 minutes.</p>
        </div>
      )}
    </div>
  )
}

// MF Approval screenshot upload — drag-drop zone
function MfApprovalUpload({ claim, onUploaded }) {
  const upload = useUploadMfApproval()
  // Support both old single-ID field and new array field
  const approvalIds = claim.mf_approval_drive_ids?.length
    ? claim.mf_approval_drive_ids
    : claim.mf_approval_drive_id
      ? [claim.mf_approval_drive_id]
      : []

  async function handleFile(file) {
    try {
      await upload.mutateAsync({ claimId: claim.id, file })
      onUploaded()
    } catch {}
  }

  async function handleFiles(files) {
    for (const file of files) {
      try { await upload.mutateAsync({ claimId: claim.id, file }) } catch {}
    }
    onUploaded()
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
      <h2 className="text-sm font-semibold text-amber-700 mb-2">Master's Fund Approval</h2>
      {approvalIds.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {approvalIds.map((id, i) => (
            <CroppableThumb
              key={id}
              src={imageUrl(id)}
              label={`MF approval page ${i + 1}`}
              reuploading={upload.isPending}
              onCropped={handleFile}
            />
          ))}
          <p className="text-xs text-green-700 font-medium self-center">✓ Uploaded — tap to crop/rotate</p>
        </div>
      )}
      <DragDropZone
        label={approvalIds.length > 0 ? '+ Add more pages' : 'Upload Approval Screenshot'}
        onFiles={handleFiles}
        multiple
        loading={upload.isPending}
        dragBorder="border-amber-400 bg-amber-50"
        idleBorder="border-amber-300 bg-amber-50 hover:bg-amber-100"
        withCrop
      />
    </div>
  )
}

function LegacyEmailPillInput({ value = [], onChange }) {
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

// ─── Fullscreen image viewer (read-only, no crop) ────────────────────────────

function FullscreenImageViewer({ src, onClose }) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black" onClick={onClose}>
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="text-white/70 text-sm font-medium px-2 py-1 active:text-white"
        >
          ✕ Close
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt="Attachment" className="max-w-full max-h-full object-contain rounded" />
      </div>
    </div>,
    document.body
  )
}

function ViewOnlyThumb({ src, label, thumbSize = 'w-24 h-24' }) {
  const [viewing, setViewing] = useState(false)
  return (
    <>
      {viewing && <FullscreenImageViewer src={src} onClose={() => setViewing(false)} />}
      <button
        type="button"
        onClick={() => setViewing(true)}
        className={`block ${thumbSize} rounded-lg overflow-hidden bg-gray-200 focus:outline-none active:opacity-75 relative`}
        title="Tap to view"
      >
        <img src={src} alt={label} className="w-full h-full object-cover" />
        <span
          className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] leading-none px-1 py-0.5 pointer-events-none select-none"
          style={{ borderBottomLeftRadius: '8px', borderTopRightRadius: '6px' }}
        >
          👁
        </span>
      </button>
    </>
  )
}

// ─── BtModal ──────────────────────────────────────────────────────────────────

function BtModal({ claimId, initial, onClose, onSaved }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(initial ? String(initial.amount ?? '') : '')
  const [btImages, setBtImages] = useState([]) // queued File objects
  const [refunds, setRefunds] = useState([]) // [{ amount: '', files: [], uploading: false }]
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState(null)
  const [existingImages, setExistingImages] = useState(initial?.images ?? [])
  const [existingRefunds, setExistingRefunds] = useState(initial?.refunds ?? [])
  const [reuploadingImageId, setReuploadingImageId] = useState(null)
  const [reuploadingRefundId, setReuploadingRefundId] = useState(null)

  const busy = saving || deleting

  function addRefund() {
    setRefunds((prev) => [...prev, { amount: '', files: [], uploading: false }])
  }

  function removeRefund(idx) {
    setRefunds((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateRefund(idx, patch) {
    setRefunds((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function handleDeleteExistingImage(imageId) {
    setDeleting(true)
    setErr(null)
    try {
      await deleteBankTransactionImage({ btId: initial.id, imageId })
      setExistingImages(prev => prev.filter(img => img.id !== imageId))
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch(e) {
      setErr('Failed to delete image. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteExistingRefund(refundId) {
    setDeleting(true)
    setErr(null)
    try {
      await deleteBtRefund({ btId: initial.id, refundId })
      setExistingRefunds(prev => prev.filter(r => r.id !== refundId))
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch(e) {
      setErr('Failed to delete refund. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleReuploadExistingRefund(refundId, croppedFile) {
    if (!initial?.id) return
    setReuploadingRefundId(refundId)
    try {
      const result = await updateBtRefundFile({ btId: initial.id, refundId, file: croppedFile })
      setExistingRefunds(prev => prev.map(r => r.id === refundId ? { ...r, drive_file_id: result.drive_file_id } : r))
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch {
      setErr('Failed to re-upload refund file. Please try again.')
    } finally {
      setReuploadingRefundId(null)
    }
  }

  async function handleReuploadExistingImage(imageId, croppedFile) {
    if (!initial?.id) return
    setReuploadingImageId(imageId)
    try {
      const uploaded = await uploadBankTransactionImage({ btId: initial.id, file: croppedFile })
      setExistingImages(prev => prev.map(img => img.id === imageId ? { ...img, drive_file_id: uploaded.drive_file_id } : img))
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch {
      setErr('Failed to re-upload image. Please try again.')
    } finally {
      setReuploadingImageId(null)
    }
  }

  async function handleSave() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErr('Enter a valid amount.')
      return
    }
    for (let i = 0; i < refunds.length; i++) {
      const r = refunds[i]
      if (r.amount && !r.files?.length) {
        setErr(`Refund #${i + 1} requires a file.`)
        return
      }
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
        if (!refund.amount || !refund.files?.length) continue
        await createBtRefund({ btId, amount: Number(refund.amount), files: refund.files })
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
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {/* BT Images */}
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Bank Screenshots</p>
          {(existingImages.length > 0 || btImages.length > 0) && (
            <div className="flex flex-wrap gap-3 mb-2">
              {existingImages.map(img => (
                <CroppableThumb
                  key={img.id}
                  src={imageUrl(img.drive_file_id)}
                  label="BT screenshot"
                  reuploading={reuploadingImageId === img.id}
                  onRemove={deleting ? undefined : () => handleDeleteExistingImage(img.id)}
                  onCropped={(f) => handleReuploadExistingImage(img.id, f)}
                />
              ))}
              {btImages.map((file, i) => (
                <CroppableThumb
                  key={i}
                  file={file}
                  label={file.name}
                  onRemove={() => setBtImages((prev) => prev.filter((_, j) => j !== i))}
                  onCropped={(f) => setBtImages((prev) => prev.map((x, j) => j === i ? f : x))}
                  onCroppedMany={(fs) => setBtImages((prev) => [...prev.slice(0, i), ...fs, ...prev.slice(i + 1)])}
                />
              ))}
            </div>
          )}
          <DragDropZone
            label="+ Add screenshot"
            onFiles={(files) => setBtImages((prev) => [...prev, ...files])}
            multiple
            compact
            withCrop
          />
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
          {existingRefunds.map(ref => (
            <div key={ref.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded p-1.5 mb-1">
              <span className="text-gray-700 shrink-0">${Number(ref.amount).toFixed(2)}</span>
              {ref.drive_file_id && (
                <CroppableThumb
                  src={imageUrl(ref.drive_file_id)}
                  label={`Refund $${Number(ref.amount).toFixed(2)}`}
                  reuploading={reuploadingRefundId === ref.id}
                  onCropped={(f) => handleReuploadExistingRefund(ref.id, f)}
                />
              )}
              <button type="button" disabled={deleting} onClick={() => handleDeleteExistingRefund(ref.id)} className="text-red-400 ml-auto disabled:opacity-40">×</button>
            </div>
          ))}
          {refunds.map((refund, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1.5">
              <input
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-24"
                type="number"
                inputMode="decimal"
                placeholder="Amount"
                value={refund.amount}
                onChange={(e) => updateRefund(idx, { amount: e.target.value })}
              />
              <div className="flex-1 min-w-0">
                {refund.files?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {refund.files.map((f, fi) => (
                      <CroppableThumb
                        key={fi}
                        file={f}
                        label={f.name}
                        onRemove={() => updateRefund(idx, { files: refund.files.filter((_, j) => j !== fi) })}
                        onCropped={(cf) => updateRefund(idx, { files: refund.files.map((x, j) => j === fi ? cf : x) })}
                        onCroppedMany={(cfs) => updateRefund(idx, { files: [...refund.files.slice(0, fi), ...cfs, ...refund.files.slice(fi + 1)] })}
                      />
                    ))}
                  </div>
                )}
                <DragDropZone
                  label="+ Attach File"
                  onFiles={(fs) => updateRefund(idx, { files: [...(refund.files ?? []), ...fs] })}
                  multiple
                  compact
                  withCrop
                />
              </div>
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
            disabled={busy}
            className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Spinner small />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
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
  isTreasurer, canEdit = true, isPartial,
  payerOptions, onCreatePayer, onUpdatePayer, onDeletePayer, canManagePayers, payersLoading,
}) {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reuploadingBtImg, setReuploadingBtImg] = useState(null)
  const [reuploadingRefundId, setReuploadingRefundId] = useState(null)

  async function handleReuploadBtImage(imgId, driveFileId, croppedFile) {
    setReuploadingBtImg(imgId)
    try {
      await uploadBankTransactionImage({ btId: bt.id, file: croppedFile })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch { /* silently ignore */ } finally {
      setReuploadingBtImg(null)
    }
  }

  async function handleReuploadRefund(refundId, croppedFile) {
    setReuploadingRefundId(refundId)
    try {
      await updateBtRefundFile({ btId: bt.id, refundId, file: croppedFile })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch { /* silently ignore */ } finally {
      setReuploadingRefundId(null)
    }
  }

  const netAmount = bt.net_amount != null ? bt.net_amount : bt.amount
  // BT reconciliation uses full receipt.amount (what was actually debited), not claimed_amount
  const receiptSum = linkedReceipts.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const tally = Math.abs((netAmount ?? 0) - receiptSum) < 0.005

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsed header — always visible, with BT edit/delete inline */}
      <div className="flex items-center gap-1 px-3 py-2 bg-gray-50">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          <span className="text-gray-400 text-xs shrink-0">{expanded ? '▼' : '▶'}</span>
          <span className="flex-1 text-xs font-semibold text-gray-700 truncate">
            Bank Tx {btIndex}
            {bt.amount != null && ` · ${formatAmount(bt.amount)}`}
            {netAmount != null && bt.refunds?.length > 0 && ` · net ${formatAmount(netAmount)}`}
            {` · ${bt.images?.length ?? 0} img`}
          </span>
          <span className={`text-xs font-semibold shrink-0 mr-1 ${tally ? 'text-green-600' : 'text-amber-500'}`}>
            {tally ? '✓' : '⚠'}
          </span>
        </button>
        {/* BT-level Edit / Delete — only shown when editing is permitted */}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={onEdit}
              disabled={saving}
              className="text-xs text-blue-600 font-medium px-1.5 py-0.5 rounded bg-blue-50 shrink-0 disabled:opacity-40"
            >
              Edit BT
            </button>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-500 font-medium px-1.5 py-0.5 rounded bg-red-50 shrink-0"
              >
                Del BT
              </button>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => { onDelete(); setConfirmDelete(false) }}
                  disabled={saving}
                  className="text-xs bg-red-600 text-white font-medium px-1.5 py-0.5 rounded disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs bg-gray-100 text-gray-700 font-medium px-1.5 py-0.5 rounded"
                >
                  No
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 py-2.5 flex flex-col gap-2">
          {/* Images row */}
          {bt.images?.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {bt.images.map((img) => (
                <CroppableThumb
                  key={img.id}
                  src={imageUrl(img.drive_file_id)}
                  label="BT screenshot"
                  reuploading={reuploadingBtImg === img.id}
                  onCropped={(f) => handleReuploadBtImage(img.id, img.drive_file_id, f)}
                />
              ))}
            </div>
          )}

          {/* Refunds row */}
          {bt.refunds?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {bt.refunds.map((ref, i) => (
                <div key={ref.id ?? i} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="bg-gray-100 px-2 py-0.5 rounded shrink-0">
                    Refund {i + 1}: {formatAmount(ref.amount)}
                  </span>
                  {ref.drive_file_id && (
                    <CroppableThumb
                      src={imageUrl(ref.drive_file_id)}
                      label={`Refund ${i + 1} file`}
                      reuploading={reuploadingRefundId === ref.id}
                      onCropped={(f) => handleReuploadRefund(ref.id, f)}
                    />
                  )}
                </div>
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
                isTreasurer={isTreasurer}
                canEdit={canEdit}
                isPartial={isPartial}
                payerOptions={payerOptions}
                onCreatePayer={onCreatePayer}
                onUpdatePayer={onUpdatePayer}
                onDeletePayer={onDeletePayer}
                canManagePayers={canManagePayers}
                payersLoading={payersLoading}
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
              isTreasurer={isTreasurer}
              isPartial={isPartial}
              payerOptions={payerOptions}
              onCreatePayer={onCreatePayer}
              onUpdatePayer={onUpdatePayer}
              onDeletePayer={onDeletePayer}
              canManagePayers={canManagePayers}
              payersLoading={payersLoading}
            />
          )}

          {/* Footer actions */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            {canEdit && !addingReceipt && (
              <button
                type="button"
                onClick={onAddReceipt}
                disabled={saving}
                className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg bg-blue-50 disabled:opacity-40"
              >
                + Add Receipt
              </button>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  disabled={saving}
                  className="text-xs text-gray-600 font-medium px-2 py-1 rounded-lg bg-gray-100 disabled:opacity-40"
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Claim Notes ─────────────────────────────────────────────────────────────

function ClaimNotesCard({
  claim,
  claimId,
  field,
  title,
  description,
  placeholder,
  emptyText = 'No notes yet',
  canEdit = true,
  tone = 'amber',
}) {
  const updateClaimMut = useUpdateClaim()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const currentValue = claim[field] ?? ''
  const [value, setValue] = useState(currentValue)
  const toneClasses = {
    amber: {
      shell: 'bg-amber-50 border-amber-200',
      title: 'text-amber-800',
      edit: 'text-amber-700 bg-amber-100 active:bg-amber-200',
      input: 'border-amber-300 focus:ring-amber-300',
      save: 'bg-amber-600',
      cancel: 'border-amber-300 text-amber-700',
      body: 'text-amber-900',
      empty: 'text-amber-400',
    },
    blue: {
      shell: 'bg-blue-50 border-blue-200',
      title: 'text-blue-800',
      edit: 'text-blue-700 bg-blue-100 active:bg-blue-200',
      input: 'border-blue-300 focus:ring-blue-300',
      save: 'bg-blue-600',
      cancel: 'border-blue-300 text-blue-700',
      body: 'text-blue-900',
      empty: 'text-blue-400',
    },
  }
  const classes = toneClasses[tone] || toneClasses.amber

  if (!canEdit && !currentValue) return null

  function handleSave() {
    updateClaimMut.mutate(
      { id: claimId, [field]: value.trim() },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
          setEditing(false)
        },
      }
    )
  }

  function handleCancel() {
    setValue(currentValue)
    setEditing(false)
  }

  return (
    <div className={`${classes.shell} border rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className={`text-sm font-semibold ${classes.title}`}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {canEdit && !editing && (
          <button
            onClick={() => { setValue(currentValue); setEditing(true) }}
            className={`text-xs font-medium px-2 py-0.5 rounded-lg ${classes.edit}`}
          >
            {currentValue ? 'Edit' : '+ Add'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${classes.input}`}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateClaimMut.isPending}
              className={`text-xs font-medium px-3 py-1.5 text-white rounded-lg disabled:opacity-50 ${classes.save}`}
            >
              {updateClaimMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              className={`text-xs font-medium px-3 py-1.5 bg-white border rounded-lg ${classes.cancel}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={`text-sm whitespace-pre-wrap ${classes.body}`}>
          {currentValue || <span className={`${classes.empty} italic`}>{emptyText}</span>}
        </p>
      )}
    </div>
  )
}

// ─── Review Panel (finance team, pending_review status) ──────────────────────


function ReviewPanel({ claim, onReject, onStartApproval }) {
  const [rejectComment, setRejectComment] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)

  const receipts = claim.receipts ?? []
  const bankTransactions = claim.bank_transactions ?? []

  const allImages = [
    ...receipts.flatMap((r) =>
      (r.images ?? []).map((img) => ({ key: img.drive_file_id, label: r.description, driveId: img.drive_file_id }))
    ),
    ...bankTransactions.flatMap((bt) =>
      (bt.images ?? []).map((img) => ({ key: img.drive_file_id, label: 'Bank Transaction', driveId: img.drive_file_id }))
    ),
  ]

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <h2 className="text-sm font-bold text-amber-900 mb-3">Review Submission</h2>

      {claim.rejection_comment && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-red-700 mb-1">Previously Rejected — Treasurer's resubmission:</p>
          <p className="text-sm text-red-800">{claim.rejection_comment}</p>
        </div>
      )}

      {allImages.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">Attachments — tap to view</p>
          <div className="flex flex-wrap gap-3">
            {allImages.map((img) => (
              <div key={img.key} className="flex flex-col items-center gap-1">
                <ViewOnlyThumb
                  src={imageUrl(img.driveId)}
                  label={img.label}
                  thumbSize="w-24 h-24"
                />
                <span className="text-[10px] text-gray-500 max-w-[6rem] truncate text-center">{img.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end p-4">
          <div className="bg-white rounded-2xl w-full p-4 max-w-sm mx-auto">
            <h3 className="font-bold text-gray-900 mb-2">Reject Submission</h3>
            <p className="text-sm text-gray-500 mb-3">Tell the treasurer what needs to be fixed:</p>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3 resize-none"
              placeholder="e.g. Missing receipt for the $50 item, please reattach."
            />
            <div className="flex gap-2">
              <button
                onClick={() => { onReject(rejectComment); setRejectComment(''); setShowRejectModal(false) }}
                disabled={!rejectComment.trim()}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Send Rejection
              </button>
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AttachmentRequestPanel({ claim }) {
  const isFinanceTeam = useIsFinanceTeam()
  const isTreasurer = useIsTreasurer()
  const status = claim.status

  const { data: requests = [] } = useAttachmentRequests(claim.id)
  const currentRequest = requests.find(
    (r) => r.status === 'pending' || r.status === 'submitted'
  )

  const [requestMsg, setRequestMsg] = useState('')
  const [rejectMsg, setRejectMsg] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showRequestForm, setShowRequestForm] = useState(false)

  const requestAttachment = useRequestAttachment(claim.id)
  const uploadFile = useUploadAttachmentFile(claim.id)
  const deleteFile = useDeleteAttachmentFile(claim.id)
  const submitAttachments = useSubmitAttachments(claim.id)
  const acceptAttachments = useAcceptAttachments(claim.id)
  const rejectAttachments = useRejectAttachments(claim.id)
  const downloadFile = useDownloadAttachmentFile(claim.id)

  // Finance team: "Request Attachment" form shown on submitted claims
  if (status === 'submitted' && isFinanceTeam) {
    const acceptedRequests = requests.filter((r) => r.status === 'accepted')
    return (
      <div className="space-y-3">
        {/* History of accepted attachment requests */}
        {acceptedRequests.map((req) => (
          <div key={req.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                Accepted
              </span>
              <span className="text-xs text-gray-500">
                {new Date(req.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{req.request_message}</p>
            {(req.files ?? []).length > 0 && (
              <ul className="space-y-1">
                {(req.files ?? []).map((f) => (
                  <li key={f.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-sm">
                    <span className="truncate text-gray-800">{f.original_filename}</span>
                    <button
                      onClick={() => downloadFile.mutate(f.id, { onSuccess: ({ url }) => window.open(url, '_blank') })}
                      className="text-blue-600 ml-2 text-xs font-medium active:text-blue-800 shrink-0"
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {/* Request another attachment */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">
            Request Additional Attachment
          </h2>
          {!showRequestForm ? (
            <ActionButton variant="warning" onClick={() => setShowRequestForm(true)}>
              Request Attachment
            </ActionButton>
          ) : (
            <>
              <textarea
                className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 mb-3"
                rows={3}
                placeholder="Describe what NUS office needs..."
                value={requestMsg}
                onChange={(e) => setRequestMsg(e.target.value)}
              />
              <div className="flex gap-2">
                <ActionButton
                  variant="warning"
                  disabled={!requestMsg.trim()}
                  loading={requestAttachment.isPending}
                  onClick={() =>
                    requestAttachment.mutate(
                      { message: requestMsg },
                      { onSuccess: () => { setRequestMsg(''); setShowRequestForm(false) } }
                    )
                  }
                >
                  Send Request
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => { setShowRequestForm(false); setRequestMsg('') }}>
                  Cancel
                </ActionButton>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // Treasurer: upload files
  if (status === 'attachment_requested' && isTreasurer) {
    const uploadedFiles = currentRequest?.files ?? []
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-800 mb-1">
            Additional Attachment Required
          </h2>
          {currentRequest && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {currentRequest.request_message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Upload files
          </label>
          <input
            type="file"
            multiple
            className="text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 active:file:bg-blue-100"
            onChange={(e) => {
              Array.from(e.target.files || []).forEach((f) => uploadFile.mutate(f))
              e.target.value = ''
            }}
            disabled={uploadFile.isPending}
          />
          {uploadFile.isPending && (
            <p className="text-xs text-gray-500 mt-1">Uploading…</p>
          )}
        </div>
        {uploadedFiles.length > 0 && (
          <ul className="space-y-1">
            {uploadedFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-sm"
              >
                <span className="truncate text-gray-800">{f.original_filename}</span>
                <button
                  onClick={() => deleteFile.mutate(f.id)}
                  disabled={deleteFile.isPending}
                  className="text-red-400 ml-2 text-xs font-medium active:text-red-600 disabled:opacity-40 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ActionButton
          disabled={uploadedFiles.length === 0}
          loading={submitAttachments.isPending}
          onClick={() => submitAttachments.mutate()}
        >
          Submit Attachments
        </ActionButton>
      </div>
    )
  }

  // Finance team: one-off claimer — they handle the upload themselves
  if (status === 'attachment_requested' && isFinanceTeam && !claim.claimer_id) {
    const uploadedFiles = currentRequest?.files ?? []
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-800 mb-1">
            Attachment Required (One-off Claimer)
          </h2>
          {currentRequest && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {currentRequest.request_message}
            </p>
          )}
          <p className="text-xs text-amber-700 mt-2">
            This is a one-off claimer — collect and upload the attachment on their behalf.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Upload files
          </label>
          <input
            type="file"
            multiple
            className="text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 active:file:bg-blue-100"
            onChange={(e) => {
              Array.from(e.target.files || []).forEach((f) => uploadFile.mutate(f))
              e.target.value = ''
            }}
            disabled={uploadFile.isPending}
          />
          {uploadFile.isPending && (
            <p className="text-xs text-gray-500 mt-1">Uploading…</p>
          )}
        </div>
        {uploadedFiles.length > 0 && (
          <ul className="space-y-1">
            {uploadedFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-sm"
              >
                <span className="truncate text-gray-800">{f.original_filename}</span>
                <button
                  onClick={() => deleteFile.mutate(f.id)}
                  disabled={deleteFile.isPending}
                  className="text-red-400 ml-2 text-xs font-medium active:text-red-600 disabled:opacity-40 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ActionButton
          disabled={uploadedFiles.length === 0}
          loading={submitAttachments.isPending}
          onClick={() => submitAttachments.mutate()}
        >
          Submit Attachments
        </ActionButton>
      </div>
    )
  }

  // Finance team: waiting banner (regular claimer)
  if (status === 'attachment_requested' && isFinanceTeam) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-amber-800 mb-1">
          Waiting for Treasurer
        </h2>
        {currentRequest && (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {currentRequest.request_message}
          </p>
        )}
      </div>
    )
  }

  // Finance team: review uploaded files
  if (status === 'attachment_uploaded' && isFinanceTeam) {
    const uploadedFiles = currentRequest?.files ?? []
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          Treasurer Attachments — Review Required
        </h2>
        {uploadedFiles.length > 0 ? (
          <ul className="space-y-1">
            {uploadedFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <span className="truncate text-gray-800">{f.original_filename}</span>
                <button
                  onClick={() =>
                    downloadFile.mutate(f.id, {
                      onSuccess: ({ url }) => window.open(url, '_blank'),
                    })
                  }
                  className="text-blue-600 ml-2 text-xs font-medium active:text-blue-800 shrink-0"
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No files found.</p>
        )}
        <div className="flex gap-2 pt-1">
          <ActionButton
            loading={acceptAttachments.isPending}
            onClick={() => acceptAttachments.mutate()}
          >
            Accept
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() => setShowRejectForm((v) => !v)}
          >
            Reject
          </ActionButton>
        </div>
        {showRejectForm && (
          <div>
            <textarea
              className="w-full border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 mb-2"
              rows={3}
              placeholder="Describe what still needs to be provided…"
              value={rejectMsg}
              onChange={(e) => setRejectMsg(e.target.value)}
            />
            <ActionButton
              variant="danger"
              disabled={!rejectMsg.trim()}
              loading={rejectAttachments.isPending}
              onClick={() =>
                rejectAttachments.mutate(
                  { message: rejectMsg },
                  {
                    onSuccess: () => {
                      setShowRejectForm(false)
                      setRejectMsg('')
                    },
                  }
                )
              }
            >
              Send &amp; Request Again
            </ActionButton>
          </div>
        )}
      </div>
    )
  }

  return null
}

const EVENT_LABELS = {
  claim_created: 'Claim created',
  claim_updated: 'Claim updated',
  internal_notes_updated: 'Internal notes updated',
  treasurer_notes_updated: 'Treasurer notes updated',
  submitted_for_review: 'Submitted for review',
  review_rejected: 'Review rejected',
  email_sent: 'Email sent',
  email_resent: 'Email resent',
  email_failed: 'Email failed',
  email_screenshot_uploaded: 'Email screenshot uploaded',
  documents_generated: 'Documents generated',
  documents_compiled: 'Compiled PDF generated',
  marked_submitted: 'Marked submitted',
  marked_reimbursed: 'Marked reimbursed',
  reimbursement_batch_completed: 'Reimbursement batch completed',
  attachment_requested: 'Attachment requested',
  attachment_file_uploaded: 'Attachment file uploaded',
  attachments_submitted: 'Attachments submitted',
  attachments_accepted: 'Attachments accepted',
  attachments_rejected: 'Attachments rejected',
  mf_approval_uploaded: 'MF approval uploaded',
}

function formatEventTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ClaimTimeline({ events = [] }) {
  if (!events.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h2>
        <p className="text-xs text-gray-400">No timeline events yet. New actions will appear after the audit migration is run.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h2>
      <div className="space-y-3">
        {events.map((event) => {
          const actor = event.actor?.name || 'System'
          const label = EVENT_LABELS[event.event_type] || event.message || event.event_type
          return (
            <div key={event.id} className="flex gap-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-gray-800">{label}</p>
                  <span className="shrink-0 text-[11px] text-gray-400">{formatEventTime(event.created_at)}</span>
                </div>
                <p className="text-xs text-gray-500">{event.message}</p>
                <p className="text-[11px] text-gray-400">{actor}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ClaimDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state: locationState } = useLocation()
  const queryClient = useQueryClient()

  // Queries
  const { data: claim, isLoading, isError, refetch } = useClaim(id)
  const { data: claimEvents = [] } = useClaimEvents(id)

  // Role
  const isTreasurer = useIsTreasurer()
  const isFinanceTeam = useIsFinanceTeam()

  // Mutations
  const sendEmailMut = useSendEmail()
  const resendEmailMut = useResendEmail()
  const submitForReviewMut = useSubmitForReview()
  const rejectReviewMut = useRejectReview()
  const uploadScreenshotMut = useUploadScreenshot()
  const generateDocsMut = useGenerateDocuments()
  const compileDocsMut = useCompileDocuments()
  const updateClaimMut = useUpdateClaim()
  const submitClaimMut = useSubmitClaim()
  const reimburseClaimMut = useReimburseClaim()
  const deleteClaimMut = useDeleteClaim()
  const createReceiptMut = useCreateReceipt()
  const updateReceiptMut = useUpdateReceipt()
  const deleteReceiptMut = useDeleteReceipt()
  const createPayerMut = useCreatePayer()
  const updatePayerMut = useUpdatePayer()
  const deleteBtMut = useDeleteBankTransaction(id)

  // UI state
  const [editMode, setEditMode] = useState(false)
  const [editFields, setEditFields] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [staleDocsWarning, setStaleDocsWarning] = useState(false)
  const [actionError, setActionError] = useState(null)

  // BT + receipt UX state
  const [expandedBtId, setExpandedBtId] = useState(null)
  const [showBtModal, setShowBtModal] = useState(false)
  const [editingBt, setEditingBt] = useState(null)
  const [addingReceiptForBtId, setAddingReceiptForBtId] = useState(null)
  const [showAddUnlinked, setShowAddUnlinked] = useState(false)
  const [claimOnlyPayers, setClaimOnlyPayers] = useState([])

  const payerOwnerId = claim?.claimer_id || ''
  const { data: savedPayers = [], isLoading: payersLoading } = usePayers(payerOwnerId, Boolean(payerOwnerId))
  const deletePayerMut = useDeletePayer(payerOwnerId)
  const defaultPayer = useMemo(() => claimDefaultPayer(claim), [claim])
  const receiptPayers = useMemo(
    () =>
      (claim?.receipts ?? [])
        .filter((receipt) => receipt.payer_name && receipt.payer_email)
        .map((receipt) => ({
          id: `receipt:${receipt.id}`,
          name: receipt.payer_name,
          email: receipt.payer_email,
          is_self: false,
          is_saved: false,
        })),
    [claim?.receipts]
  )
  const payerOptions = useMemo(() => {
    if (payerOwnerId) return savedPayers.map(normalizePayer).filter(Boolean)
    return uniquePayers([defaultPayer, ...receiptPayers, ...claimOnlyPayers])
  }, [payerOwnerId, savedPayers, defaultPayer, receiptPayers, claimOnlyPayers])

  async function createCurrentPayer({ name, email }) {
    if (payerOwnerId) {
      return createPayerMut.mutateAsync({ owner_treasurer_id: payerOwnerId, name, email })
    }
    const payer = {
      id: `claim:${cleanEmail(email)}`,
      name: name.trim(),
      email: cleanEmail(email),
      is_self: false,
      is_saved: false,
    }
    setClaimOnlyPayers((prev) => {
      const withoutDuplicate = prev.filter((item) => cleanEmail(item.email) !== payer.email)
      return [...withoutDuplicate, payer]
    })
    return payer
  }

  async function updateCurrentPayer(payerId, fields) {
    return updatePayerMut.mutateAsync({ id: payerId, ...fields })
  }

  async function deleteCurrentPayer(payerId) {
    return deletePayerMut.mutateAsync(payerId)
  }

  // Loading map passed to pipeline
  const loadingMap = {
    send: sendEmailMut.isPending,
    resend: resendEmailMut.isPending,
    screenshot: uploadScreenshotMut.isPending,
    generate: generateDocsMut.isPending,
    compile: compileDocsMut.isPending,
    submit: submitClaimMut.isPending,
    reimburse: reimburseClaimMut.isPending,
    submitForReview: submitForReviewMut.isPending,
  }

  function invalidateClaim() {
    queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(id) })
    queryClient.invalidateQueries({ queryKey: [...CLAIM_KEYS.detail(id), 'events'] })
  }

  // Action dispatcher
  function handleAction(type, payload) {
    if (Object.values(loadingMap).some(Boolean)) return
    setActionError(null)

    const errHandler = (err) => {
      const detail = err?.response?.data?.detail
      const isProcessing =
        err?.response?.status === 409 &&
        typeof detail === 'string' &&
        (detail.includes('already in progress') || detail.includes('Processing already in progress'))

      if (isProcessing) {
        queryClient.setQueryData(CLAIM_KEYS.detail(id), (old) =>
          old ? { ...old, error_message: '__generating__' } : old
        )
        invalidateClaim()
        return
      }

      setActionError(extractError(err, 'Action failed. Please try again.'))
    }

    if (type === 'submitForReview') {
      submitForReviewMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'send') {
      sendEmailMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'resend') {
      resendEmailMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'screenshot') {
      const files = Array.isArray(payload) ? payload : [payload]
      uploadScreenshotMut.mutate(
        { claimId: id, files },
        { onSuccess: invalidateClaim, onError: errHandler }
      )
    } else if (type === 'generate') {
      generateDocsMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'compile') {
      compileDocsMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'submit') {
      submitClaimMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    } else if (type === 'reimburse') {
      reimburseClaimMut.mutate(id, { onSuccess: invalidateClaim, onError: errHandler })
    }
  }

  // Attach loading map as property so pipeline can read it
  handleAction.loading = loadingMap

  // Edit mode
  function startEdit() {
    if (!claim) return
    const existingTrips = (claim.transport_data?.trips ?? []).map((t) => ({
      from: t.from_location ?? '',
      to: t.to_location ?? '',
      purpose: t.purpose ?? '',
      date: formatDMY(t.date ?? ''),
      time: format24To12(t.time ?? ''),
      amount: t.amount != null ? String(t.amount) : '',
      distance_km: t.distance_km != null ? String(t.distance_km) : '',
    }))
    setEditFields({
      claim_description: claim.claim_description ?? '',
      remarks: claim.remarks ?? '',
      date: claim.date ?? '',
      wbs_account: claim.wbs_account ?? '',
      transport_form_needed: claim.transport_form_needed ?? false,
      transport_trips: existingTrips,
      is_partial: claim.is_partial ?? false,
    })
    setEditMode(true)
  }

  function cancelEdit() {
    setEditMode(false)
    setEditFields({})
  }

  function handleSave() {
    // Strip enum/date fields and transport_trips (handled separately) to avoid Pydantic 422 errors
    const { date, wbs_account, is_partial, transport_trips, ...rest } = editFields
    const payload = { id, ...rest }
    if (date) payload.date = date
    if (wbs_account) payload.wbs_account = wbs_account
    payload.is_partial = is_partial
    // Optimistic concurrency: reject if someone else changed the claim while editing
    if (claim?.updated_at) payload.client_updated_at = claim.updated_at

    updateClaimMut.mutate(
      payload,
      {
        onSuccess: (data) => {
          // Save transport trip data if transport form is enabled (fire and forget)
          if (editFields.transport_form_needed && transport_trips?.length > 0) {
            submitTransportData({
              claimId: id,
              trips: transport_trips.map((t) => ({
                from_location: t.from,
                to_location: t.to,
                purpose: t.purpose,
                date: parseDMY(t.date) || undefined,
                time: t.time || undefined,
                amount: t.amount ? Number(t.amount) : 0,
                distance_km: t.distance_km ? Number(t.distance_km) : undefined,
              })),
            }).catch(() => {})
          }
          setEditMode(false)
          setEditFields({})
          const stale = data?.stale_documents ?? []
          if (stale.length > 0) setStaleDocsWarning(true)
          // Merge the PATCH response directly into cache, then force a refetch
          // so MF upload section appears immediately if wbs_account changed to MF
          if (data?.claim) {
            queryClient.setQueryData(CLAIM_KEYS.detail(id), (old) =>
              old ? { ...old, ...data.claim } : undefined
            )
          }
          invalidateClaim()
        },
        onError: (err) => setActionError(extractError(err, 'Failed to save changes.')),
      }
    )
  }

  function handleDelete() {
    if (deleteConfirmText !== 'DELETE') return
    deleteClaimMut.mutate(
      { id },
      {
        onSuccess: () => navigate('/'),
        onError: (err) => {
          setShowDeleteConfirm(false)
          setDeleteConfirmText('')
          setActionError(extractError(err, 'Failed to delete claim.'))
        },
      }
    )
  }

  // ─── BT handler ─────────────────────────────────────────────────────────────

  function handleDeleteBt(btId) {
    deleteBtMut.mutate(btId, {
      onSuccess: () => {
        setExpandedBtId((prev) => (prev === btId ? null : prev))
        setAddingReceiptForBtId((prev) => (prev === btId ? null : prev))
        invalidateClaim()
      },
      onError: (err) => setActionError(extractError(err, 'Failed to delete bank transaction.')),
    })
  }

  // ─── Receipt helpers ─────────────────────────────────────────────────────────

  function appendRemark(existing, line) {
    const base = (existing ?? '').trim()
    return base ? `${base}\n${line}` : line
  }

  function appendFxRemark() {
    const FX_REMARK = '- Exchange Rate Screenshot is Attached'
    const current = claim.remarks ?? ''
    if (current.includes(FX_REMARK)) return
    updateClaimMut.mutate({ id, remarks: appendRemark(current, FX_REMARK) }, { onSuccess: invalidateClaim })
  }

  function recalcAndUpdateTotal(updatedReceipts) {
    const total = updatedReceipts.reduce((s, r) => s + Number(r.claimed_amount ?? r.amount), 0)
    updateClaimMut.mutate({ id, total_amount: total }, { onSuccess: invalidateClaim })
  }

  function handleAddReceipt(fields) {
    createReceiptMut.mutate(
      { claim_id: id, ...fields },
      {
        onSuccess: (created) => {
          const savedReceipt = created?.receipt ?? created
          if (created?.split_needed || !savedReceipt?.id) {
            setActionError(created?.reason || 'Receipt could not be saved.')
            return
          }
          const updated = [...(claim.receipts ?? []), savedReceipt]
          recalcAndUpdateTotal(updated)
          if (fields.is_foreign_currency && fields.exchange_rate_screenshot_drive_id) appendFxRemark()
        },
        onError: (err) => setActionError(extractError(err, 'Failed to add receipt.')),
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
          if (fields.is_foreign_currency && fields.exchange_rate_screenshot_drive_id) appendFxRemark()
        },
        onError: (err) => setActionError(extractError(err, 'Failed to update receipt.')),
      }
    )
  }

  function handleDeleteReceipt(receipt) {
    deleteReceiptMut.mutate(receipt.id, {
      onSuccess: () => {
        const updated = (claim.receipts ?? []).filter((r) => r.id !== receipt.id)
        recalcAndUpdateTotal(updated)
      },
      onError: (err) => setActionError(extractError(err, 'Failed to delete receipt.')),
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

  if (!claim) {
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
  const cca = claim.cca ?? {}
  const portfolio = cca.portfolio ?? {}
  const claimerName = claim.one_off_name || claimer.name || '—'
  const showErrorBanner = claim.status === 'error' && !errorDismissed
  const unlinked = (claim.receipts ?? []).filter(r => !r.bank_transaction_id)
  const canEdit = !isTreasurer || claim.status === 'draft'

  return (
    <div className="mobile-page flex min-h-full flex-col pb-6">
      {/* ── Header ── */}
      <div className="mobile-header sticky top-0 z-20 border-b px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="icon-button"
            aria-label="Back"
          >
            <IconChevronLeft className="w-4 h-4" />
          </button>

          <h1 className="flex-1 text-sm font-semibold text-gray-900 truncate">
            {claim.reference_code ?? `Claim #${claim.claim_number ?? id}`}
          </h1>

          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              {!editMode && (
                <button
                  onClick={startEdit}
                  className="text-xs font-medium text-blue-600 px-2 py-1 rounded-lg bg-blue-50 active:bg-blue-100"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => {
                  setDeleteConfirmText('')
                  setShowDeleteConfirm(true)
                }}
                disabled={editMode}
                className="text-xs font-medium text-red-600 px-2 py-1 rounded-lg bg-red-50 active:bg-red-100 disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mobile-content flex flex-col gap-4">
        {/* ── Generating banner — shown while docs are being built server-side ── */}
        {claim.error_message === '__generating__' && (
          <div className="sticky top-[4.25rem] z-10 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-sm">
            <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-blue-700">Your claim is being processed</p>
              <p className="text-xs text-blue-600">The finance team is preparing your claim documents. This usually takes 1-2 minutes. This page will refresh automatically.</p>
              <LoadingBar className="mt-2 min-w-0" />
            </div>
          </div>
        )}

        {/* ── Error banner (claim.status === 'error') ── */}
        {showErrorBanner && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Error</p>
              <p className="text-xs text-red-600 mt-0.5">
                {claim.error_message || 'An error occurred with this claim.'}
              </p>
              {!isTreasurer && (
                <div className="mt-2">
                  <ActionButton
                    variant="danger"
                    onClick={() => handleAction('generate')}
                    loading={handleAction.loading?.generate}
                  >
                    Retry: Generate Documents
                  </ActionButton>
                </div>
              )}
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


        {/* ── Stale documents warning ── */}
        {staleDocsWarning && !isTreasurer && (
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

        {/* ── Save warnings from NewClaimPage (image upload failures) ── */}
        {locationState?.imageWarnings?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">Claim saved, but some images failed to upload:</p>
            {locationState.imageWarnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">{w}</p>
            ))}
            <p className="text-xs text-amber-600 mt-1">You can add them manually by editing the receipt or bank transaction.</p>
          </div>
        )}
        {locationState?.saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700 mb-1">Claim created but some items may be missing:</p>
            <p className="text-xs text-red-600">{locationState.saveError}</p>
          </div>
        )}
        {locationState?.submittedForReview && isTreasurer && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-semibold text-green-700">Submitted for review</p>
            <p className="mt-0.5 text-xs text-green-700">Finance can now review this claim.</p>
          </div>
        )}
        {locationState?.needsSubmitReview && isTreasurer && claim.status === 'draft' && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-blue-800">Not submitted yet</p>
                <p className="mt-1 text-xs text-blue-700">
                  This claim has not been sent to finance yet. Submit it for review when the details are ready.
                </p>
              </div>
              <ActionButton
                onClick={() => handleAction('submitForReview')}
                loading={handleAction.loading?.submitForReview}
                className="w-full justify-center sm:w-auto"
              >
                Submit for Review
              </ActionButton>
            </div>
          </div>
        )}

        {/* ── Rejection banner — shown on DRAFT claims returned with feedback ── */}
        {claim.status === 'draft' && claim.rejection_comment && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700 mb-1">Action Required — Finance Team Feedback:</p>
            <p className="text-sm text-red-800">{claim.rejection_comment}</p>
          </div>
        )}

        {/* ── Attachment request panel ── */}
        {['submitted', 'attachment_requested', 'attachment_uploaded'].includes(claim.status) && (
          <AttachmentRequestPanel claim={claim} />
        )}

        {!isTreasurer && <ReadinessPanel claim={claim} />}

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
                <input
                  value={editFields.claim_description}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, claim_description: e.target.value }))
                  }
                  placeholder="e.g. Camp supplies"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <p className="mt-1 text-xs text-gray-400">Keep this short, 5 words.</p>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Remarks</label>
                <p className="mb-1 text-xs text-gray-400">Format each line as: - remark</p>
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
                  className="w-full max-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
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
                {editFields.wbs_account === 'MF' && (
                  <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    MF account requires a Master&apos;s Approval screenshot — upload it after saving.
                  </p>
                )}
              </div>

              {/* Transport form needed */}
              <div className="flex items-center gap-2">
                <input
                  id="transport_needed"
                  type="checkbox"
                  checked={editFields.transport_form_needed}
                  onChange={(e) =>
                    setEditFields((f) => ({
                      ...f,
                      transport_form_needed: e.target.checked,
                      transport_trips: e.target.checked ? (f.transport_trips ?? []) : [],
                    }))
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="transport_needed" className="text-sm text-gray-700">
                  Transport form needed <span className="text-gray-400">(mark this if you are claiming a Grab/Gojek/Tada transport claim)</span>
                </label>
              </div>
              {editFields.transport_form_needed && (
                <TransportTripsInput
                  trips={editFields.transport_trips ?? []}
                  onChange={(trips) => setEditFields((f) => ({ ...f, transport_trips: trips }))}
                />
              )}

              {/* Partial claim */}
              <div className="flex items-center gap-2">
                <input
                  id="is_partial"
                  type="checkbox"
                  checked={editFields.is_partial}
                  onChange={(e) =>
                    setEditFields((f) => ({ ...f, is_partial: e.target.checked }))
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_partial" className="text-sm text-gray-700">
                  Partial claim — set claimed amount per receipt
                </label>
              </div>

            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <InfoRow label="Claimer" value={claimerName} />
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
              <InfoRow
                label="Transport Form"
                value={claim.transport_form_needed ? 'Yes' : 'No'}
              />
              {claim.is_partial && (
                <InfoRow label="Partial Claim" value="Yes — see claimed amounts per receipt" />
              )}
            </div>
          )}
        </div>

        {/* ── MF Approval Screenshot ── */}
        {claim.wbs_account === 'MF' && canEdit && (
          <MfApprovalUpload
            claim={claim}
            onUploaded={() => {
              const MF_REMARK = "- Master's Approval Screenshot is attached"
              const current = claim.remarks ?? ''
              if (!current.includes(MF_REMARK)) {
                updateClaimMut.mutate(
                  { id, remarks: appendRemark(current, MF_REMARK) },
                  { onSuccess: invalidateClaim }
                )
              } else {
                refetch()
              }
            }}
          />
        )}

        {/* ── Treasurer Notes ── */}
        {(isTreasurer || claim.treasurer_notes) && (
          <ClaimNotesCard
            claim={claim}
            claimId={id}
            field="treasurer_notes"
            title="Treasurer Notes"
            description="Visible to the CCA treasurer, finance team, and finance director."
            placeholder="Optional context for finance..."
            emptyText="No treasurer notes yet"
            canEdit={isTreasurer}
            tone="blue"
          />
        )}

        {/* ── Internal Notes (finance team only) ── */}
        {isFinanceTeam && (
          <ClaimNotesCard
            claim={claim}
            claimId={id}
            field="internal_notes"
            title="Internal Notes"
            description="Visible only to finance team and finance director."
            placeholder="Notes visible only to finance team..."
            canEdit
            tone="amber"
          />
        )}

        <PayerBreakdownCard claim={claim} />

        {/* ── Finance Review Panel — shown when claim is pending_review ── */}
        {isFinanceTeam && claim.status === 'pending_review' && (
          <ReviewPanel
            claim={claim}
            onStartApproval={() => navigate(`/claims/${id}/approve`)}
            onReject={(comment) =>
              rejectReviewMut.mutate(
                { claimId: id, comment },
                { onSuccess: invalidateClaim, onError: (err) => setActionError(extractError(err, 'Failed to reject submission.')) }
              )
            }
          />
        )}

        {/* ── Status Pipeline ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Progress</h2>
          {isTreasurer ? (
            <TreasurerProgressPanel claim={claim} onAction={handleAction} />
          ) : (
            <StatusPipeline claim={claim} onAction={handleAction} isTreasurer={isTreasurer} />
          )}
        </div>

        {/* ── Bank Transactions ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Bank Transactions ({claim.bank_transactions?.length ?? 0})
            </h2>
            {canEdit && (
              <button
                onClick={() => { setEditingBt(null); setShowBtModal(true) }}
                className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg bg-blue-50"
              >
                + Add
              </button>
            )}
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
                  isTreasurer={isTreasurer}
                  canEdit={canEdit}
                  isPartial={claim.is_partial}
                  payerOptions={payerOptions}
                  onCreatePayer={createCurrentPayer}
                  onUpdatePayer={updateCurrentPayer}
                  onDeletePayer={deleteCurrentPayer}
                  canManagePayers={Boolean(payerOwnerId)}
                  payersLoading={Boolean(payerOwnerId) && payersLoading}
                />
              )
            })}
            {!(claim.bank_transactions?.length) && (
              <p className="text-xs text-gray-400 text-center py-2">No bank transactions</p>
            )}
          </div>
        </div>

        {/* ── Unlinked Receipts ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Unlinked Receipts ({unlinked.length})
            </h2>
            {canEdit && !showAddUnlinked && (
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
                isTreasurer={isTreasurer}
                canEdit={canEdit}
                isPartial={claim.is_partial}
                payerOptions={payerOptions}
                onCreatePayer={createCurrentPayer}
                onUpdatePayer={updateCurrentPayer}
                onDeletePayer={deleteCurrentPayer}
                canManagePayers={Boolean(payerOwnerId)}
                payersLoading={Boolean(payerOwnerId) && payersLoading}
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
              isTreasurer={isTreasurer}
              isPartial={claim.is_partial}
              payerOptions={payerOptions}
              onCreatePayer={createCurrentPayer}
              onUpdatePayer={updateCurrentPayer}
              onDeletePayer={deleteCurrentPayer}
              canManagePayers={Boolean(payerOwnerId)}
              payersLoading={Boolean(payerOwnerId) && payersLoading}
            />
          )}
        </div>

        {/* ── Documents ── */}
        {!isTreasurer && claim.documents?.length > 0 && (
          <DocumentsCard documents={claim.documents} />
        )}

        <ClaimTimeline events={claimEvents} />
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
              This will permanently delete the claim and all associated files. This cannot be undone.
            </p>
            <label className="mb-5 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Type DELETE to confirm
              </span>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                placeholder="DELETE"
              />
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setDeleteConfirmText('')
                }}
                disabled={deleteClaimMut.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 active:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteClaimMut.isPending || deleteConfirmText !== 'DELETE'}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 text-white active:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteClaimMut.isPending && <Spinner small />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fixed-bottom action error toast ── */}
      {actionError && (
        <div className="fixed bottom-4 left-4 right-4 z-50 bg-red-600 text-white rounded-xl px-4 py-3 shadow-xl flex items-start gap-3">
          <p className="flex-1 text-sm leading-snug">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-white/70 hover:text-white text-xl leading-none mt-0.5"
            aria-label="Dismiss"
          >
            ×
          </button>
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

function payerBreakdown(claim) {
  const fallback = claimDefaultPayer(claim)
  const groups = new Map()
  for (const receipt of claim?.receipts ?? []) {
    const name = receipt.payer_name || fallback?.name || 'Unknown payer'
    const email = cleanEmail(receipt.payer_email || fallback?.email)
    const key = `${email}:${name}`
    const current = groups.get(key) || { name, email, total: 0, receipts: [] }
    current.total += Number(receipt.claimed_amount ?? receipt.amount ?? 0)
    current.receipts.push(receipt)
    groups.set(key, current)
  }
  return Array.from(groups.values()).sort((a, b) => b.total - a.total)
}

function PayerBreakdownCard({ claim }) {
  const groups = payerBreakdown(claim)
  if (!groups.length) return null

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Reimbursement Split</h2>
          <p className="mt-0.5 text-xs text-gray-400">Based on who paid for each receipt.</p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
          {groups.length} payer{groups.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <div key={`${group.email}:${group.name}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800">{group.name}</p>
                {group.email && <p className="truncate text-xs text-gray-500">{group.email}</p>}
              </div>
              <p className="shrink-0 text-sm font-bold text-gray-900">{formatAmount(group.total)}</p>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {group.receipts.length} receipt{group.receipts.length === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

const EMPTY_RECEIPT_FIELDS = {
  description: '', amount: '', claimed_amount: '', category: '', gst_code: 'IE',
  dr_cr: 'DR', receipt_no: '', company: '', date: '',
  payer_id: null, payer_name: '', payer_email: '',
  is_foreign_currency: false, exchange_rate_screenshot_drive_id: null,
}

function ReceiptInlineForm({
  initial,
  bankTransactionId,
  onSave,
  onCancel,
  saving,
  claimId,
  isTreasurer,
  isPartial,
  payerOptions,
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManagePayers,
  payersLoading,
}) {
  const [f, setF] = useState({ ...EMPTY_RECEIPT_FIELDS, ...initial })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const [err, setErr] = useState({})

  const [receiptImageDriveIds, setReceiptImageDriveIds] = useState(initial?.receipt_image_drive_ids ?? [])
  const [reuploadingReceiptIdx, setReuploadingReceiptIdx] = useState(null)
  const [uploadingFx, setUploadingFx] = useState(false)
  const [reuploadingFx, setReuploadingFx] = useState(false)
  const [fxUploadErr, setFxUploadErr] = useState(null)

  async function handleFxFiles(files) {
    if (!claimId) return
    setFxUploadErr(null)
    setUploadingFx(true)
    try {
      const newIds = []
      for (const file of files) {
        const data = await uploadReceiptImage({ file, claim_id: claimId, image_type: 'exchange_rate' })
        newIds.push(data.drive_file_id)
      }
      setF(p => {
        const existing = p.exchange_rate_screenshot_drive_ids?.length
          ? p.exchange_rate_screenshot_drive_ids
          : p.exchange_rate_screenshot_drive_id
            ? [p.exchange_rate_screenshot_drive_id]
            : []
        const all = [...existing, ...newIds]
        return { ...p, exchange_rate_screenshot_drive_ids: all, exchange_rate_screenshot_drive_id: all[0] ?? null }
      })
    } catch (e) {
      setFxUploadErr(extractError(e, 'Screenshot upload failed. Please try again.'))
    } finally {
      setUploadingFx(false)
    }
  }

  async function handleReuploadReceiptImage(idx, croppedFile) {
    if (!claimId) return
    setReuploadingReceiptIdx(idx)
    try {
      const data = await uploadReceiptImage({ file: croppedFile, claim_id: claimId, image_type: 'receipt' })
      setReceiptImageDriveIds(prev => prev.map((id, i) => i === idx ? data.drive_file_id : id))
    } catch {
      // silently ignore — old ID stays
    } finally {
      setReuploadingReceiptIdx(null)
    }
  }

  async function handleReuploadFxImage(croppedFile, replacingId) {
    if (!claimId) return
    setReuploadingFx(true)
    try {
      const data = await uploadReceiptImage({ file: croppedFile, claim_id: claimId, image_type: 'exchange_rate' })
      setF(p => {
        const existing = p.exchange_rate_screenshot_drive_ids?.length
          ? p.exchange_rate_screenshot_drive_ids
          : p.exchange_rate_screenshot_drive_id ? [p.exchange_rate_screenshot_drive_id] : []
        const next = existing.map(id => id === replacingId ? data.drive_file_id : id)
        return { ...p, exchange_rate_screenshot_drive_ids: next, exchange_rate_screenshot_drive_id: next[0] ?? null }
      })
    } catch {
      // silently ignore
    } finally {
      setReuploadingFx(false)
    }
  }

  function handleSave() {
    const e = {}
    if (!f.description.trim()) e.description = 'Required'
    if (!f.amount || isNaN(Number(f.amount)) || Number(f.amount) <= 0) e.amount = 'Enter valid amount'
    if (!isTreasurer && !f.category) e.category = 'Required'
    if (!f.payer_name?.trim() || !f.payer_email?.trim()) e.payer = 'Select who paid for this receipt'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({
      ...f,
      amount: Number(f.amount),
      claimed_amount: (isPartial && f.claimed_amount) ? Number(f.claimed_amount) : null,
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
          <div className="flex flex-wrap gap-3 mb-2">
            {receiptImageDriveIds.map((imgId, i) => (
              <CroppableThumb
                key={imgId}
                src={imageUrl(imgId)}
                label={`Photo ${i + 1}`}
                reuploading={reuploadingReceiptIdx === i}
                onRemove={() => setReceiptImageDriveIds(prev => prev.filter((_, j) => j !== i))}
                onCropped={(f) => handleReuploadReceiptImage(i, f)}
              />
            ))}
          </div>
        )}
        <ReceiptUploader
          claimId={claimId}
          imageType="receipt"
          label="Receipt Photo"
          onUploaded={(driveId) => setReceiptImageDriveIds(prev => [...prev, driveId])}
        />
      </div>

      {/* Description */}
      <div>
        <input className={inputCls} placeholder="Description *" value={f.description} onChange={set('description')} />
        {err.description && <p className="text-xs text-red-500 mt-0.5">{err.description}</p>}
      </div>
      <div className={`grid gap-2 ${isTreasurer ? '' : 'grid-cols-2'}`}>
        <div>
          <input className={inputCls} type="number" inputMode="decimal" placeholder="Amount *" value={f.amount} onChange={set('amount')} />
          {err.amount && <p className="text-xs text-red-500 mt-0.5">{err.amount}</p>}
        </div>
        {!isTreasurer && (
          <div>
            <select className={inputCls} value={f.category} onChange={set('category')}>
              <option value="">Category *</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {err.category && <p className="text-xs text-red-500 mt-0.5">{err.category}</p>}
          </div>
        )}
      </div>
      {isPartial && (
        <div>
          <input
            className={inputCls}
            type="number"
            inputMode="decimal"
            placeholder="Claimed Amount (leave blank = full amount)"
            value={f.claimed_amount}
            onChange={set('claimed_amount')}
          />
        </div>
      )}
      <PayerSelect
        payer={{
          payer_id: f.payer_id,
          payer_name: f.payer_name,
          payer_email: f.payer_email,
        }}
        onChange={(payer) => {
          setF((prev) => ({ ...prev, ...payer }))
          if (err.payer) setErr((prev) => ({ ...prev, payer: '' }))
        }}
        options={payerOptions}
        onCreatePayer={onCreatePayer}
        onUpdatePayer={onUpdatePayer}
        onDeletePayer={onDeletePayer}
        canManageSaved={canManagePayers}
        loading={payersLoading}
        error={err.payer}
      />
      {!isTreasurer && (
        <div className="grid grid-cols-2 gap-2">
          <select className={inputCls} value={f.gst_code} onChange={set('gst_code')}>
            {GST_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={inputCls} value={f.dr_cr} onChange={set('dr_cr')}>
            {DR_CR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Receipt No." value={f.receipt_no} onChange={set('receipt_no')} />
        <input className={inputCls} placeholder="Company" value={f.company} onChange={set('company')} />
      </div>
      <input
        className={`${inputCls} max-w-[200px]`}
        type="date"
        value={f.date}
        onChange={set('date')}
      />

      {/* Foreign currency */}
      <div className="flex items-center gap-2">
        <input
          id={`fx-${bankTransactionId ?? 'unlinked'}`}
          type="checkbox"
          checked={f.is_foreign_currency}
          onChange={(e) => {
            const checked = e.target.checked
            setF(p => ({ ...p, is_foreign_currency: checked, exchange_rate_screenshot_drive_id: checked ? p.exchange_rate_screenshot_drive_id : null }))
            if (!checked) setFxUploadErr(null)
          }}
          className="w-4 h-4 text-orange-500 border-gray-300 rounded"
        />
        <label htmlFor={`fx-${bankTransactionId ?? 'unlinked'}`} className="text-xs text-gray-700">
          Charged in foreign currency
        </label>
      </div>
      {f.is_foreign_currency && (
        <div className="pl-6">
          <p className="text-xs text-gray-500 mb-1">Exchange Rate Screenshot</p>
          {(() => {
            const fxIds = f.exchange_rate_screenshot_drive_ids?.length
              ? f.exchange_rate_screenshot_drive_ids
              : f.exchange_rate_screenshot_drive_id
                ? [f.exchange_rate_screenshot_drive_id]
                : []
            return (
              <>
                {fxIds.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-1">
                    {fxIds.map((id, i) => (
                      <CroppableThumb
                        key={id}
                        src={imageUrl(id)}
                        label="Exchange rate screenshot"
                        reuploading={reuploadingFx}
                        onRemove={() => setF(p => {
                          const next = fxIds.filter((_, j) => j !== i)
                          return { ...p, exchange_rate_screenshot_drive_ids: next, exchange_rate_screenshot_drive_id: next[0] ?? null }
                        })}
                        onCropped={(cf) => handleReuploadFxImage(cf, id)}
                      />
                    ))}
                  </div>
                )}
                <DragDropZone
                  label={uploadingFx ? 'Uploading…' : '+ Add exchange rate screenshot'}
                  onFiles={handleFxFiles}
                  multiple
                  loading={uploadingFx}
                  compact
                  withCrop
                  dragBorder="border-orange-400 bg-orange-50"
                  idleBorder="border-orange-300 bg-orange-50 hover:bg-orange-100"
                />
              </>
            )
          })()}
          {fxUploadErr && <p className="text-xs text-red-500 mt-0.5">{fxUploadErr}</p>}
        </div>
      )}

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

function ReceiptRow({
  receipt,
  onEdit,
  onDelete,
  saving,
  claimId,
  isTreasurer,
  canEdit = true,
  isPartial,
  payerOptions,
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManagePayers,
  payersLoading,
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reuploadingImgIdx, setReuploadingImgIdx] = useState(null)
  const [reuploadingFx, setReuploadingFxRow] = useState(false)

  async function handleReuploadReceiptImg(imgDriveId, idx, croppedFile) {
    setReuploadingImgIdx(idx)
    try {
      await uploadReceiptImage({ file: croppedFile, claim_id: claimId, image_type: 'receipt' })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch { /* silently ignore */ } finally {
      setReuploadingImgIdx(null)
    }
  }

  async function handleReuploadFxRow(croppedFile) {
    setReuploadingFxRow(true)
    try {
      await uploadReceiptImage({ file: croppedFile, claim_id: claimId, image_type: 'exchange_rate' })
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    } catch { /* silently ignore */ } finally {
      setReuploadingFxRow(false)
    }
  }

  if (editing) {
    return (
      <div className="py-2 border-b border-gray-50 last:border-0">
        <ReceiptInlineForm
          initial={{
            description: receipt.description ?? '',
            amount: String(receipt.amount ?? ''),
            claimed_amount: String(receipt.claimed_amount ?? ''),
            category: receipt.category ?? '',
            gst_code: receipt.gst_code ?? 'IE',
            dr_cr: receipt.dr_cr ?? 'DR',
            payer_id: receipt.payer_id ?? null,
            payer_name: receipt.payer_name ?? '',
            payer_email: receipt.payer_email ?? '',
            receipt_no: receipt.receipt_no ?? '',
            company: receipt.company ?? '',
            date: receipt.date ?? '',
            receipt_image_drive_ids: receipt.images?.map(img => img.drive_file_id) ?? [],
            is_foreign_currency: receipt.is_foreign_currency ?? false,
            exchange_rate_screenshot_drive_id: receipt.exchange_rate_screenshot_drive_id ?? null,
          }}
          bankTransactionId={receipt.bank_transaction_id ?? null}
          onSave={(fields) => { onEdit(fields); setEditing(false) }}
          onCancel={() => setEditing(false)}
          saving={saving}
          claimId={claimId}
          isTreasurer={isTreasurer}
          isPartial={isPartial}
          payerOptions={payerOptions}
          onCreatePayer={onCreatePayer}
          onUpdatePayer={onUpdatePayer}
          onDeletePayer={onDeletePayer}
          canManagePayers={canManagePayers}
          payersLoading={payersLoading}
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
            {receipt.category ?? '—'} · {formatAmount(receipt.claimed_amount ?? receipt.amount)}
            {receipt.claimed_amount != null && <span className="text-gray-400"> (full: {formatAmount(receipt.amount)})</span>}
            {receipt.company ? ` · ${receipt.company}` : ''}
          </p>
          <p className="text-xs text-gray-400">{receipt.gst_code} · {receipt.dr_cr}</p>
          {(receipt.payer_name || receipt.payer_email) && (
            <p className="text-xs text-gray-500">
              Paid by {receipt.payer_name || 'Unknown'}{receipt.payer_email ? ` (${receipt.payer_email})` : ''}
            </p>
          )}
          {receipt.is_foreign_currency && (
            <span className="inline-block text-xs text-orange-600 font-semibold bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded mt-0.5">FX</span>
          )}
          {receipt.images?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {receipt.images.map((img, i) => (
                <CroppableThumb
                  key={img.id}
                  src={imageUrl(img.drive_file_id)}
                  label={`Photo ${i + 1}`}
                  reuploading={reuploadingImgIdx === i}
                  onCropped={(f) => handleReuploadReceiptImg(img.drive_file_id, i, f)}
                />
              ))}
              {receipt.exchange_rate_screenshot_drive_id && (
                <CroppableThumb
                  src={imageUrl(receipt.exchange_rate_screenshot_drive_id)}
                  label="Exchange rate"
                  reuploading={reuploadingFx}
                  onCropped={handleReuploadFxRow}
                />
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1.5 shrink-0 items-start">
            <button onClick={() => setEditing(true)}
              className="text-xs text-blue-600 font-medium px-1.5 py-0.5 rounded hover:bg-blue-50">
              Edit
            </button>
            <button onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-500 font-medium px-1.5 py-0.5 rounded hover:bg-red-50">
              Del
            </button>
          </div>
        )}
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

function documentType(doc) {
  return doc.document_type ?? doc.type ?? 'document'
}

function formatDocumentType(type) {
  const raw = String(type || 'document')
  const parts = raw.split('_')
  const [first, ...rest] = parts
  const acronym = first.toLowerCase()

  if (acronym === 'loa' || acronym === 'rfp') {
    return [acronym.toUpperCase(), ...rest.map((part) => part.toUpperCase())].join(' ')
  }
  if (raw === 'email_screenshot') return 'Email screenshot'
  if (raw === 'compiled') return 'Compiled PDF'

  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function DocumentsCard({ documents = [] }) {
  const compiled = documents.find((doc) => documentType(doc) === 'compiled')
  const sourceDocs = documents.filter((doc) => documentType(doc) !== 'compiled')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <IconFileText className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-800">Documents</h2>
            <p className="text-xs text-gray-400">
              {documents.length} file{documents.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {compiled && (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-700">
            Compiled
          </span>
        )}
      </div>

      {compiled?.drive_file_id && (
        <a
          href={docUrl(compiled.drive_file_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-3 py-3 text-white shadow-sm active:bg-indigo-700"
        >
          <span className="flex min-w-0 items-center gap-2">
            <IconFileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Compiled PDF</span>
              <span className="block text-[11px] text-indigo-100">Ready to submit</span>
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-white/15 px-2 py-1 text-xs font-semibold">Open</span>
        </a>
      )}

      {sourceDocs.length > 0 && (
        <div className="grid gap-2">
          {sourceDocs.map((doc, idx) => (
            <DocumentRow key={doc.id ?? `${documentType(doc)}-${idx}`} doc={doc} />
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentRow({ doc }) {
  const typeLabel = formatDocumentType(documentType(doc))

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-gray-400">
        <IconFileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-700">{typeLabel}</span>
        <span className="block text-[11px] text-gray-400">PDF</span>
      </span>
      {doc.drive_file_id ? (
        <a
          href={docUrl(doc.drive_file_id)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-blue-600"
        >
          Open
        </a>
      ) : (
        <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-400">
          Missing
        </span>
      )}
    </div>
  )
}
