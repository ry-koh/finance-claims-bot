import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, DR_CR_OPTIONS, GST_CODES, RFP_WBS_ACCOUNTS, WBS_NUMBERS_BY_ACCOUNT } from '../constants/claimConstants'
import { useCreateRfp, useDeleteRfp, useRfps, useSendRfpToTelegram, useUpdateRfp } from '../api/rfps'
import { useAuth } from '../context/AuthContext'

const CATEGORY_OPTIONS = CATEGORIES.filter((category) => category !== 'N/A')
const EMPTY_LINE = { category: 'Meals & Refreshments', category_code: '', amount: '', gst_code: 'IE', dr_cr: 'DR' }
const PANEL_CLS = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4'
const MINI_PANEL_CLS = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3'
const LABEL_CLS = 'mb-1 block text-xs font-semibold text-[var(--color-muted)]'
const MUTED_TEXT_CLS = 'text-[var(--color-muted)]'
const STRONG_TEXT_CLS = 'text-[var(--color-text)]'

function formatAmount(amount) {
  return `$${Number(amount || 0).toFixed(2)}`
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function textInputCls(extra = '') {
  return `toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${extra}`
}

function apiErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => item?.msg).filter(Boolean)
    if (messages.length) return messages.join(' ')
  }
  return fallback
}

function LineItemEditor({ item, index, canRemove, onChange, onRemove }) {
  const isCustom = item.category === 'Custom'

  return (
    <div className={MINI_PANEL_CLS}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-wide ${MUTED_TEXT_CLS}`}>Line {index + 1}</p>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-xs font-bold text-[var(--color-danger)]">
            Remove
          </button>
        )}
      </div>
      <div className="grid gap-3">
        <label>
          <span className={LABEL_CLS}>Category</span>
          <select
            value={item.category}
            onChange={(event) => onChange({ category: event.target.value, category_code: '' })}
            className={textInputCls()}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
            <option value="Custom">Custom GL code</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={LABEL_CLS}>Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={item.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
              className={textInputCls()}
              placeholder="0.00"
            />
          </label>
          <label>
            <span className={LABEL_CLS}>GL code</span>
            <input
              value={item.category_code}
              onChange={(event) => onChange({ category_code: event.target.value })}
              className={textInputCls()}
              placeholder={isCustom ? 'Required' : 'Auto'}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={LABEL_CLS}>GST</span>
            <select
              value={item.gst_code}
              onChange={(event) => onChange({ gst_code: event.target.value })}
              className={textInputCls()}
            >
              {GST_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL_CLS}>DR/CR</span>
            <select
              value={item.dr_cr}
              onChange={(event) => onChange({ dr_cr: event.target.value })}
              className={textInputCls()}
            >
              {DR_CR_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}

function RfpRow({
  rfp,
  onSend,
  onDelete,
  onSaveNotes,
  onToggleComplete,
  sending,
  deleting,
  savingNotes,
  togglingComplete,
  disabled,
}) {
  const [notes, setNotes] = useState(rfp.internal_notes || '')
  const completed = Boolean(rfp.completed_at)

  useEffect(() => {
    setNotes(rfp.internal_notes || '')
  }, [rfp.internal_notes])

  return (
    <div className={MINI_PANEL_CLS}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-sm font-bold ${STRONG_TEXT_CLS}`}>{rfp.title}</p>
          <p className={`mt-0.5 text-xs ${MUTED_TEXT_CLS}`}>{rfp.reference_code} - {formatDate(rfp.created_at)}</p>
          <p className={`mt-1 truncate text-xs ${MUTED_TEXT_CLS}`}>{rfp.payee_name} - {rfp.payee_matric_no}</p>
          <p className={`mt-1 truncate text-xs ${MUTED_TEXT_CLS}`}>{rfp.wbs_account || 'WBS'} - {rfp.wbs_no}</p>
          {completed && (
            <p className="mt-1 text-[11px] font-bold text-[var(--color-success)]">Completed {formatDate(rfp.completed_at)}</p>
          )}
        </div>
        <p className={`shrink-0 text-sm font-bold ${STRONG_TEXT_CLS}`}>{formatAmount(rfp.total_amount)}</p>
      </div>
      <label className="mt-3 block">
        <span className={LABEL_CLS}>Internal notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={`${textInputCls('min-h-[4.5rem] resize-none py-2')}`}
          placeholder="Add follow-up notes"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {rfp.drive_url && (
          <a
            href={rfp.drive_url}
            target="_blank"
            rel="noreferrer"
            className="ui-button ui-button-secondary flex-1 text-xs"
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            Open
          </a>
        )}
        <button
          type="button"
          onClick={() => onSend(rfp.id)}
          disabled={disabled}
          className="ui-button ui-button-primary flex-1 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">send</span>
          {sending ? 'Sending...' : 'Send to me'}
        </button>
        <button
          type="button"
          onClick={() => onSaveNotes(rfp.id, notes)}
          disabled={disabled}
          className="ui-button ui-button-secondary flex-1 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">save</span>
          {savingNotes ? 'Saving...' : 'Save notes'}
        </button>
        <button
          type="button"
          onClick={() => onToggleComplete(rfp.id, !completed)}
          disabled={disabled}
          className="ui-button ui-button-secondary flex-1 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">{completed ? 'undo' : 'check_circle'}</span>
          {togglingComplete ? 'Saving...' : completed ? 'Reopen' : 'Complete'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(rfp.id, rfp.reference_code)}
          disabled={disabled}
          className="ui-button ui-button-danger flex-1 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">delete</span>
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
      {rfp.sent_to_telegram_at && (
        <p className="mt-2 text-[11px] font-medium text-[var(--color-success)]">Sent {formatDate(rfp.sent_to_telegram_at)}</p>
      )}
    </div>
  )
}

