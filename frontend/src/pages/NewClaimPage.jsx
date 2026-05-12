import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePortfolios, useCcasByPortfolio } from '../api/portfolios'
import { useTreasurerOptions } from '../api/admin'
import { useCreateClaim, useSubmitForReview } from '../api/claims'
import { useCreateReceipt, uploadReceiptImageById, uploadReceiptFxImageById } from '../api/receipts'
import { useCreatePayer, useDeletePayer, usePayers, useUpdatePayer } from '../api/payers'
import { createBankTransaction, uploadBankTransactionImage, createBtRefund } from '../api/bankTransactions'
import { submitTransportData, uploadMfApproval } from '../api/documents'
import { CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'
import DragDropZone from '../components/DragDropZone'
import CroppableThumb from '../components/CroppableThumb'
import PayerSelect from '../components/PayerSelect'
import { IconChevronLeft } from '../components/Icons'

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CATEGORIES = 5

function today() {
  return new Date().toISOString().split('T')[0]
}

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
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

function oneOffSelfPayer(step1) {
  const name = step1.oneOffName?.trim()
  const email = cleanEmail(step1.oneOffEmail)
  if (!name || !email) return null
  return {
    id: `one-off:${email}`,
    name,
    email,
    is_self: true,
    is_saved: false,
  }
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, steps = ['Who', 'What', 'Transactions'] }) {
  return (
    <div
      className="stepper-shell mb-5 grid gap-1"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((label, i) => {
        const step = i + 1
        const active = step === current
        const done = step < current
        return (
          <div key={step} className="flex min-w-0 flex-col items-center">
            <div
              className={`stepper-dot ${done ? 'stepper-dot-done' : active ? 'stepper-dot-active' : ''}`}
            >
              {done ? 'OK' : step}
            </div>
            <span
              className={`mt-1 min-w-0 text-center text-[10px] font-bold uppercase leading-tight tracking-wide ${
                active ? 'text-blue-600' : done ? 'text-blue-400' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function Label({ children, required }) {
  return (
    <label className="section-eyebrow mb-1 block">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}

function Select({ value, onChange, disabled, placeholder, options, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`toolbar-field w-full px-3 text-sm disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 ${className}`}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) =>
        typeof opt === 'string' ? (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ) : (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        )
      )}
    </select>
  )
}

function Input({ value, onChange, type = 'text', placeholder, disabled, inputMode, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      inputMode={inputMode}
      className={`toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400 ${type === 'date' ? 'max-w-[200px]' : ''} ${className}`}
    />
  )
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="toolbar-field w-full resize-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
    />
  )
}

// ─── Step 1: Who ──────────────────────────────────────────────────────────────

function Step1({ data, onChange }) {
  const { data: portfolios = [], isLoading: portfoliosLoading } = usePortfolios()
  const { data: ccas = [], isLoading: ccasLoading } = useCcasByPortfolio(data.portfolioId)
  const { data: treasurers = [], isLoading: treasurersLoading } = useTreasurerOptions(data.ccaId)

  const portfolioOptions = portfolios.map((p) => ({ value: p.id, label: p.name }))
  const ccaOptions = ccas.map((c) => ({ value: c.id, label: c.name }))
  const treasurerOptions = treasurers.map((t) => ({ value: t.id, label: t.name }))

  function handlePortfolioChange(val) {
    onChange({ portfolioId: val, ccaId: '', claimerId: '', isOneOff: false })
  }

  function handleCcaChange(val) {
    onChange({ ccaId: val, claimerId: '', isOneOff: false })
  }

  return (
    <div className="space-y-4">
      {/* Portfolio */}
      <div>
        <Label required>Portfolio</Label>
        {portfoliosLoading ? (
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <Select
            value={data.portfolioId}
            onChange={handlePortfolioChange}
            placeholder="Select portfolio…"
            options={portfolioOptions}
          />
        )}
      </div>

      {/* CCA */}
      <div>
        <Label required>CCA</Label>
        <Select
          value={data.ccaId}
          onChange={handleCcaChange}
          placeholder={data.portfolioId ? (ccasLoading ? 'Loading…' : 'Select CCA…') : 'Select portfolio first'}
          options={ccaOptions}
          disabled={!data.portfolioId || ccasLoading}
        />
      </div>

      {/* Treasurer or One-Off Toggle */}
      {data.ccaId && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label required>Claimer</Label>
            <button
              type="button"
              onClick={() => onChange({ isOneOff: !data.isOneOff, claimerId: '' })}
              className="text-xs text-blue-600 font-medium"
            >
              {data.isOneOff ? 'Select treasurer instead' : 'One-off claimer'}
            </button>
          </div>

          {!data.isOneOff && (
            <Select
              value={data.claimerId}
              onChange={(val) => onChange({ claimerId: val })}
              placeholder={treasurersLoading ? 'Loading…' : treasurers.length === 0 ? 'No treasurers for this CCA' : 'Select treasurer…'}
              options={treasurerOptions}
              disabled={treasurersLoading || treasurers.length === 0}
            />
          )}

          {data.isOneOff && (
            <div className="border border-blue-200 rounded-xl bg-blue-50 p-3 mt-1 space-y-2">
              <p className="text-xs font-semibold text-blue-700 mb-2">One-off Claimer</p>
              <div>
                <Label required>Name</Label>
                <Input
                  value={data.oneOffName}
                  onChange={(v) => onChange({ oneOffName: v })}
                  placeholder="Full name"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Matric No.</Label>
                  <Input
                    value={data.oneOffMatricNo}
                    onChange={(v) => onChange({ oneOffMatricNo: v })}
                    placeholder="A0XXXXXXX"
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={data.oneOffPhone}
                    onChange={(v) => onChange({ oneOffPhone: v })}
                    placeholder="XXXXXXXX"
                  />
                </div>
              </div>
              <div>
                <Label required>School Email</Label>
                <Input
                  type="email"
                  value={data.oneOffEmail}
                  onChange={(v) => onChange({ oneOffEmail: v })}
                  placeholder="XXX@u.nus.edu"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Transport Trips Input ─────────────────────────────────────────────────────

const EMPTY_TRIP = { from: '', to: '', purpose: '', date: '', time: '', amount: '', distance_km: '' }

// DD/MM/YYYY → YYYY-MM-DD for backend submission (PDF requires YYYY-MM-DD)
function parseDMY(dmy) {
  if (!dmy) return ''
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
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

  return (
    <div className="space-y-3 bg-blue-50 rounded-xl p-3">
      <p className="text-xs font-medium text-blue-700">Transport Trips (max 3)</p>
      {trips.length === 0 && (
        <p className="text-xs text-gray-400">No trips added yet.</p>
      )}
      {trips.map((trip, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">Trip {i + 1}</span>
            <button type="button" onClick={() => removeTrip(i)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Date</label>
              <Input value={trip.date} onChange={(v) => updateTrip(i, 'date', v)} placeholder="DD/MM/YYYY" inputMode="numeric" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Time Started</label>
              <Input value={trip.time} onChange={(v) => updateTrip(i, 'time', v)} placeholder="9:30 AM" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">From</label>
              <Input value={trip.from} onChange={(v) => updateTrip(i, 'from', v)} placeholder="Origin" />
            </div>
            <div>
              <label className="text-xs text-gray-500">To</label>
              <Input value={trip.to} onChange={(v) => updateTrip(i, 'to', v)} placeholder="Destination" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">Purpose</label>
            <Input value={trip.purpose} onChange={(v) => updateTrip(i, 'purpose', v)} placeholder="Purpose of trip" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Amount ($)</label>
              <Input type="number" step="0.01" min="0" value={trip.amount} onChange={(v) => updateTrip(i, 'amount', v)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Distance (km)</label>
              <Input type="number" step="0.1" min="0" value={trip.distance_km} onChange={(v) => updateTrip(i, 'distance_km', v)} placeholder="0.0" />
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


// ─── Step 2: What ─────────────────────────────────────────────────────────────

function Step2({ data, onChange, isTreasurer }) {
  return (
    <div className="space-y-4">
      {/* Claim Description */}
      <div>
        <Label required>Claim Description</Label>
        <Textarea
          value={data.claimDescription}
          onChange={(v) => onChange({ claimDescription: v })}
          placeholder="Describe the purpose of this claim…"
        />
      </div>

      {/* Date */}
      <div>
        <Label required>Date</Label>
        <Input
          type="date"
          value={data.date}
          onChange={(v) => onChange({ date: v })}
        />
      </div>

      {/* Master Fund question */}
      <div>
        <Label required>Are you using Master Fund?</Label>
        <div className="flex gap-2 mt-1">
          {[
            { label: 'No', value: 'SA' },
            { label: 'Yes', value: 'MF' },
            { label: 'Others', value: 'OTHERS' },
          ].map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ wbsAccount: value })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                data.wbsAccount === value
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* MF Approval upload — shown only when WBS Account is Master's Fund */}
      {data.wbsAccount === 'MF' && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">Master's Fund Approval</p>
          <p className="text-xs text-amber-700">Attach approval proof if it applies to this claim. You can still submit without it.</p>
          {data.mfApprovalFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {data.mfApprovalFiles.map((f, i) => (
                <CroppableThumb
                  key={i}
                  file={f}
                  label={f.name}
                  onRemove={() => onChange({ mfApprovalFiles: data.mfApprovalFiles.filter((_, j) => j !== i) })}
                  onCropped={(cf) => onChange({ mfApprovalFiles: data.mfApprovalFiles.map((x, j) => j === i ? cf : x) })}
                  onCroppedMany={(cfs) => onChange({ mfApprovalFiles: [...data.mfApprovalFiles.slice(0, i), ...cfs, ...data.mfApprovalFiles.slice(i + 1)] })}
                />
              ))}
            </div>
          )}
          <DragDropZone
            label={data.mfApprovalFiles.length > 0 ? '+ Add more pages' : 'Upload approval'}
            onFiles={(files) => onChange({ mfApprovalFiles: [...data.mfApprovalFiles, ...files] })}
            multiple
            dragBorder="border-amber-400 bg-amber-50"
            idleBorder="border-amber-300 bg-amber-50 hover:bg-amber-100"
            withCrop
          />
        </div>
      )}

      {/* Remarks — hidden for treasurers */}
      {!isTreasurer && (
        <div>
          <Label>Remarks</Label>
          <p className="text-xs text-gray-400 mb-1">Write each remark starting with "- " e.g. - Bought for event</p>
          <Textarea
            value={data.remarks}
            onChange={(v) => onChange({ remarks: v })}
            placeholder="- Optional remark…"
            rows={2}
          />
        </div>
      )}

      {/* Partial Claim */}
      <div className="flex items-center gap-2">
        <input
          id="is-partial"
          type="checkbox"
          checked={data.isPartial}
          onChange={(e) => onChange({ isPartial: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
        />
        <label htmlFor="is-partial" className="text-sm text-gray-700">
          Partial claim — set claimed amount per receipt in Step 3
        </label>
      </div>

      {/* Transport Form Needed */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            id="transport-form"
            type="checkbox"
            checked={data.transportFormNeeded}
            onChange={(e) => onChange({ transportFormNeeded: e.target.checked, transportTrips: e.target.checked ? data.transportTrips : [] })}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
          />
          <label htmlFor="transport-form" className="text-sm text-gray-700">
            Transport form needed <span className="text-gray-400">(mark this if you are claiming a Grab/Gojek/Tada transport claim)</span>
          </label>
        </div>
        {data.transportFormNeeded && (
          <TransportTripsInput
            trips={data.transportTrips}
            onChange={(trips) => onChange({ transportTrips: trips })}
          />
        )}
      </div>

    </div>
  )
}

// ─── Receipt Form (shared sub-component) ─────────────────────────────────────

const EMPTY_RECEIPT = {
  description: '',
  amount: '',
  claimed_amount: '',
  category: '',
  gst_code: 'IE',
  dr_cr: 'DR',
  receipt_no: '',
  company: '',
  date: '',
  payer_id: null,
  payer_name: '',
  payer_email: '',
  files: [],
  is_foreign_currency: false,
  fx_screenshot_files: [],
}

function ReceiptForm({
  onAdd,
  onEdit,
  existingCategories,
  initial,
  isTreasurer,
  isPartial,
  payerOptions,
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManagePayers,
  payersLoading,
}) {
  const [form, setForm] = useState(
    initial
      ? { ...initial, amount: String(initial.amount), claimed_amount: String(initial.claimed_amount ?? '') }
      : { ...EMPTY_RECEIPT }
  )
  const [errors, setErrors] = useState({})

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.description.trim()) e.description = 'Required'
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)
      e.amount = 'Enter a valid amount > 0'
    if (!isTreasurer && !form.category) e.category = 'Required'
    if (!form.date) e.date = 'Required'
    if (!form.payer_name?.trim() || !form.payer_email?.trim()) e.payer = 'Select who paid for this receipt'
    return e
  }

  function handleAdd() {
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }

    if (!initial) {
      const uniqueAfter = new Set([...existingCategories, form.category])
      if (uniqueAfter.size > MAX_CATEGORIES) {
        setErrors({ category: `Max ${MAX_CATEGORIES} categories per claim. Please split into a separate claim.` })
        return
      }
    }

    const result = {
      ...form,
      amount: Number(form.amount),
      claimed_amount: (isPartial && form.claimed_amount) ? Number(form.claimed_amount) : undefined,
      category: isTreasurer ? (form.category || 'N/A') : form.category,
    }
    if (onEdit) {
      onEdit(result)
    } else {
      onAdd(result)
      setForm({ ...EMPTY_RECEIPT })
    }
    setErrors({})
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-gray-700">Add Receipt</p>

      {/* Receipt photos */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Receipt Photos</p>
        {form.files.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-2">
            {form.files.map((file, i) => (
              <CroppableThumb
                key={i}
                file={file}
                label={file.name}
                onRemove={() => setForm((prev) => ({ ...prev, files: prev.files.filter((_, j) => j !== i) }))}
                onCropped={(f) => setForm((prev) => ({ ...prev, files: prev.files.map((x, j) => j === i ? f : x) }))}
                onCroppedMany={(fs) => setForm((prev) => ({ ...prev, files: [...prev.files.slice(0, i), ...fs, ...prev.files.slice(i + 1)] }))}
              />
            ))}
          </div>
        )}
        <DragDropZone
          label="+ Add photo"
          onFiles={(files) => setForm((prev) => ({ ...prev, files: [...prev.files, ...files] }))}
          multiple
          compact
          withCrop
        />
      </div>

      <div>
        <Label required>Description</Label>
        <Input
          value={form.description}
          onChange={(v) => set('description', v)}
          placeholder="Receipt description…"
        />
        {errors.description && <p className="text-xs text-red-500 mt-0.5">{errors.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label required>Amount ($)</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={form.amount}
            onChange={(v) => set('amount', v)}
            placeholder="0.00"
          />
          {errors.amount && <p className="text-xs text-red-500 mt-0.5">{errors.amount}</p>}
        </div>
        {!isTreasurer && (
          <div>
            <Label required>Category</Label>
            <Select
              value={form.category}
              onChange={(v) => set('category', v)}
              placeholder="Select…"
              options={CATEGORIES}
            />
            {errors.category && <p className="text-xs text-red-500 mt-0.5">{errors.category}</p>}
          </div>
        )}
      </div>

      {isPartial && (
        <div>
          <Label>Claimed Amount ($)</Label>
          <p className="text-xs text-gray-400 mb-1">Leave blank to claim the full amount above</p>
          <Input
            type="number"
            inputMode="decimal"
            value={form.claimed_amount}
            onChange={(v) => set('claimed_amount', v)}
            placeholder="0.00"
          />
        </div>
      )}

      <PayerSelect
        payer={{
          payer_id: form.payer_id,
          payer_name: form.payer_name,
          payer_email: form.payer_email,
        }}
        onChange={(payer) => {
          setForm((prev) => ({ ...prev, ...payer }))
          if (errors.payer) setErrors((prev) => ({ ...prev, payer: '' }))
        }}
        options={payerOptions}
        onCreatePayer={onCreatePayer}
        onUpdatePayer={onUpdatePayer}
        onDeletePayer={onDeletePayer}
        canManageSaved={canManagePayers}
        loading={payersLoading}
        error={errors.payer}
      />

      {!isTreasurer && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label required>GST Code</Label>
            <Select
              value={form.gst_code}
              onChange={(v) => set('gst_code', v)}
              options={GST_CODES}
            />
          </div>
          <div>
            <Label required>DR / CR</Label>
            <Select
              value={form.dr_cr}
              onChange={(v) => set('dr_cr', v)}
              options={DR_CR_OPTIONS}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Receipt No.</Label>
          <Input
            value={form.receipt_no}
            onChange={(v) => set('receipt_no', v)}
            placeholder=""
          />
        </div>
        <div>
          <Label>Company</Label>
          <Input
            value={form.company}
            onChange={(v) => set('company', v)}
            placeholder=""
          />
        </div>
      </div>

      <div>
        <Label required>Receipt Date</Label>
        <Input
          type="date"
          value={form.date}
          onChange={(v) => set('date', v)}
        />
        {errors.date && <p className="text-xs text-red-500 mt-0.5">{errors.date}</p>}
      </div>

      {/* Foreign currency */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            id="fx-check"
            type="checkbox"
            checked={form.is_foreign_currency}
            onChange={(e) => {
              set('is_foreign_currency', e.target.checked)
              if (!e.target.checked) set('fx_screenshot_files', [])
            }}
            className="w-4 h-4 text-orange-500 border-gray-300 rounded"
          />
          <label htmlFor="fx-check" className="text-sm text-gray-700">Charged in foreign currency</label>
        </div>
        {form.is_foreign_currency && (
          <div className="pl-6">
            <Label required>Exchange Rate Screenshot</Label>
            {form.fx_screenshot_files?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {form.fx_screenshot_files.map((f, i) => (
                  <CroppableThumb
                    key={i}
                    file={f}
                    label={f.name}
                    onRemove={() => set('fx_screenshot_files', form.fx_screenshot_files.filter((_, j) => j !== i))}
                    onCropped={(cf) => set('fx_screenshot_files', form.fx_screenshot_files.map((x, j) => j === i ? cf : x))}
                    onCroppedMany={(cfs) => set('fx_screenshot_files', [...form.fx_screenshot_files.slice(0, i), ...cfs, ...form.fx_screenshot_files.slice(i + 1)])}
                  />
                ))}
              </div>
            )}
            <DragDropZone
              label="+ Add exchange rate screenshot"
              onFiles={(files) => set('fx_screenshot_files', [...(form.fx_screenshot_files ?? []), ...files])}
              multiple
              compact
              withCrop
              dragBorder="border-orange-400 bg-orange-50"
              idleBorder="border-orange-300 bg-orange-50 hover:bg-orange-100"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="w-full bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg mt-1"
      >
        {onEdit ? 'Save' : 'Add to List'}
      </button>
    </div>
  )
}

// ─── DraftReceiptRow ──────────────────────────────────────────────────────────

function BankOnlyClaimItemForm({
  bt,
  btIndex,
  isTreasurer,
  onChange,
  payerOptions,
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManagePayers,
  payersLoading,
}) {
  const item = bt.claimItem || {}
  const inputBaseCls = 'box-border block w-full min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300'
  const inputCls = `${inputBaseCls} max-w-full`
  const dateInputCls = `${inputBaseCls} max-w-[min(100%,200px)]`
  const set = (field, value) => onChange({ ...item, [field]: value })
  const setPayer = (payer) => onChange({ ...item, ...payer })

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-3">
        <p className="text-xs font-bold text-amber-900">Bank transaction-only claim item</p>
        <p className="mt-1 text-xs text-amber-800">
          No separate receipt is attached. Fill these details so this item appears properly in the Summary and RFP.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <Label required>Receipt description</Label>
          <input
            className={inputCls}
            value={item.description || ''}
            onChange={(e) => set('description', e.target.value)}
            placeholder={`Bank transaction ${btIndex} claim item`}
          />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div className="min-w-0">
            <Label>Company</Label>
            <input
              className={inputCls}
              value={item.company || ''}
              onChange={(e) => set('company', e.target.value)}
              placeholder="Company / payee"
            />
          </div>
          <div className="min-w-0">
            <Label required>Date</Label>
            <input
              className={dateInputCls}
              type="date"
              value={item.date || ''}
              onChange={(e) => set('date', e.target.value)}
            />
          </div>
        </div>

        <PayerSelect
          payer={{
            payer_id: item.payer_id ?? null,
            payer_name: item.payer_name || '',
            payer_email: item.payer_email || '',
          }}
          onChange={setPayer}
          options={payerOptions}
          onCreatePayer={onCreatePayer}
          onUpdatePayer={onUpdatePayer}
          onDeletePayer={onDeletePayer}
          canManageSaved={canManagePayers}
          loading={payersLoading}
        />

        {!isTreasurer && (
          <div className="space-y-2 border-t border-amber-200 pt-3">
            <div>
              <Label required>Category</Label>
              <Select
                value={item.category || ''}
                onChange={(value) => set('category', value)}
                placeholder="Select category"
                options={CATEGORIES}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <Label>GST Code</Label>
                <Select
                  value={item.gst_code || 'IE'}
                  onChange={(value) => set('gst_code', value)}
                  options={GST_CODES}
                />
              </div>
              <div className="min-w-0">
                <Label>DR / CR</Label>
                <Select
                  value={item.dr_cr || 'DR'}
                  onChange={(value) => set('dr_cr', value)}
                  options={DR_CR_OPTIONS}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DraftReceiptRow({
  receipt,
  onEdit,
  onRemove,
  existingCategories,
  isTreasurer,
  isPartial,
  payerOptions,
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManagePayers,
  payersLoading,
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div>
        <ReceiptForm
          initial={receipt}
          onEdit={(updated) => { onEdit(receipt.localId, updated); setEditing(false) }}
          existingCategories={existingCategories.filter((c) => c !== receipt.category)}
          isTreasurer={isTreasurer}
          isPartial={isPartial}
          payerOptions={payerOptions}
          onCreatePayer={onCreatePayer}
          onUpdatePayer={onUpdatePayer}
          onDeletePayer={onDeletePayer}
          canManagePayers={canManagePayers}
          payersLoading={payersLoading}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="w-full mt-2 text-xs text-gray-500 py-1"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">{receipt.description}</p>
        <p className="text-xs text-gray-500">
          {receipt.category}{receipt.company ? ` · ${receipt.company}` : ''}
          {receipt.payer_name ? ` · paid by ${receipt.payer_name}` : ''}
          {receipt.files?.length > 0 && ` · ${receipt.files.length} photo${receipt.files.length !== 1 ? 's' : ''}`}
          {receipt.is_foreign_currency && <span className="ml-1 text-orange-600 font-semibold">FX</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-2 shrink-0">
        <span className="text-xs font-bold text-gray-900">
          ${(receipt.claimed_amount ?? receipt.amount).toFixed(2)}
          {receipt.claimed_amount != null && <span className="text-gray-400 font-normal"> ({receipt.amount.toFixed(2)})</span>}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-blue-600 font-medium"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onRemove(receipt.localId)}
          className="text-gray-400 hover:text-red-500 text-sm leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ─── NewBtDraftModal ──────────────────────────────────────────────────────────

function NewBtDraftModal({ initial, onSave, onClose }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [files, setFiles] = useState(initial?.files ?? [])
  const [refunds, setRefunds] = useState(initial?.refunds ?? [])
  const [err, setErr] = useState('')

  const netAmount = Number(amount || 0) - refunds.reduce((s, r) => s + Number(r.amount || 0), 0)

  function addRefund() {
    setRefunds((prev) => [...prev, { localId: generateId(), amount: '', files: [] }])
  }

  function updateRefund(localId, patch) {
    setRefunds((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)))
  }

  function removeRefund(localId) {
    setRefunds((prev) => prev.filter((r) => r.localId !== localId))
  }

  function handleSave() {
    const val = Number(amount)
    if (!amount || isNaN(val) || val <= 0) {
      setErr('Enter a valid amount')
      return
    }
    for (const r of refunds) {
      if (r.amount && !r.files?.length) { setErr('Each refund needs a file'); return }
      if (!r.amount && r.files?.length) { setErr('Each refund needs an amount'); return }
    }
    onSave({ amount: val, files, refunds: refunds.filter((r) => r.amount && r.files?.length) })
  }

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="bg-white w-full max-w-lg rounded-t-2xl shadow-xl p-5 pb-8 flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">
            {initial ? 'Edit Bank Transaction' : 'New Bank Transaction'}
          </p>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        {err && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</p>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount ($) *</label>
          <input
            className={inputCls}
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setErr('') }}
          />
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Bank Screenshots</p>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-2">
              {files.map((file, i) => (
                <CroppableThumb
                  key={i}
                  file={file}
                  label={file.name}
                  onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  onCropped={(f) => setFiles((prev) => prev.map((x, j) => j === i ? f : x))}
                  onCroppedMany={(fs) => setFiles((prev) => [...prev.slice(0, i), ...fs, ...prev.slice(i + 1)])}
                />
              ))}
            </div>
          )}
          <DragDropZone
            label="+ Add screenshot"
            onFiles={(files) => setFiles((prev) => [...prev, ...files])}
            multiple
            compact
            withCrop
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-600">Refunds</p>
            <button type="button" onClick={addRefund} className="text-xs text-blue-600 font-medium">
              + Add Refund
            </button>
          </div>
          {refunds.map((refund) => (
            <div key={refund.localId} className="flex items-center gap-2 mb-1.5">
              <input
                type="number"
                inputMode="decimal"
                placeholder="Amount"
                value={refund.amount}
                onChange={(e) => updateRefund(refund.localId, { amount: e.target.value })}
                className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                {refund.files?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {refund.files.map((f, fi) => (
                      <CroppableThumb
                        key={fi}
                        file={f}
                        label={f.name}
                        onRemove={() => updateRefund(refund.localId, { files: refund.files.filter((_, j) => j !== fi) })}
                        onCropped={(cf) => updateRefund(refund.localId, { files: refund.files.map((x, j) => j === fi ? cf : x) })}
                        onCroppedMany={(cfs) => updateRefund(refund.localId, { files: [...refund.files.slice(0, fi), ...cfs, ...refund.files.slice(fi + 1)] })}
                      />
                    ))}
                  </div>
                )}
                <DragDropZone
                  label="+ Attach File"
                  onFiles={(fs) => updateRefund(refund.localId, { files: [...(refund.files ?? []), ...fs] })}
                  multiple
                  compact
                  withCrop
                />
              </div>
              <button type="button" onClick={() => removeRefund(refund.localId)} className="text-red-400 text-sm">×</button>
            </div>
          ))}
          {refunds.length > 0 && Number(amount) > 0 && (
            <p className="text-xs text-gray-600 mt-1">
              Net amount: <strong>${netAmount.toFixed(2)}</strong>
              {netAmount < 0 && <span className="text-red-500 ml-1">(Refunds exceed amount!)</span>}
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg">
            Save
          </button>
          <button onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-2 rounded-lg">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BtDraftCard ──────────────────────────────────────────────────────────────

function BtDraftCard({
  bt, btIndex, linkedReceipts, expanded, onToggle, onRemove, onEdit,
  onAddReceipt, onRemoveReceipt, onEditReceipt, onUpdateBankOnlyItem, existingCategories,
  onAddBtFiles, onRemoveBtFile, isTreasurer, isPartial,
  payerOptions, onCreatePayer, onUpdatePayer, onDeletePayer, canManagePayers, payersLoading,
}) {
  const [showReceiptForm, setShowReceiptForm] = useState(false)
  const receiptSum = linkedReceipts.reduce((s, r) => s + (r.claimed_amount ?? r.amount), 0)
  const hasLinkedReceipts = linkedReceipts.length > 0
  const netAmount = bt.refunds?.length > 0
    ? bt.amount - bt.refunds.reduce((s, r) => s + Number(r.amount || 0), 0)
    : null

  useEffect(() => {
    if (bt.noReceiptAttached) setShowReceiptForm(false)
  }, [bt.noReceiptAttached])

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2.5 bg-gray-50">
        <button type="button" onClick={onToggle} className="flex-1 flex items-center gap-2 text-left">
          <span className="text-gray-400 text-xs">{expanded ? '▼' : '▶'}</span>
          <span className="flex-1 text-xs font-semibold text-gray-700">
            Bank Tx {btIndex} · ${bt.amount.toFixed(2)}
            {netAmount !== null && (
              <span className="font-normal text-gray-500"> · net ${netAmount.toFixed(2)}</span>
            )}
            {hasLinkedReceipts && (
              <span className="font-normal text-gray-500">
                {' '}· {linkedReceipts.length} receipt{linkedReceipts.length !== 1 ? 's' : ''} · ${receiptSum.toFixed(2)}
              </span>
            )}
            {!hasLinkedReceipts && bt.noReceiptAttached && (
              <span className="font-normal text-amber-600"> - bank transaction-only</span>
            )}
            {bt.files?.length > 0 && (
              <span className="font-normal text-gray-400">
                {' '}· {bt.files.length} img
              </span>
            )}
            {isTreasurer && (
              <span className="mt-1 block text-[11px] font-medium text-gray-500">
                {expanded
                  ? `Receipts added below will be attached to Bank Tx ${btIndex}.`
                  : 'Tap to open this bank transaction and attach its receipts.'}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className={`text-xs text-blue-600 font-medium px-1.5 leading-none ${!onEdit ? 'hidden' : ''}`}
          title="Edit"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`text-gray-400 hover:text-red-500 text-sm px-1 leading-none ${!onRemove ? 'hidden' : ''}`}
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="px-3 py-2.5 space-y-2">
          {isTreasurer && (
            <p className="rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700">
              Add the receipts paid by this bank transaction here. Use the unlinked section only if there is no matching bank transaction.
            </p>
          )}
          {hasLinkedReceipts && (
            <div className="space-y-1">
              {linkedReceipts.map((r) => (
                <DraftReceiptRow
                  key={r.localId}
                  receipt={r}
                  onEdit={onEditReceipt}
                  onRemove={onRemoveReceipt}
                  existingCategories={existingCategories}
                  isTreasurer={isTreasurer}
                  isPartial={isPartial}
                  payerOptions={payerOptions}
                  onCreatePayer={onCreatePayer}
                  onUpdatePayer={onUpdatePayer}
                  onDeletePayer={onDeletePayer}
                  canManagePayers={canManagePayers}
                  payersLoading={payersLoading}
                />
              ))}
            </div>
          )}

          {!hasLinkedReceipts && onUpdateBankOnlyItem && (
            <>
              <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                <input
                  type="checkbox"
                  checked={Boolean(bt.noReceiptAttached)}
                  onChange={(event) => onUpdateBankOnlyItem({
                    ...(bt.claimItem || {}),
                    noReceiptAttached: event.target.checked,
                  })}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600"
                />
                <span>No separate receipt is attached to this bank transaction</span>
              </label>
              {bt.noReceiptAttached && (
                <BankOnlyClaimItemForm
                  bt={bt}
                  btIndex={btIndex}
                  isTreasurer={isTreasurer}
                  onChange={onUpdateBankOnlyItem}
                  payerOptions={payerOptions}
                  onCreatePayer={onCreatePayer}
                  onUpdatePayer={onUpdatePayer}
                  onDeletePayer={onDeletePayer}
                  canManagePayers={canManagePayers}
                  payersLoading={payersLoading}
                />
              )}
            </>
          )}

          {!bt.noReceiptAttached && (
            !showReceiptForm ? (
              <button
                type="button"
                onClick={() => setShowReceiptForm(true)}
                className="w-full border border-dashed border-blue-200 text-blue-600 text-xs font-medium py-2 rounded-lg"
              >
                {isTreasurer ? `+ Add receipt for Bank Tx ${btIndex}` : '+ Add Receipt'}
              </button>
            ) : (
              <div>
                <ReceiptForm
                  onAdd={(r) => { onAddReceipt(r); setShowReceiptForm(false) }}
                  existingCategories={existingCategories}
                  isTreasurer={isTreasurer}
                  isPartial={isPartial}
                  payerOptions={payerOptions}
                  onCreatePayer={onCreatePayer}
                  onUpdatePayer={onUpdatePayer}
                  onDeletePayer={onDeletePayer}
                  canManagePayers={canManagePayers}
                  payersLoading={payersLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowReceiptForm(false)}
                  className="w-full mt-2 text-xs text-gray-500 py-1"
                >
                  Cancel
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Bank Transactions & Receipts ─────────────────────────────────────

function hasDraftFiles(step2, receipts, bankTransactions) {
  if (step2?.mfApprovalFiles?.length) return true
  if (receipts.some((r) => r.files?.length || r.fx_screenshot_files?.length)) return true
  return bankTransactions.some((bt) =>
    bt.files?.length || (bt.refunds ?? []).some((refund) => refund.files?.length)
  )
}

function bankTransactionNetAmount(bt) {
  const refundTotal = (bt.refunds ?? []).reduce((s, refund) => s + Number(refund.amount || 0), 0)
  return Number(bt.amount || 0) - refundTotal
}

function bankOnlyTransactions(receipts, bankTransactions) {
  return bankTransactions.filter((bt) =>
    bt.noReceiptAttached && !receipts.some((receipt) => receipt.btLocalId === bt.localId)
  )
}

function bankOnlyReceiptDrafts(receipts, bankTransactions, fallbackPayer, isTreasurer = false) {
  return bankTransactions
    .map((bt, index) => ({ bt, index }))
    .filter(({ bt }) =>
      bt.noReceiptAttached && !receipts.some((receipt) => receipt.btLocalId === bt.localId)
    )
    .map(({ bt, index }) => {
      const item = bt.claimItem || {}
      return {
        localId: `bank-only:${bt.localId}`,
        btLocalId: bt.localId,
        receipt_no: `BT${index + 1}`,
        description: item.description || '',
        company: item.company || '',
        date: item.date || '',
        amount: bankTransactionNetAmount(bt),
        payer_id: item.payer_id ?? (fallbackPayer?.is_saved ? fallbackPayer.id : null),
        payer_name: item.payer_name || fallbackPayer?.name || '',
        payer_email: item.payer_email || fallbackPayer?.email || '',
        category: item.category || (isTreasurer ? 'N/A' : ''),
        gst_code: item.gst_code || 'IE',
        dr_cr: item.dr_cr || 'DR',
        is_foreign_currency: false,
        files: [],
        fx_screenshot_files: [],
        isBankOnlyReceipt: true,
      }
    })
}

function claimDraftTotal(receipts, bankTransactions) {
  const receiptTotal = receipts.reduce((sum, receipt) => sum + Number(receipt.claimed_amount ?? receipt.amount ?? 0), 0)
  const bankOnlyTotal = bankOnlyTransactions(receipts, bankTransactions).reduce(
    (sum, bt) => sum + bankTransactionNetAmount(bt),
    0
  )
  return receiptTotal + bankOnlyTotal
}

function payerSplitRows(receipts, bankTransactions = [], fallbackPayer = null) {
  const rows = new Map()
  const addRow = ({ name, email, amount, receiptCount = 0, bankTransactionCount = 0 }) => {
    const cleanName = name?.trim() || 'Unassigned payer'
    const cleanMail = cleanEmail(email)
    const key = cleanMail || cleanName
    const existing = rows.get(key) ?? {
      name: cleanName,
      email: cleanMail,
      amount: 0,
      count: 0,
      receiptCount: 0,
      bankTransactionCount: 0,
    }
    existing.amount += Number(amount || 0)
    existing.receiptCount += receiptCount
    existing.bankTransactionCount += bankTransactionCount
    existing.count += receiptCount + bankTransactionCount
    rows.set(key, existing)
  }

  receipts.forEach((receipt) => {
    addRow({
      name: receipt.payer_name,
      email: receipt.payer_email,
      amount: receipt.claimed_amount ?? receipt.amount ?? 0,
      receiptCount: 1,
    })
  })

  bankOnlyTransactions(receipts, bankTransactions).forEach((bt) => {
    addRow({
      name: fallbackPayer?.name,
      email: fallbackPayer?.email,
      amount: bankTransactionNetAmount(bt),
      bankTransactionCount: 1,
    })
  })
  return Array.from(rows.values()).sort((a, b) => b.amount - a.amount)
}

function splitItemLabel(split) {
  const parts = []
  if (split.receiptCount) parts.push(`${split.receiptCount} receipt${split.receiptCount === 1 ? '' : 's'}`)
  if (split.bankTransactionCount) {
    parts.push(`${split.bankTransactionCount} bank transaction${split.bankTransactionCount === 1 ? '' : 's'} without receipt`)
  }
  return parts.join(' + ') || `${split.count} item${split.count === 1 ? '' : 's'}`
}

function buildClaimReview({ step1, step2, receipts, bankTransactions, fallbackPayer, isTreasurer = false }) {
  const blockers = []
  const warnings = []
  const total = claimDraftTotal(receipts, bankTransactions)
  const bankOnly = bankOnlyTransactions(receipts, bankTransactions)
  const bankOnlyDrafts = bankOnlyReceiptDrafts(receipts, bankTransactions, fallbackPayer, isTreasurer)

  if (!step1.ccaId) blockers.push('Select the CCA for this claim.')
  if (!step2.claimDescription.trim()) blockers.push('Enter a claim description.')
  if (!step2.date) blockers.push('Select the claim date.')
  if (receipts.length === 0 && bankTransactions.length === 0) {
    blockers.push('Add at least one bank transaction or receipt.')
  }
  if (total <= 0) blockers.push('Claim total must be above $0.00.')

  const missingBankFiles = bankTransactions.filter((bt) => !bt.files?.length).length
  if (missingBankFiles > 0) {
    blockers.push(`${missingBankFiles} bank transaction${missingBankFiles === 1 ? '' : 's'} missing screenshot/PDF proof.`)
  }

  const missingReceiptFiles = receipts.filter((receipt) => !receipt.files?.length).length
  if (missingReceiptFiles > 0) {
    blockers.push(`${missingReceiptFiles} receipt${missingReceiptFiles === 1 ? '' : 's'} missing receipt proof.`)
  }

  const missingPayers = receipts.filter((receipt) => !receipt.payer_name?.trim() || !receipt.payer_email?.trim()).length
  if (missingPayers > 0) {
    blockers.push(`${missingPayers} receipt${missingPayers === 1 ? '' : 's'} missing payer selection.`)
  }
  const invalidBankOnly = bankOnly.filter((bt) => bankTransactionNetAmount(bt) <= 0).length
  if (invalidBankOnly > 0) {
    blockers.push(`${invalidBankOnly} bank transaction${invalidBankOnly === 1 ? '' : 's'} without receipts have a net amount of $0.00 or less.`)
  }
  const incompleteBankOnly = bankOnlyDrafts.filter((item) =>
    !item.description?.trim() ||
    !item.date ||
    !item.payer_name?.trim() ||
    !item.payer_email?.trim() ||
    (!isTreasurer && !item.category)
  ).length
  if (incompleteBankOnly > 0) {
    blockers.push(`${incompleteBankOnly} bank transaction-only item${incompleteBankOnly === 1 ? '' : 's'} missing description, date, payer${isTreasurer ? '' : ', or category'}.`)
  }
  const uniqueCategories = new Set(
    [...receipts, ...bankOnlyDrafts]
      .map((item) => item.category || (isTreasurer ? 'N/A' : ''))
      .filter(Boolean)
  )
  if (uniqueCategories.size > MAX_CATEGORIES) {
    blockers.push(`This claim has more than ${MAX_CATEGORIES} claim item categories. Please split it into separate claims.`)
  }

  const missingFx = receipts.filter((receipt) =>
    receipt.is_foreign_currency && !receipt.fx_screenshot_files?.length
  ).length
  if (missingFx > 0) {
    blockers.push(`${missingFx} foreign-currency receipt${missingFx === 1 ? '' : 's'} missing exchange-rate proof.`)
  }

  if (step2.transportFormNeeded) {
    if (step2.transportTrips.length === 0) {
      blockers.push('Add at least one transport trip.')
    }
    const incompleteTrips = step2.transportTrips.filter((trip) =>
      !trip.from?.trim() ||
      !trip.to?.trim() ||
      !trip.purpose?.trim() ||
      !parseDMY(trip.date) ||
      !trip.time?.trim() ||
      !trip.amount ||
      Number(trip.amount) <= 0 ||
      !trip.distance_km ||
      Number(trip.distance_km) <= 0
    ).length
    if (incompleteTrips > 0) {
      blockers.push(`${incompleteTrips} transport trip${incompleteTrips === 1 ? '' : 's'} missing from, to, purpose, date, time, amount, or distance.`)
    }
  }

  if (step2.wbsAccount === 'MF' && !step2.mfApprovalFiles?.length) {
    warnings.push("Master Fund approval is not attached. You can still submit, but finance may request proof if required.")
  }

  const unlinkedReceipts = receipts.filter((receipt) => !receipt.btLocalId).length
  if (unlinkedReceipts > 0) {
    warnings.push(`${unlinkedReceipts} receipt${unlinkedReceipts === 1 ? '' : 's'} not linked to a bank transaction.`)
  }

  const mismatchedTransactions = bankTransactions.filter((bt) => {
    const linked = receipts.filter((receipt) => receipt.btLocalId === bt.localId)
    if (linked.length === 0) return false
    const linkedTotal = linked.reduce((sum, receipt) => sum + Number(receipt.claimed_amount ?? receipt.amount ?? 0), 0)
    const refundTotal = (bt.refunds ?? []).reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
    const net = Number(bt.amount || 0) - refundTotal
    return Math.abs(linkedTotal - net) > 0.01
  }).length
  if (mismatchedTransactions > 0) {
    warnings.push(`${mismatchedTransactions} bank transaction${mismatchedTransactions === 1 ? '' : 's'} do not match linked receipt totals after refunds.`)
  }

  return {
    blockers,
    warnings,
    isBlocked: blockers.length > 0,
    total,
    payerSplits: payerSplitRows(receipts, bankTransactions, fallbackPayer),
  }
}

function hadStoredFileCounts(receipts, bankTransactions) {
  return receipts.some((r) => r.file_count > 0 || r.fx_file_count > 0) ||
    bankTransactions.some((bt) =>
      bt.file_count > 0 || (bt.refunds ?? []).some((refund) => refund.file_count > 0)
    )
}

function BankTransactionsStep({ bankTransactions, onAddBt, onEditBt, onRemoveBt, isTreasurer }) {
  const [showBtModal, setShowBtModal] = useState(false)
  const [editingBt, setEditingBt] = useState(null)

  function handleBtSave(data) {
    if (editingBt) {
      onEditBt(editingBt.localId, data)
    } else {
      onAddBt({ localId: generateId(), ...data })
    }
    setShowBtModal(false)
    setEditingBt(null)
  }

  return (
    <div className="space-y-4">
      <div className="ui-card p-4">
        <p className="text-sm font-bold text-gray-900">Bank transaction proof</p>
        <p className="mt-1 text-xs text-gray-500">
          Add each bank transaction screenshot/PDF here. You can attach receipts in the next step.
        </p>
      </div>

      {bankTransactions.length > 0 ? (
        <div className="space-y-2">
          {bankTransactions.map((bt, index) => {
            const refundTotal = (bt.refunds ?? []).reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
            const net = Number(bt.amount || 0) - refundTotal
            return (
              <div key={bt.localId} className="ui-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Bank Transaction {index + 1}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      ${Number(bt.amount || 0).toFixed(2)}
                      {refundTotal > 0 ? ` · net $${net.toFixed(2)} after refunds` : ''}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {bt.files?.length || 0} proof file{bt.files?.length === 1 ? '' : 's'}
                      {(bt.refunds?.length || 0) > 0 ? ` · ${bt.refunds.length} refund${bt.refunds.length === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditingBt(bt); setShowBtModal(true) }}
                      className="text-xs font-semibold text-blue-600"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveBt(bt.localId)}
                      className="text-xs font-semibold text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-gray-700">No bank transactions added yet</p>
          <p className="mt-1 text-xs text-gray-500">Add bank proof here, or continue if this claim only has receipts for now.</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setEditingBt(null); setShowBtModal(true) }}
        className="w-full rounded-xl border-2 border-dashed border-blue-300 py-3 text-sm font-semibold text-blue-600"
      >
        + Add Bank Transaction
      </button>

      {showBtModal && (
        <NewBtDraftModal
          initial={editingBt}
          onSave={handleBtSave}
          onClose={() => { setShowBtModal(false); setEditingBt(null) }}
        />
      )}
    </div>
  )
}

function ReceiptsStep({
  bankTransactions, receipts, onAddReceipt, onRemoveReceipt, onEditReceipt,
  onUpdateBankOnlyItem, expandedBtId, onSetExpandedBtId, isTreasurer, isPartial,
  payerOptions, onCreatePayer, onUpdatePayer, onDeletePayer, canManagePayers, payersLoading,
}) {
  const [showUnlinkedForm, setShowUnlinkedForm] = useState(false)
  const allCategories = useMemo(() => receipts.map((receipt) => receipt.category), [receipts])
  const unlinkedReceipts = receipts.filter((receipt) => !receipt.btLocalId)

  return (
    <div className="space-y-4">
      <div className="ui-card p-4">
        <p className="text-sm font-bold text-gray-900">Receipt details and payers</p>
        <p className="mt-1 text-xs text-gray-500">
          {bankTransactions.length > 0
            ? 'Open the matching Bank Tx card below, add the receipts paid by that transaction, and select who paid for each receipt.'
            : 'Add receipt details here and select who paid for each receipt.'}
        </p>
        {bankTransactions.length > 0 && (
          <p className="mt-2 rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700">
            Use Other receipts only when there is no matching bank transaction.
          </p>
        )}
      </div>

      {bankTransactions.length > 0 && (
        <div className="space-y-2">
          {bankTransactions.map((bt, index) => {
            const linked = receipts.filter((receipt) => receipt.btLocalId === bt.localId)
            return (
              <BtDraftCard
                key={bt.localId}
                bt={bt}
                btIndex={index + 1}
                linkedReceipts={linked}
                expanded={expandedBtId === bt.localId}
                onToggle={() => onSetExpandedBtId(expandedBtId === bt.localId ? null : bt.localId)}
                onRemove={null}
                onEdit={null}
                onAddReceipt={(receipt) => onAddReceipt({ ...receipt, btLocalId: bt.localId })}
                onRemoveReceipt={onRemoveReceipt}
                onEditReceipt={onEditReceipt}
                onUpdateBankOnlyItem={(claimItem) => onUpdateBankOnlyItem(bt.localId, claimItem)}
                existingCategories={allCategories}
                isTreasurer
                isPartial={isPartial}
                payerOptions={payerOptions}
                onCreatePayer={onCreatePayer}
                onUpdatePayer={onUpdatePayer}
                onDeletePayer={onDeletePayer}
                canManagePayers={canManagePayers}
                payersLoading={payersLoading}
              />
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Other receipts not attached to a bank transaction{unlinkedReceipts.length ? ` (${unlinkedReceipts.length})` : ''}
          </p>
          {!showUnlinkedForm && (
            <button
              type="button"
              onClick={() => setShowUnlinkedForm(true)}
              className="text-xs font-semibold text-blue-600"
            >
              + Add unlinked receipt
            </button>
          )}
        </div>

        {unlinkedReceipts.length > 0 && (
          <div className="space-y-1">
            {unlinkedReceipts.map((receipt) => (
              <DraftReceiptRow
                key={receipt.localId}
                receipt={receipt}
                onEdit={onEditReceipt}
                onRemove={onRemoveReceipt}
                existingCategories={allCategories}
                isTreasurer
                isPartial={isPartial}
                payerOptions={payerOptions}
                onCreatePayer={onCreatePayer}
                onUpdatePayer={onUpdatePayer}
                onDeletePayer={onDeletePayer}
                canManagePayers={canManagePayers}
                payersLoading={payersLoading}
              />
            ))}
          </div>
        )}

        {showUnlinkedForm && (
          <div>
            <ReceiptForm
              onAdd={(receipt) => { onAddReceipt(receipt); setShowUnlinkedForm(false) }}
              existingCategories={allCategories}
              isTreasurer
              isPartial={isPartial}
              payerOptions={payerOptions}
              onCreatePayer={onCreatePayer}
              onUpdatePayer={onUpdatePayer}
              onDeletePayer={onDeletePayer}
              canManagePayers={canManagePayers}
              payersLoading={payersLoading}
            />
            <button type="button" onClick={() => setShowUnlinkedForm(false)} className="mt-2 w-full py-1 text-xs text-gray-500">
              Cancel
            </button>
          </div>
        )}
      </div>

      {bankTransactions.length === 0 && receipts.length === 0 && (
        <p className="py-2 text-center text-xs text-gray-400">
          If this is a bank-transaction-only claim, go back and add bank proof. Otherwise, add receipt details here.
        </p>
      )}
    </div>
  )
}

function SplitStep({ receipts, bankTransactions, isTreasurer, fallbackPayer }) {
  const splits = payerSplitRows(receipts, bankTransactions, fallbackPayer)
  const bankOnlyCount = bankOnlyTransactions(receipts, bankTransactions).length
  const total = claimDraftTotal(receipts, bankTransactions)

  return (
    <div className="space-y-4">
      <div className="ui-card p-4">
        <p className="text-sm font-bold text-gray-900">{isTreasurer ? 'Reimbursement split' : 'Payer split'}</p>
        <p className="mt-1 text-xs text-gray-500">
          {isTreasurer
            ? 'Use this to check how much each payer should receive from your CCA.'
            : 'Review the receipt-level payer totals before saving this claim.'}
        </p>
        {bankOnlyCount > 0 && (
          <p className="mt-2 rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700">
            Bank transactions without receipts are included as bank-transaction-only items under the claimer.
          </p>
        )}
      </div>

      {splits.length > 0 ? (
        <div className="space-y-2">
          {splits.map((split) => (
            <div key={split.email || split.name} className="ui-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900">{split.name}</p>
                  {split.email && <p className="truncate text-xs text-gray-500">{split.email}</p>}
                  <p className="mt-1 text-xs text-gray-500">{splitItemLabel(split)}</p>
                </div>
                <p className="shrink-0 text-base font-bold text-gray-900">${split.amount.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ui-card p-4">
          <p className="text-sm font-semibold text-gray-800">No payer split yet</p>
          <p className="mt-1 text-xs text-gray-500">
            Add receipts or bank transactions to preview how much each payer should receive.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Claim Total</span>
          <span className="text-lg font-bold text-gray-900">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

function ChecklistItem({ tone, children }) {
  const classes = {
    ok: 'border-green-200 bg-green-50 text-green-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-700',
  }
  const symbol = tone === 'ok' ? 'OK' : tone === 'warning' ? '!' : '!'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${classes[tone]}`}>
      <span className="shrink-0">{symbol}</span>
      <span>{children}</span>
    </div>
  )
}

function ReviewStep({ user, step1, step2, receipts, bankTransactions, review, isTreasurer }) {
  const selectedCca = isTreasurer ? user?.ccas?.find((cca) => cca.id === step1.ccaId) : null
  const summaryRows = [
    ['CCA', selectedCca?.name || (step1.ccaId ? 'Selected' : 'Not selected')],
    ['Description', step2.claimDescription || 'Not filled'],
    ['Date', step2.date || 'Not selected'],
    ['Fund', step2.wbsAccount === 'MF' ? 'Master Fund' : step2.wbsAccount === 'SA' ? 'Student Account' : 'Others'],
    ['Bank Transactions', String(bankTransactions.length)],
    ['Receipts', String(receipts.length)],
  ]

  return (
    <div className="space-y-4">
      <div className="ui-card p-4">
        <p className="text-sm font-bold text-gray-900">Review before submitting</p>
        <p className="mt-1 text-xs text-gray-500">
          {isTreasurer
            ? 'Once submitted, finance will be able to review this claim.'
            : 'Review the claim before saving it.'}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="space-y-2">
          {summaryRows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3 text-sm">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
              <span className="min-w-0 text-right font-medium text-gray-800">{value}</span>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-700">Total</span>
              <span className="text-lg font-bold text-gray-900">${review.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {review.payerSplits.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Payer Split</p>
          <div className="space-y-2">
            {review.payerSplits.map((split) => (
              <div key={split.email || split.name} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800">{split.name}</span>
                  {split.email && <span className="block truncate text-xs text-gray-400">{split.email}</span>}
                  <span className="block truncate text-xs text-gray-400">{splitItemLabel(split)}</span>
                </span>
                <span className="shrink-0 font-bold text-gray-900">${split.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-gray-500">
          {isTreasurer ? 'Submission Checklist' : 'Save Checklist'}
        </p>
        {review.blockers.length === 0 && <ChecklistItem tone="ok">Required items are complete.</ChecklistItem>}
        {review.blockers.map((item) => <ChecklistItem key={item} tone="danger">{item}</ChecklistItem>)}
        {review.warnings.map((item) => <ChecklistItem key={item} tone="warning">{item}</ChecklistItem>)}
      </div>
    </div>
  )
}

function Step3({
  bankTransactions, onAddBt, onRemoveBt, onEditBt,
  receipts, onAddReceipt, onRemoveReceipt, onEditReceipt,
  expandedBtId, onSetExpandedBtId, isTreasurer, isPartial, claimMeta,
  payerOptions, onCreatePayer, onUpdatePayer, onDeletePayer, canManagePayers, payersLoading,
}) {
  const [showBtModal, setShowBtModal] = useState(false)
  const [editingBt, setEditingBt] = useState(null)
  const [showUnlinkedForm, setShowUnlinkedForm] = useState(false)

  const allCategories = useMemo(() => receipts.map((r) => r.category), [receipts])
  const total = claimDraftTotal(receipts, bankTransactions)
  const unlinkedReceipts = receipts.filter((r) => !r.btLocalId)

  function handleBtSave(data) {
    if (editingBt) {
      onEditBt(editingBt.localId, data)
    } else {
      onAddBt({ localId: generateId(), ...data })
    }
    setShowBtModal(false)
    setEditingBt(null)
  }

  return (
    <div className="space-y-4">
      <DraftClaimHealthPanel
        claimMeta={claimMeta}
        receipts={receipts}
        bankTransactions={bankTransactions}
      />

      {/* BT list */}
      {bankTransactions.length > 0 && (
        <div className="space-y-2">
          {bankTransactions.map((bt, i) => {
            const linked = receipts.filter((r) => r.btLocalId === bt.localId)
            return (
              <BtDraftCard
                key={bt.localId}
                bt={bt}
                btIndex={i + 1}
                linkedReceipts={linked}
                expanded={expandedBtId === bt.localId}
                onToggle={() => onSetExpandedBtId(expandedBtId === bt.localId ? null : bt.localId)}
                onRemove={() => onRemoveBt(bt.localId)}
                onEdit={() => { setEditingBt(bt); setShowBtModal(true) }}
                onAddReceipt={(r) => onAddReceipt({ ...r, btLocalId: bt.localId })}
                onRemoveReceipt={onRemoveReceipt}
                onEditReceipt={onEditReceipt}
                existingCategories={allCategories}
                onAddBtFiles={() => {}}
                onRemoveBtFile={() => {}}
                isTreasurer={isTreasurer}
                isPartial={isPartial}
                payerOptions={payerOptions}
                onCreatePayer={onCreatePayer}
                onUpdatePayer={onUpdatePayer}
                onDeletePayer={onDeletePayer}
                canManagePayers={canManagePayers}
                payersLoading={payersLoading}
              />
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => { setEditingBt(null); setShowBtModal(true) }}
        className="w-full border-2 border-dashed border-blue-300 text-blue-600 text-sm font-medium py-3 rounded-xl"
      >
        + Add Bank Transaction
      </button>

      {/* Unlinked receipts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-600">
            Unlinked Receipts{unlinkedReceipts.length > 0 ? ` (${unlinkedReceipts.length})` : ''}
          </p>
          {!showUnlinkedForm && (
            <button type="button" onClick={() => setShowUnlinkedForm(true)} className="text-xs text-blue-600 font-medium">
              + Add
            </button>
          )}
        </div>

        {unlinkedReceipts.length > 0 && (
          <div className="space-y-1">
            {unlinkedReceipts.map((r) => (
              <DraftReceiptRow
                key={r.localId}
                receipt={r}
                onEdit={onEditReceipt}
                onRemove={onRemoveReceipt}
                existingCategories={allCategories}
                isTreasurer={isTreasurer}
                isPartial={isPartial}
                payerOptions={payerOptions}
                onCreatePayer={onCreatePayer}
                onUpdatePayer={onUpdatePayer}
                onDeletePayer={onDeletePayer}
                canManagePayers={canManagePayers}
                payersLoading={payersLoading}
              />
            ))}
          </div>
        )}

        {showUnlinkedForm && (
          <div>
            <ReceiptForm
              onAdd={(r) => { onAddReceipt(r); setShowUnlinkedForm(false) }}
              existingCategories={allCategories}
              isTreasurer={isTreasurer}
              isPartial={isPartial}
              payerOptions={payerOptions}
              onCreatePayer={onCreatePayer}
              onUpdatePayer={onUpdatePayer}
              onDeletePayer={onDeletePayer}
              canManagePayers={canManagePayers}
              payersLoading={payersLoading}
            />
            <button type="button" onClick={() => setShowUnlinkedForm(false)} className="w-full mt-2 text-xs text-gray-500 py-1">
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      {(receipts.length > 0 || bankTransactions.length > 0) && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 bg-gray-50 border-b border-gray-100">
            Summary
          </p>
          <div className="divide-y divide-gray-100">
            {bankTransactions.map((bt, i) => {
              const linked = receipts.filter((r) => r.btLocalId === bt.localId)
              const sum = linked.reduce((s, r) => s + r.amount, 0)
              const refundTotal = (bt.refunds ?? []).reduce((s, refund) => s + Number(refund.amount || 0), 0)
              const net = Number(bt.amount || 0) - refundTotal
              const displayAmount = linked.length > 0 ? sum : net
              return (
                <div key={bt.localId} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-sm text-gray-800">Bank Tx {i + 1}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {linked.length > 0 ? `${linked.length} receipt${linked.length !== 1 ? 's' : ''}` : 'bank transaction only'}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">${displayAmount.toFixed(2)}</span>
                </div>
              )
            })}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
              <span className="text-sm font-bold text-gray-700">Total</span>
              <span className="text-sm font-bold text-gray-900">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {bankTransactions.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-2">Add a bank transaction to get started</p>
      )}

      {/* BT modal */}
      {showBtModal && (
        <NewBtDraftModal
          initial={editingBt}
          onSave={handleBtSave}
          onClose={() => { setShowBtModal(false); setEditingBt(null) }}
        />
      )}
    </div>
  )
}

// ─── Treasurer CCA / Claimer Picker ──────────────────────────────────────────

function TreasurerClaimerPicker({ user, value, onChange }) {
  const ccas = user?.ccas || []

  useEffect(() => {
    if (ccas.length === 1 && !value) {
      onChange(ccas[0].id)
    }
  }, [ccas, value, onChange])

  if (ccas.length === 0) return <p className="text-sm text-gray-400">No CCAs assigned to your account.</p>

  if (ccas.length === 1) {
    return (
      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
        Claiming for: <strong>{ccas[0].name}</strong>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        Which CCA is this claim for? <span className="text-red-500">*</span>
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        <option value="" disabled>Select CCA</option>
        {ccas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'new_claim_draft'

const DEFAULT_STEP1 = {
  portfolioId: '',
  ccaId: '',
  claimerId: '',
  isOneOff: false,
  oneOffName: '',
  oneOffMatricNo: '',
  oneOffPhone: '',
  oneOffEmail: '',
}
const DEFAULT_STEP2 = {
  claimDescription: '',
  date: today(),
  wbsAccount: 'SA',
  remarks: '',
  transportFormNeeded: false,
  transportTrips: [],
  mfApprovalFiles: [],
  isPartial: false,
}

export default function NewClaimPage() {
  const navigate = useNavigate()
  const createClaim = useCreateClaim()
  const submitForReviewMut = useSubmitForReview()
  const createReceipt = useCreateReceipt()
  const createPayerMut = useCreatePayer()
  const updatePayerMut = useUpdatePayer()
  const savedSuccessfully = useRef(false)

  const { user } = useAuth()
  const isTreasurer = user?.role === 'treasurer'


  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const [restoredFilesMissing, setRestoredFilesMissing] = useState(false)

  // Step 1 state
  const [step1, setStep1] = useState(DEFAULT_STEP1)

  // Step 2 state
  const [step2, setStep2] = useState(DEFAULT_STEP2)

  // Step 3 state
  const [bankTransactions, setBankTransactions] = useState([])  // [{localId, amount, files, refunds}]
  const [receipts, setReceipts] = useState([])
  const [expandedBtId, setExpandedBtId] = useState(null)
  const [claimOnlyPayers, setClaimOnlyPayers] = useState([])

  const payerOwnerId = isTreasurer ? user?.id : (!step1.isOneOff ? step1.claimerId : '')
  const { data: savedPayers = [], isLoading: payersLoading } = usePayers(payerOwnerId, Boolean(payerOwnerId))
  const deletePayerMut = useDeletePayer(payerOwnerId)
  const oneOffPayer = useMemo(() => oneOffSelfPayer(step1), [step1.oneOffName, step1.oneOffEmail])
  const payerOptions = useMemo(() => {
    if (payerOwnerId) return savedPayers.map(normalizePayer).filter(Boolean)
    return [oneOffPayer, ...claimOnlyPayers.map(normalizePayer)].filter(Boolean)
  }, [payerOwnerId, savedPayers, oneOffPayer, claimOnlyPayers])
  const defaultPayer = payerOptions[0] ?? null

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

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY)
      if (saved) {
        const { step: s, step1: s1, step2: s2, receipts: r, bankTransactions: bt, expandedBtId: eid, claimOnlyPayers: savedPayersForClaim } = JSON.parse(saved)
        const restoredReceipts = r ? r.map((rec) => ({ ...rec, files: [], fx_screenshot_files: [] })) : []
        const restoredBts = bt
          ? bt.map((b) => ({
              ...b,
              files: [],
              refunds: (b.refunds ?? []).map((refund) => ({ ...refund, files: [] })),
            }))
          : []
        if (s1) setStep1(s1)
        if (s2) setStep2({ ...s2, mfApprovalFiles: [] })
        if (r) setReceipts(restoredReceipts)
        if (bt) setBankTransactions(restoredBts)
        if (eid) setExpandedBtId(eid)
        if (savedPayersForClaim) setClaimOnlyPayers(savedPayersForClaim)
        if (s) setStep(s)
        setDraftRestored(true)
        setRestoredFilesMissing(Boolean(s2?.mf_approval_file_count) || hadStoredFileCounts(restoredReceipts, restoredBts))
      }
    } catch {}
  }, [])

  // Persist draft to sessionStorage on every change (strip File objects — not serializable)
  useEffect(() => {
    try {
      const btsForDraft = bankTransactions.map(({ files: _f, ...bt }) => ({
        ...bt,
        file_count: _f?.length || bt.file_count || 0,
        refunds: (bt.refunds ?? []).map(({ files: _rf, ...r }) => ({
          ...r,
          file_count: _rf?.length || r.file_count || 0,
        })),
      }))
      const receiptsForDraft = receipts.map(({ files: _f, fx_screenshot_files: _fx, ...r }) => ({
        ...r,
        file_count: _f?.length || r.file_count || 0,
        fx_file_count: _fx?.length || r.fx_file_count || 0,
      }))
      const { mfApprovalFiles: _mf, ...step2DraftBase } = step2
      const step2ForDraft = {
        ...step2DraftBase,
        mfApprovalFiles: [],
        mf_approval_file_count: _mf?.length || step2.mf_approval_file_count || 0,
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, step1, step2: step2ForDraft, receipts: receiptsForDraft, bankTransactions: btsForDraft, expandedBtId, claimOnlyPayers }))
    } catch {}
  }, [step, step1, step2, receipts, bankTransactions, expandedBtId, claimOnlyPayers])

  // Clear draft on unmount only if save succeeded
  useEffect(() => {
    return () => {
      if (savedSuccessfully.current) sessionStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  useEffect(() => {
    const defaultPayer = payerOptions[0]
    if (!defaultPayer) return
    setReceipts((prev) =>
      prev.every((receipt) => receipt.payer_name && receipt.payer_email)
        ? prev
        : prev.map((receipt) =>
            receipt.payer_name && receipt.payer_email
              ? receipt
              : {
                  ...receipt,
                  payer_id: defaultPayer.is_saved ? defaultPayer.id : null,
                  payer_name: defaultPayer.name,
                  payer_email: defaultPayer.email,
                }
          )
      )
  }, [payerOptions])

  // ── Step validation ──────────────────────────────────────────────────────

  const step1Valid = isTreasurer
    ? !!step1.ccaId
    : step1.portfolioId && step1.ccaId && (step1.claimerId || (step1.isOneOff && step1.oneOffName.trim() && step1.oneOffEmail.trim()))
  const step2Valid = step2.claimDescription.trim() && step2.date && step2.wbsAccount
  const hasUnsavedAttachedFiles = hasDraftFiles(step2, receipts, bankTransactions)
  const formReview = useMemo(
    () => buildClaimReview({ step1, step2, receipts, bankTransactions, fallbackPayer: defaultPayer, isTreasurer }),
    [step1, step2, receipts, bankTransactions, defaultPayer, isTreasurer]
  )
  const stepLabels = ['Details', 'Bank', 'Receipts', 'Split', isTreasurer ? 'Submit' : 'Save']
  const maxStep = stepLabels.length
  const canGoNext = step === 1 ? step1Valid && step2Valid : true

  useEffect(() => {
    setStep((current) => Math.min(current, maxStep))
  }, [maxStep])

  useEffect(() => {
    if (!hasUnsavedAttachedFiles || savedSuccessfully.current) return undefined
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedAttachedFiles])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function updateStep1(patch) {
    setStep1((prev) => ({ ...prev, ...patch }))
  }

  function updateStep2(patch) {
    setStep2((prev) => ({ ...prev, ...patch }))
  }

  function confirmLeaveWithFiles() {
    if (!hasUnsavedAttachedFiles || savedSuccessfully.current) return true
    return window.confirm('Attached files are only kept in this browser session until the claim is saved. Leave this form?')
  }

  function handleExit() {
    if (!confirmLeaveWithFiles()) return
    navigate('/')
  }

  function addBt(bt) {
    setBankTransactions((prev) => [...prev, { files: [], refunds: [], ...bt }])
    setExpandedBtId(bt.localId)
  }

  function editBt(btLocalId, data) {
    setBankTransactions((prev) =>
      prev.map((bt) => bt.localId === btLocalId ? { ...bt, ...data } : bt)
    )
  }

  function removeBt(btLocalId) {
    setBankTransactions((prev) => prev.filter((bt) => bt.localId !== btLocalId))
    setReceipts((prev) => prev.filter((r) => r.btLocalId !== btLocalId))
    if (expandedBtId === btLocalId) setExpandedBtId(null)
  }

  function updateBankOnlyItem(btLocalId, claimItem) {
    setBankTransactions((prev) =>
      prev.map((bt) => {
        if (bt.localId !== btLocalId) return bt
        const hasExplicitBankOnlyFlag = Object.prototype.hasOwnProperty.call(claimItem, 'noReceiptAttached')
        return {
          ...bt,
          claimItem: Object.fromEntries(
            Object.entries(claimItem).filter(([key]) => key !== 'noReceiptAttached')
          ),
          noReceiptAttached: hasExplicitBankOnlyFlag
            ? Boolean(claimItem.noReceiptAttached)
            : Boolean(bt.noReceiptAttached),
        }
      })
    )
  }

  function addReceipt(receipt) {
    setReceipts((prev) => [...prev, { ...receipt, localId: generateId() }])
  }

  function editReceipt(localId, updated) {
    setReceipts((prev) => prev.map((r) => r.localId === localId ? { ...r, ...updated } : r))
  }

  function removeReceipt(localId) {
    setReceipts((prev) => prev.filter((r) => r.localId !== localId))
  }

  async function handleSave({ submit = false } = {}) {
    const currentReview = buildClaimReview({ step1, step2, receipts, bankTransactions, fallbackPayer: defaultPayer, isTreasurer })
    if ((submit || isTreasurer) && currentReview.isBlocked) {
      setSaveError(`Fix the required items in the checklist before ${submit ? 'submitting for review' : 'saving'}.`)
      setStep(maxStep)
      return
    }

    setSaving(true)
    setSaveError('')

    let claimId = null
    const imageWarnings = []

    try {
      const totalAmount = claimDraftTotal(receipts, bankTransactions)
      if (receipts.length === 0 && bankTransactions.length === 0) {
        throw new Error('Add at least one receipt or bank transaction.')
      }
      const missingPayer = receipts.find((r) => !r.payer_name?.trim() || !r.payer_email?.trim())
      if (missingPayer) {
        throw new Error('Every receipt must have a payer selected.')
      }
      const bankOnlyDrafts = bankOnlyReceiptDrafts(receipts, bankTransactions, defaultPayer, isTreasurer)
      if (bankOnlyDrafts.length > 0 && bankOnlyDrafts.some((r) => !r.payer_name?.trim() || !r.payer_email?.trim())) {
        throw new Error('Bank transactions without receipts need a default payer before they can be included in the split.')
      }
      const incompleteBankOnly = bankOnlyDrafts.some((r) =>
        !r.description?.trim() ||
        !r.date ||
        (!isTreasurer && !r.category)
      )
      if (incompleteBankOnly) {
        throw new Error(`Every bank transaction-only item needs description, date, payer${isTreasurer ? '' : ', and category'}.`)
      }
      if (bankOnlyDrafts.some((r) => Number(r.amount || 0) <= 0)) {
        throw new Error('Bank transactions without receipts must have a net amount above $0.00.')
      }

      // Auto-append remarks for FX receipts and MF approval
      let autoRemarks = step2.remarks.trim()
      const hasFxReceipt = receipts.some(r => r.is_foreign_currency && r.fx_screenshot_files?.length)
      const FX_REMARK = '- Exchange Rate Screenshot is Attached'
      const MF_REMARK = "- Master's Approval Screenshot is attached"
      if (hasFxReceipt && !autoRemarks.includes(FX_REMARK))
        autoRemarks = autoRemarks ? `${autoRemarks}\n${FX_REMARK}` : FX_REMARK
      if (step2.wbsAccount === 'MF' && step2.mfApprovalFiles?.length && !autoRemarks.includes(MF_REMARK))
        autoRemarks = autoRemarks ? `${autoRemarks}\n${MF_REMARK}` : MF_REMARK

      // 1. Create the claim
      const claimPayload = {
        cca_id: step1.ccaId,
        claim_description: step2.claimDescription.trim(),
        total_amount: totalAmount,
        date: step2.date,
        wbs_account: step2.wbsAccount,
        remarks: autoRemarks || undefined,
        transport_form_needed: step2.transportFormNeeded,
        is_partial: step2.isPartial,
      }
      if (!isTreasurer) {
        if (step1.isOneOff) {
          claimPayload.one_off_name = step1.oneOffName.trim()
          if (step1.oneOffMatricNo.trim()) claimPayload.one_off_matric_no = step1.oneOffMatricNo.trim()
          if (step1.oneOffPhone.trim()) claimPayload.one_off_phone = step1.oneOffPhone.trim()
          if (step1.oneOffEmail.trim()) claimPayload.one_off_email = step1.oneOffEmail.trim()
        } else {
          claimPayload.claimer_id = step1.claimerId
        }
      }
      // For treasurer: server auto-sets claimer_id = current user
      const claim = await createClaim.mutateAsync(claimPayload)

      claimId = claim?.id ?? claim?.claim?.id
      if (!claimId) throw new Error('No claim ID returned from server')

      // 1b. Upload MF approval if present (one call per page)
      if (step2.wbsAccount === 'MF' && step2.mfApprovalFiles?.length) {
        for (const file of step2.mfApprovalFiles) {
          try {
            await uploadMfApproval({ claimId, file })
          } catch (e) {
            const msg = e?.response?.data?.detail || e?.message || 'Unknown error'
            imageWarnings.push(`Master Fund approval: ${msg}`)
            console.error('MF approval upload failed:', e)
          }
        }
      }

      // 1c. Save transport trip data if needed
      if (step2.transportFormNeeded && step2.transportTrips.length > 0) {
        try {
          await submitTransportData({
            claimId,
            trips: step2.transportTrips.map(t => ({
              from_location: t.from,
              to_location: t.to,
              purpose: t.purpose,
              date: parseDMY(t.date) || undefined,
              time: t.time || undefined,
              amount: Number(t.amount) || 0,
              distance_km: t.distance_km ? Number(t.distance_km) : undefined,
            }))
          })
        } catch {}
      }

      // 2. Create bank transactions, upload screenshots + refunds, build local → real ID map
      const btIdMap = {}
      for (const bt of bankTransactions) {
        const created = await createBankTransaction({ claimId, amount: bt.amount })
        btIdMap[bt.localId] = created.id
        for (const file of (bt.files ?? [])) {
          try {
            await uploadBankTransactionImage({ btId: created.id, file })
          } catch (e) {
            const msg = e?.response?.data?.detail || e?.message || 'Unknown error'
            imageWarnings.push(`Bank transaction image: ${msg}`)
            console.error('BT image upload failed:', e)
          }
        }
        for (const refund of (bt.refunds ?? [])) {
          if (!refund.amount || !refund.files?.length) continue
          // First file creates the refund; subsequent files are extra attachments
          try { await createBtRefund({ btId: created.id, amount: Number(refund.amount), files: refund.files }) } catch {}
        }
      }

      // 3. Create receipt rows first, then attach files to saved receipts.
      // Bank transactions without receipts are saved as placeholder receipt rows so
      // claim totals, documents, and reimbursement splits all include them.
      for (const r of [...receipts, ...bankOnlyDrafts]) {
        const createdReceipt = await createReceipt.mutateAsync({
          claim_id: claimId,
          bank_transaction_id: r.btLocalId ? btIdMap[r.btLocalId] : undefined,
          receipt_no: r.receipt_no || undefined,
          description: r.description,
          company: r.company || undefined,
          date: r.date || undefined,
          amount: r.amount,
          claimed_amount: r.claimed_amount ?? undefined,
          payer_id: r.payer_id || undefined,
          payer_name: r.payer_name,
          payer_email: r.payer_email,
          category: r.category,
          gst_code: r.gst_code,
          dr_cr: r.dr_cr,
          is_foreign_currency: r.is_foreign_currency,
        })
        if (createdReceipt?.split_needed) {
          throw new Error(createdReceipt.reason || 'Receipt could not be saved.')
        }
        const receiptId = createdReceipt?.receipt?.id
        if (!receiptId) throw new Error('Receipt could not be saved.')
        for (const file of (r.files ?? [])) {
          try {
            await uploadReceiptImageById({ receiptId, file })
          } catch (e) {
            const msg = e?.response?.data?.detail || e?.message || 'Unknown error'
            imageWarnings.push(`Receipt image: ${msg}`)
            console.error('Receipt image upload failed:', e)
          }
        }
        if (r.is_foreign_currency && r.fx_screenshot_files?.length) {
          for (const file of r.fx_screenshot_files) {
            try {
              await uploadReceiptFxImageById({ receiptId, file })
            } catch (e) {
              const msg = e?.response?.data?.detail || e?.message || 'Unknown error'
              imageWarnings.push(`FX rate image: ${msg}`)
              console.error('FX image upload failed:', e)
            }
          }
        }
      }

      savedSuccessfully.current = true
      sessionStorage.removeItem(DRAFT_KEY)
      const nextState = {}
      if (imageWarnings.length > 0) nextState.imageWarnings = imageWarnings
      if (submit && isTreasurer && imageWarnings.length === 0) {
        await submitForReviewMut.mutateAsync(claimId)
        nextState.submittedForReview = true
      } else if (isTreasurer) {
        nextState.needsSubmitReview = true
      }
      navigate(`/claims/${claimId}`, {
        state: Object.keys(nextState).length > 0 ? nextState : undefined,
      })
    } catch (err) {
      if (claimId) {
        sessionStorage.removeItem(DRAFT_KEY)
        const detail = err?.response?.data?.detail || err?.message || 'Some items may not have saved.'
        navigate(`/claims/${claimId}`, {
          state: {
            saveError: detail,
            ...(isTreasurer ? { needsSubmitReview: true } : {}),
          },
        })
      } else {
        setSaveError(err?.response?.data?.detail || err?.message || 'Failed to save claim.')
        setSaving(false)
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mobile-page flex h-full flex-col">
      {/* Header */}
      <div className="mobile-header border-b px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-3">
        <button
          onClick={handleExit}
          className="icon-button -ml-1"
          aria-label="Back"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <p className="section-eyebrow">New Claim</p>
          <h1 className="mt-1 text-lg font-bold leading-6 text-gray-900">Guided setup</h1>
        </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mobile-content">
        <StepIndicator current={step} steps={stepLabels} />

        {(draftRestored || restoredFilesMissing || hasUnsavedAttachedFiles) && (
          <div className="mb-4 space-y-2">
            {draftRestored && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs font-semibold text-blue-700">Progress restored</p>
                <p className="mt-0.5 text-xs text-blue-600">Your in-progress text fields were restored on this device.</p>
              </div>
            )}
            {restoredFilesMissing && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-800">Reattach uploaded files</p>
                <p className="mt-0.5 text-xs text-amber-700">Browsers cannot restore receipt, bank, refund, FX, or MF files after the form reloads.</p>
              </div>
            )}
            {hasUnsavedAttachedFiles && (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold text-slate-700">Files are held temporarily</p>
                <p className="mt-0.5 text-xs text-slate-500">Submit the claim before closing Telegram or refreshing the page.</p>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {isTreasurer ? (
              <TreasurerClaimerPicker
                user={user}
                value={step1.ccaId}
                onChange={(ccaId) => updateStep1({ ccaId })}
              />
            ) : (
              <Step1 data={step1} onChange={updateStep1} />
            )}
            <Step2 data={step2} onChange={updateStep2} isTreasurer={isTreasurer} />
          </div>
        )}
        {step === 2 && (
          <BankTransactionsStep
            bankTransactions={bankTransactions}
            onAddBt={addBt}
            onEditBt={editBt}
            onRemoveBt={removeBt}
            isTreasurer={isTreasurer}
          />
        )}
        {step === 3 && (
          <ReceiptsStep
            bankTransactions={bankTransactions}
            receipts={receipts}
            onAddReceipt={addReceipt}
            onRemoveReceipt={removeReceipt}
            onEditReceipt={editReceipt}
            onUpdateBankOnlyItem={updateBankOnlyItem}
            expandedBtId={expandedBtId}
            onSetExpandedBtId={setExpandedBtId}
            isTreasurer={isTreasurer}
            isPartial={step2.isPartial}
            payerOptions={payerOptions}
            onCreatePayer={createCurrentPayer}
            onUpdatePayer={updateCurrentPayer}
            onDeletePayer={deleteCurrentPayer}
            canManagePayers={Boolean(payerOwnerId)}
            payersLoading={Boolean(payerOwnerId) && payersLoading}
          />
        )}
        {step === 4 && (
          <SplitStep
            receipts={receipts}
            bankTransactions={bankTransactions}
            isTreasurer={isTreasurer}
            fallbackPayer={defaultPayer}
          />
        )}
        {step === 5 && (
          <ReviewStep
            user={user}
            step1={step1}
            step2={step2}
            receipts={receipts}
            bankTransactions={bankTransactions}
            review={formReview}
            isTreasurer={isTreasurer}
          />
        )}

        {saveError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}
        </div>
      </div>

      {/* Footer navigation */}
      <div className="mobile-footer shrink-0 border-t px-4 py-3">
        <div className="mx-auto flex max-w-lg gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={saving}
            className="ui-button ui-button-secondary flex-1 disabled:opacity-60"
          >
            Back
          </button>
        )}

        {step < maxStep && (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canGoNext}
            className="ui-button ui-button-primary flex-1 disabled:opacity-50"
          >
            Next
          </button>
        )}

        {step === maxStep && (
          <div className="flex-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleSave({ submit: isTreasurer })}
              disabled={saving || formReview.isBlocked}
              className="ui-button ui-button-primary w-full disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                isTreasurer ? 'Submit for Review' : 'Save Claim'
              )}
            </button>
            {!saving && formReview.isBlocked && (
              <p className="text-center text-xs font-medium text-gray-500">
                Complete the required checklist items before {isTreasurer ? 'submitting' : 'saving'}.
              </p>
            )}
            {saving && (
              <p className="text-xs text-gray-500 text-center">Uploading images — this may take a minute</p>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