export default function RfpsPage() {
  const { user } = useAuth()
  const { data: rfps = [], isLoading, isError } = useRfps()
  const createMutation = useCreateRfp()
  const sendMutation = useSendRfpToTelegram()
  const updateMutation = useUpdateRfp()
  const deleteMutation = useDeleteRfp()

  const [title, setTitle] = useState('')
  const [referenceCode, setReferenceCode] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [payeeMatricNo, setPayeeMatricNo] = useState('')
  const [wbsAccount, setWbsAccount] = useState('SA')
  const [wbsNo, setWbsNo] = useState(WBS_NUMBERS_BY_ACCOUNT.SA)
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE }])
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [sendingId, setSendingId] = useState(null)
  const [savingNotesId, setSavingNotesId] = useState(null)
  const [togglingCompleteId, setTogglingCompleteId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const total = useMemo(
    () => lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [lineItems]
  )

  function updateLine(index, patch) {
    setLineItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function removeLine(index) {
    setLineItems((items) => items.filter((_, i) => i !== index))
  }

  function resetForm() {
    setTitle('')
    setReferenceCode('')
    setPayeeName('')
    setPayeeMatricNo('')
    setWbsAccount('SA')
    setWbsNo(WBS_NUMBERS_BY_ACCOUNT.SA)
    setLineItems([{ ...EMPTY_LINE }])
  }

  function selectWbsAccount(account) {
    setWbsAccount(account)
    setWbsNo(WBS_NUMBERS_BY_ACCOUNT[account] || '')
  }

  function useDirectorAsPayee() {
    const name = user?.name || ''
    const matric = user?.matric_number || ''
    setPayeeName(name)
    setPayeeMatricNo(matric)
    setNotice(null)
    setError(matric ? null : 'Your account is missing a matric number in Settings.')
  }

  function validateForm() {
    if (!title.trim()) return 'Add a short title for this RFP.'
    if (!payeeName.trim()) return 'Add the payment recipient name.'
    if (!payeeMatricNo.trim()) return 'Add the recipient ID, matric, staff number, or vendor ref.'
    if (!wbsNo.trim()) return 'Add the WBS number.'
    if (lineItems.some((item) => Number(item.amount || 0) <= 0)) return 'Every line needs an amount above 0.'
    if (lineItems.some((item) => item.category === 'Custom' && !item.category_code.trim())) return 'Custom lines need a GL code.'
    return null
  }

  function submitForm(event) {
    event.preventDefault()
    setNotice(null)
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    createMutation.mutate(
      {
        title: title.trim(),
        reference_code: referenceCode.trim() || undefined,
        payee_name: payeeName.trim(),
        payee_matric_no: payeeMatricNo.trim(),
        wbs_account: wbsAccount,
        wbs_no: wbsNo.trim(),
        line_items: lineItems.map((item) => ({
          category: item.category,
          category_code: item.category_code.trim() || undefined,
          amount: Number(item.amount),
          gst_code: item.gst_code,
          dr_cr: item.dr_cr,
        })),
      },
      {
        onSuccess: (created) => {
          setNotice(`Generated ${created.reference_code}.`)
          resetForm()
        },
        onError: (err) => setError(apiErrorMessage(err, 'Failed to generate RFP.')),
      }
    )
  }

  function sendToMe(rfpId) {
    setNotice(null)
    setError(null)
    setSendingId(rfpId)
    sendMutation.mutate(rfpId, {
      onSuccess: () => setNotice('RFP sent to you on Telegram.'),
      onError: (err) => setError(apiErrorMessage(err, 'Failed to send RFP.')),
      onSettled: () => setSendingId(null),
    })
  }

  function deleteStoredRfp(rfpId, referenceCodeForPrompt) {
    const confirmed = window.confirm(`Delete ${referenceCodeForPrompt || 'this RFP'}? This will also trash the Drive PDF.`)
    if (!confirmed) return
    setNotice(null)
    setError(null)
    setDeletingId(rfpId)
    deleteMutation.mutate(rfpId, {
      onSuccess: () => setNotice('RFP deleted.'),
      onError: (err) => setError(apiErrorMessage(err, 'Failed to delete RFP.')),
      onSettled: () => setDeletingId(null),
    })
  }

  function saveNotes(rfpId, internalNotes) {
    setNotice(null)
    setError(null)
    setSavingNotesId(rfpId)
    updateMutation.mutate(
      { rfpId, payload: { internal_notes: internalNotes } },
      {
        onSuccess: () => setNotice('RFP notes saved.'),
        onError: (err) => setError(apiErrorMessage(err, 'Failed to save RFP notes.')),
        onSettled: () => setSavingNotesId(null),
      }
    )
  }

  function toggleComplete(rfpId, completed) {
    setNotice(null)
    setError(null)
    setTogglingCompleteId(rfpId)
    updateMutation.mutate(
      { rfpId, payload: { completed } },
      {
        onSuccess: () => setNotice(completed ? 'RFP marked completed.' : 'RFP reopened.'),
        onError: (err) => setError(apiErrorMessage(err, 'Failed to update RFP status.')),
        onSettled: () => setTogglingCompleteId(null),
      }
    )
  }

  return (
    <div className="mobile-page mx-auto min-h-full max-w-2xl space-y-4 p-4 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-eyebrow">Finance Director</p>
          <h1 className={`mt-1 text-xl font-bold leading-7 ${STRONG_TEXT_CLS}`}>RFP generator</h1>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2 text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-accent)]">Current total</p>
          <p className={`text-base font-bold ${STRONG_TEXT_CLS}`}>{formatAmount(total)}</p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${error ? 'bg-[rgba(220,38,38,0.12)] text-[var(--color-danger)]' : 'bg-[rgba(5,150,105,0.12)] text-[var(--color-success)]'}`}>
          {error || notice}
        </div>
      )}

      <form onSubmit={submitForm} className="space-y-4">
        <section className={PANEL_CLS}>
          <h2 className={`text-sm font-bold ${STRONG_TEXT_CLS}`}>RFP details</h2>
          <div className="mt-3 grid gap-3">
            <label>
              <span className={LABEL_CLS}>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={textInputCls()} placeholder="Coach payment" />
            </label>
            <label>
              <span className={LABEL_CLS}>Reference code</span>
              <input value={referenceCode} onChange={(event) => setReferenceCode(event.target.value)} className={textInputCls()} placeholder="Auto if blank" />
            </label>
            <label>
              <span className={LABEL_CLS}>WBS account</span>
              <select value={wbsAccount} onChange={(event) => selectWbsAccount(event.target.value)} className={textInputCls()}>
                {RFP_WBS_ACCOUNTS.map((account) => (
                  <option key={account} value={account}>{account}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={LABEL_CLS}>WBS number</span>
              <input value={wbsNo} onChange={(event) => setWbsNo(event.target.value)} className={textInputCls()} placeholder="WBS shown on RFP" />
            </label>
          </div>
        </section>

        <section className={PANEL_CLS}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={`text-sm font-bold ${STRONG_TEXT_CLS}`}>Payment recipient</h2>
            <button
              type="button"
              onClick={useDirectorAsPayee}
              className="ui-button ui-button-secondary min-h-0 px-3 py-1.5 text-xs"
            >
              <span className="material-symbols-outlined text-base">person</span>
              Use me
            </button>
          </div>
          <p className={`mt-1 text-xs ${MUTED_TEXT_CLS}`}>Use the person or place the payment should go to.</p>
          <div className="mt-3 grid gap-3">
            <label>
              <span className={LABEL_CLS}>Name on RFP</span>
              <input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} className={textInputCls()} placeholder="Who payment goes to" />
            </label>
            <label>
              <span className={LABEL_CLS}>Matric / staff / vendor ref</span>
              <input value={payeeMatricNo} onChange={(event) => setPayeeMatricNo(event.target.value)} className={textInputCls()} placeholder="A0123456B or vendor ref" />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className={`text-sm font-bold ${STRONG_TEXT_CLS}`}>Line items</h2>
            <button
              type="button"
              onClick={() => setLineItems((items) => [...items, { ...EMPTY_LINE }])}
              disabled={lineItems.length >= 5}
              className="ui-button ui-button-secondary min-h-0 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Add line
            </button>
          </div>
          {lineItems.map((item, index) => (
            <LineItemEditor
              key={index}
              item={item}
              index={index}
              canRemove={lineItems.length > 1}
              onChange={(patch) => updateLine(index, patch)}
              onRemove={() => removeLine(index)}
            />
          ))}
        </section>

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="ui-button ui-button-primary w-full disabled:opacity-50"
        >
          {createMutation.isPending ? 'Generating RFP...' : 'Generate and store RFP'}
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className={`text-sm font-bold ${STRONG_TEXT_CLS}`}>Stored RFPs</h2>
          <span className={`text-xs font-medium ${MUTED_TEXT_CLS}`}>{rfps.length} file{rfps.length === 1 ? '' : 's'}</span>
        </div>
        {isLoading && <p className={`${MINI_PANEL_CLS} text-center text-sm ${MUTED_TEXT_CLS}`}>Loading RFPs...</p>}
        {isError && <p className="rounded-xl bg-[rgba(220,38,38,0.12)] p-4 text-center text-sm text-[var(--color-danger)]">Failed to load RFPs.</p>}
        {!isLoading && !isError && rfps.length === 0 && (
          <p className={`rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm ${MUTED_TEXT_CLS}`}>
            No manual RFPs generated yet.
          </p>
        )}
        {rfps.map((rfp) => (
          <RfpRow
            key={rfp.id}
            rfp={rfp}
            onSend={sendToMe}
            onDelete={deleteStoredRfp}
            onSaveNotes={saveNotes}
            onToggleComplete={toggleComplete}
            sending={sendMutation.isPending && sendingId === rfp.id}
            savingNotes={updateMutation.isPending && savingNotesId === rfp.id}
            togglingComplete={updateMutation.isPending && togglingCompleteId === rfp.id}
            deleting={deleteMutation.isPending && deletingId === rfp.id}
            disabled={sendMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
          />
        ))}
      </section>
    </div>
  )
}
