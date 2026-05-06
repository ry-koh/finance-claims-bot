import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortfolios, useCcasByPortfolio } from '../api/portfolios'
import { useClaimers, useCreateClaimer } from '../api/claimers'
import { useCreateClaim } from '../api/claims'
import { useCreateReceipt, uploadReceiptImage } from '../api/receipts'
import { createBankTransaction, uploadBankTransactionImage, createBtRefund } from '../api/bankTransactions'
import { submitTransportData, uploadMfApproval } from '../api/documents'
import { WBS_ACCOUNTS, CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'
import DragDropZone from '../components/DragDropZone'
import CroppableThumb from '../components/CroppableThumb'

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CATEGORIES = 5

function today() {
  return new Date().toISOString().split('T')[0]
}

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = ['Who', 'What', 'Transactions']
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, i) => {
        const step = i + 1
        const active = step === current
        const done = step < current
        return (
          <div key={step} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? 'bg-blue-600 text-white'
                    : active
                    ? 'bg-blue-600 text-white ring-2 ring-blue-200'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {done ? '✓' : step}
              </div>
              <span
                className={`text-[10px] mt-0.5 font-medium ${
                  active ? 'text-blue-600' : done ? 'text-blue-400' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 mb-3 ${done ? 'bg-blue-600' : 'bg-gray-200'}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function Label({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-gray-700 mb-1">
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
      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 ${className}`}
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
      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400 ${type === 'date' ? 'max-w-[200px]' : ''} ${className}`}
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
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
    />
  )
}

// ─── Step 1: Who ──────────────────────────────────────────────────────────────

function Step1({ data, onChange }) {
  const [showAddClaimer, setShowAddClaimer] = useState(false)
  const [newClaimer, setNewClaimer] = useState({ name: '', matric_no: '', phone: '', email: '' })
  const [addClaimerError, setAddClaimerError] = useState('')

  const { data: portfolios = [], isLoading: portfoliosLoading } = usePortfolios()
  const { data: ccas = [], isLoading: ccasLoading } = useCcasByPortfolio(data.portfolioId)
  const { data: claimers = [], isLoading: claimersLoading } = useClaimers({ cca_id: data.ccaId })
  const createClaimer = useCreateClaimer()

  const portfolioOptions = portfolios.map((p) => ({ value: p.id, label: p.name }))
  const ccaOptions = ccas.map((c) => ({ value: c.id, label: c.name }))
  const claimerOptions = claimers.map((c) => ({ value: c.id, label: c.name }))

  function handlePortfolioChange(val) {
    onChange({ portfolioId: val, ccaId: '', claimerId: '' })
  }

  function handleCcaChange(val) {
    onChange({ ccaId: val, claimerId: '' })
  }

  async function handleAddClaimer() {
    setAddClaimerError('')
    if (!newClaimer.name.trim()) {
      setAddClaimerError('Name is required')
      return
    }
    try {
      const created = await createClaimer.mutateAsync({
        name: newClaimer.name.trim(),
        matric_no: newClaimer.matric_no.trim() || undefined,
        phone: newClaimer.phone.trim() || undefined,
        email: newClaimer.email.trim() || undefined,
        cca_id: data.ccaId,
      })
      onChange({ claimerId: created.id })
      setShowAddClaimer(false)
      setNewClaimer({ name: '', matric_no: '', phone: '', email: '' })
    } catch {
      setAddClaimerError('Failed to create claimer. Please try again.')
    }
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

      {/* Claimer */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label required>Claimer</Label>
          {data.ccaId && !showAddClaimer && (
            <button
              type="button"
              onClick={() => setShowAddClaimer(true)}
              className="text-xs text-blue-600 font-medium"
            >
              + Add New
            </button>
          )}
        </div>

        {!showAddClaimer && (
          <Select
            value={data.claimerId}
            onChange={(val) => onChange({ claimerId: val })}
            placeholder={data.ccaId ? (claimersLoading ? 'Loading…' : 'Select claimer…') : 'Select CCA first'}
            options={claimerOptions}
            disabled={!data.ccaId || claimersLoading}
          />
        )}

        {/* Inline Add Claimer Form */}
        {showAddClaimer && (
          <div className="border border-blue-200 rounded-xl bg-blue-50 p-3 mt-1 space-y-2">
            <p className="text-xs font-semibold text-blue-700 mb-2">New Claimer</p>
            <div>
              <Label required>Name</Label>
              <Input
                value={newClaimer.name}
                onChange={(v) => setNewClaimer((p) => ({ ...p, name: v }))}
                placeholder="Full name"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Matric No.</Label>
                <Input
                  value={newClaimer.matric_no}
                  onChange={(v) => setNewClaimer((p) => ({ ...p, matric_no: v }))}
                  placeholder="A0XXXXXXX"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={newClaimer.phone}
                  onChange={(v) => setNewClaimer((p) => ({ ...p, phone: v }))}
                  placeholder="XXXXXXXX"
                />
              </div>
            </div>
            <div>
              <Label>School Email</Label>
              <Input
                type="email"
                value={newClaimer.email}
                onChange={(v) => setNewClaimer((p) => ({ ...p, email: v }))}
                placeholder="XXX@u.nus.edu"
              />
            </div>
            {addClaimerError && (
              <p className="text-xs text-red-600">{addClaimerError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleAddClaimer}
                disabled={createClaimer.isPending}
                className="flex-1 bg-blue-600 text-white text-sm font-medium py-1.5 rounded-lg disabled:opacity-60"
              >
                {createClaimer.isPending ? 'Saving…' : 'Save Claimer'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddClaimer(false)
                  setAddClaimerError('')
                }}
                className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-1.5 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Transport Trips Input ─────────────────────────────────────────────────────

const EMPTY_TRIP = { from: '', to: '', purpose: '', date: '', time: '', amount: '', distance_km: '' }

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
              <Input type="date" value={trip.date} onChange={(v) => updateTrip(i, 'date', v)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Time Started</label>
              <Input type="time" value={trip.time} onChange={(v) => updateTrip(i, 'time', v)} />
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

function Step2({ data, onChange }) {
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState('')

  function addEmail() {
    const val = emailInput.trim()
    if (!val) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEmailError('Enter a valid email address')
      return
    }
    if (data.otherEmails.includes(val)) {
      setEmailError('Email already added')
      return
    }
    onChange({ otherEmails: [...data.otherEmails, val] })
    setEmailInput('')
    setEmailError('')
  }

  function removeEmail(index) {
    onChange({ otherEmails: data.otherEmails.filter((_, i) => i !== index) })
  }

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

      {/* WBS Account */}
      <div>
        <Label required>WBS Account</Label>
        <Select
          value={data.wbsAccount}
          onChange={(v) => onChange({ wbsAccount: v })}
          placeholder="Select WBS account…"
          options={WBS_ACCOUNTS}
        />
      </div>

      {/* MF Approval upload — shown only when WBS Account is Master's Fund */}
      {data.wbsAccount === 'MF' && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">Master's Fund Approval <span className="text-red-500">*</span></p>
          <p className="text-xs text-amber-700">Attach the approval document before submitting.</p>
          {data.mfApprovalFile ? (
            <div className="flex items-center justify-between px-3 py-2 bg-white border border-amber-200 rounded-lg">
              <span className="text-sm text-amber-800 font-medium truncate">{data.mfApprovalFile.name}</span>
              <button type="button" onClick={() => onChange({ mfApprovalFile: null })} className="text-xs text-red-500 underline ml-2 shrink-0">Remove</button>
            </div>
          ) : (
            <DragDropZone
              label="Upload approval"
              onFile={(file) => onChange({ mfApprovalFile: file })}
              dragBorder="border-amber-400 bg-amber-50"
              idleBorder="border-amber-300 bg-amber-50 hover:bg-amber-100"
              withCrop
            />
          )}
        </div>
      )}

      {/* Remarks */}
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

      {/* Partial Claim */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            id="is-partial"
            type="checkbox"
            checked={data.isPartial}
            onChange={(e) => onChange({ isPartial: e.target.checked, partialAmount: '' })}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
          />
          <label htmlFor="is-partial" className="text-sm text-gray-700">
            Partial claim (amount claimed is less than receipt total)
          </label>
        </div>
        {data.isPartial && (
          <div>
            <Label required>Amount Claimed ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={data.partialAmount}
              onChange={(v) => onChange({ partialAmount: v })}
              placeholder="0.00"
            />
          </div>
        )}
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
            Transport form needed
          </label>
        </div>
        {data.transportFormNeeded && (
          <TransportTripsInput
            trips={data.transportTrips}
            onChange={(trips) => onChange({ transportTrips: trips })}
          />
        )}
      </div>

      {/* Other Emails */}
      <div>
        <Label>Other Emails</Label>
        <div className="flex gap-2">
          <Input
            type="email"
            value={emailInput}
            onChange={(v) => {
              setEmailInput(v)
              if (emailError) setEmailError('')
            }}
            placeholder="Add email address…"
            className="flex-1"
          />
          <button
            type="button"
            onClick={addEmail}
            className="shrink-0 bg-blue-600 text-white text-sm font-medium px-3 py-2 rounded-lg"
          >
            Add
          </button>
        </div>
        {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
        {data.otherEmails.length > 0 && (
          <div className="mt-2 space-y-1">
            {data.otherEmails.map((email, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                <span className="text-sm text-gray-700 truncate">{email}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(i)}
                  className="ml-2 shrink-0 text-gray-400 hover:text-red-500 text-base leading-none"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Receipt Form (shared sub-component) ─────────────────────────────────────

const EMPTY_RECEIPT = {
  description: '',
  amount: '',
  category: '',
  gst_code: 'IE',
  dr_cr: 'DR',
  receipt_no: '',
  company: '',
  date: '',
  files: [],
  is_foreign_currency: false,
  fx_screenshot_file: null,
}

function ReceiptForm({ onAdd, onEdit, existingCategories, initial }) {
  const [form, setForm] = useState(
    initial ? { ...initial, amount: String(initial.amount) } : EMPTY_RECEIPT
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
    if (!form.category) e.category = 'Required'
    if (!form.date) e.date = 'Required'
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

    const result = { ...form, amount: Number(form.amount) }
    if (onEdit) {
      onEdit(result)
    } else {
      onAdd(result)
      setForm(EMPTY_RECEIPT)
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
      </div>

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
              if (!e.target.checked) set('fx_screenshot_file', null)
            }}
            className="w-4 h-4 text-orange-500 border-gray-300 rounded"
          />
          <label htmlFor="fx-check" className="text-sm text-gray-700">Charged in foreign currency</label>
        </div>
        {form.is_foreign_currency && (
          <div className="pl-6">
            <Label>Exchange Rate Screenshot</Label>
            {form.fx_screenshot_file ? (
              <div className="flex items-center justify-between px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
                <span className="text-xs text-orange-700 truncate">{form.fx_screenshot_file.name}</span>
                <button type="button" onClick={() => set('fx_screenshot_file', null)} className="text-xs text-red-500 ml-2 shrink-0">Remove</button>
              </div>
            ) : (
              <DragDropZone
                label="+ Add exchange rate screenshot"
                onFile={(file) => set('fx_screenshot_file', file)}
                compact
                withCrop
                dragBorder="border-orange-400 bg-orange-50"
                idleBorder="border-orange-300 bg-orange-50 hover:bg-orange-100"
              />
            )}
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

function DraftReceiptRow({ receipt, onEdit, onRemove, existingCategories }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div>
        <ReceiptForm
          initial={receipt}
          onEdit={(updated) => { onEdit(receipt.localId, updated); setEditing(false) }}
          existingCategories={existingCategories.filter((c) => c !== receipt.category)}
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
          {receipt.files?.length > 0 && ` · ${receipt.files.length} photo${receipt.files.length !== 1 ? 's' : ''}`}
          {receipt.is_foreign_currency && <span className="ml-1 text-orange-600 font-semibold">FX</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-2 shrink-0">
        <span className="text-xs font-bold text-gray-900">${receipt.amount.toFixed(2)}</span>
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
    setRefunds((prev) => [...prev, { localId: generateId(), amount: '', file: null }])
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
      if (r.amount && !r.file) { setErr('Each refund needs a file'); return }
      if (!r.amount && r.file) { setErr('Each refund needs an amount'); return }
    }
    onSave({ amount: val, files, refunds: refunds.filter((r) => r.amount && r.file) })
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
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {refund.file ? (
                  <CroppableThumb
                    file={refund.file}
                    label={refund.file.name}
                    onRemove={() => updateRefund(refund.localId, { file: null })}
                    onCropped={(f) => updateRefund(refund.localId, { file: f })}
                  />
                ) : (
                  <DragDropZone
                    label="+ Attach File"
                    onFile={(file) => updateRefund(refund.localId, { file })}
                    compact
                    withCrop
                  />
                )}
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
  onAddReceipt, onRemoveReceipt, onEditReceipt, existingCategories,
  onAddBtFiles, onRemoveBtFile,
}) {
  const [showReceiptForm, setShowReceiptForm] = useState(false)
  const receiptSum = linkedReceipts.reduce((s, r) => s + r.amount, 0)
  const netAmount = bt.refunds?.length > 0
    ? bt.amount - bt.refunds.reduce((s, r) => s + Number(r.amount || 0), 0)
    : null

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
            {linkedReceipts.length > 0 && (
              <span className="font-normal text-gray-500">
                {' '}· {linkedReceipts.length} receipt{linkedReceipts.length !== 1 ? 's' : ''} · ${receiptSum.toFixed(2)}
              </span>
            )}
            {bt.files?.length > 0 && (
              <span className="font-normal text-gray-400">
                {' '}· {bt.files.length} img
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-blue-600 font-medium px-1.5 leading-none"
          title="Edit"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500 text-sm px-1 leading-none"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="px-3 py-2.5 space-y-2">
          {linkedReceipts.length > 0 && (
            <div className="space-y-1">
              {linkedReceipts.map((r) => (
                <DraftReceiptRow
                  key={r.localId}
                  receipt={r}
                  onEdit={onEditReceipt}
                  onRemove={onRemoveReceipt}
                  existingCategories={existingCategories}
                />
              ))}
            </div>
          )}

          {!showReceiptForm ? (
            <button
              type="button"
              onClick={() => setShowReceiptForm(true)}
              className="w-full border border-dashed border-blue-200 text-blue-600 text-xs font-medium py-2 rounded-lg"
            >
              + Add Receipt
            </button>
          ) : (
            <div>
              <ReceiptForm
                onAdd={(r) => { onAddReceipt(r); setShowReceiptForm(false) }}
                existingCategories={existingCategories}
              />
              <button
                type="button"
                onClick={() => setShowReceiptForm(false)}
                className="w-full mt-2 text-xs text-gray-500 py-1"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Bank Transactions & Receipts ─────────────────────────────────────

function Step3({
  bankTransactions, onAddBt, onRemoveBt, onEditBt,
  receipts, onAddReceipt, onRemoveReceipt, onEditReceipt,
  expandedBtId, onSetExpandedBtId,
}) {
  const [showBtModal, setShowBtModal] = useState(false)
  const [editingBt, setEditingBt] = useState(null)
  const [showUnlinkedForm, setShowUnlinkedForm] = useState(false)

  const allCategories = useMemo(() => receipts.map((r) => r.category), [receipts])
  const total = receipts.reduce((s, r) => s + r.amount, 0)
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
              />
            ))}
          </div>
        )}

        {showUnlinkedForm && (
          <div>
            <ReceiptForm
              onAdd={(r) => { onAddReceipt(r); setShowUnlinkedForm(false) }}
              existingCategories={allCategories}
            />
            <button type="button" onClick={() => setShowUnlinkedForm(false)} className="w-full mt-2 text-xs text-gray-500 py-1">
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      {receipts.length > 0 && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 bg-gray-50 border-b border-gray-100">
            Summary
          </p>
          <div className="divide-y divide-gray-100">
            {bankTransactions.map((bt, i) => {
              const linked = receipts.filter((r) => r.btLocalId === bt.localId)
              const sum = linked.reduce((s, r) => s + r.amount, 0)
              return (
                <div key={bt.localId} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-sm text-gray-800">Bank Tx {i + 1}</span>
                    <span className="text-xs text-gray-400 ml-2">{linked.length} receipt{linked.length !== 1 ? 's' : ''}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">${sum.toFixed(2)}</span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'new_claim_draft'

const DEFAULT_STEP1 = { portfolioId: '', ccaId: '', claimerId: '' }
const DEFAULT_STEP2 = {
  claimDescription: '',
  date: today(),
  wbsAccount: '',
  remarks: '',
  transportFormNeeded: false,
  transportTrips: [],
  mfApprovalFile: null,
  isPartial: false,
  partialAmount: '',
  otherEmails: [],
}

export default function NewClaimPage() {
  const navigate = useNavigate()
  const createClaim = useCreateClaim()
  const createReceipt = useCreateReceipt()
  const savedSuccessfully = useRef(false)

  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Step 1 state
  const [step1, setStep1] = useState(DEFAULT_STEP1)

  // Step 2 state
  const [step2, setStep2] = useState(DEFAULT_STEP2)

  // Step 3 state
  const [bankTransactions, setBankTransactions] = useState([])  // [{localId, amount, files, refunds}]
  const [receipts, setReceipts] = useState([])
  const [expandedBtId, setExpandedBtId] = useState(null)

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY)
      if (saved) {
        const { step: s, step1: s1, step2: s2, receipts: r, bankTransactions: bt, expandedBtId: eid } = JSON.parse(saved)
        if (s1) setStep1(s1)
        if (s2) setStep2(s2)
        if (r) setReceipts(r.map((rec) => ({ ...rec, files: [], fx_screenshot_file: null })))
        if (bt) setBankTransactions(bt.map((b) => ({ files: [], ...b, refunds: (b.refunds ?? []).map((r) => ({ ...r, file: null })) })))
        if (eid) setExpandedBtId(eid)
        if (s) setStep(s)
      }
    } catch {}
  }, [])

  // Persist draft to sessionStorage on every change (strip File objects — not serializable)
  useEffect(() => {
    try {
      const btsForDraft = bankTransactions.map(({ files: _f, ...bt }) => ({
        ...bt,
        refunds: (bt.refunds ?? []).map(({ file: _rf, ...r }) => r),
      }))
      const receiptsForDraft = receipts.map(({ files: _f, fx_screenshot_file: _fx, ...r }) => r)
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, step1, step2, receipts: receiptsForDraft, bankTransactions: btsForDraft, expandedBtId }))
    } catch {}
  }, [step, step1, step2, receipts, bankTransactions, expandedBtId])

  // Clear draft on unmount only if save succeeded
  useEffect(() => {
    return () => {
      if (savedSuccessfully.current) sessionStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  // ── Step validation ──────────────────────────────────────────────────────

  const step1Valid = step1.portfolioId && step1.ccaId && step1.claimerId
  const step2Valid = step2.claimDescription.trim() && step2.date && step2.wbsAccount

  // ── Handlers ─────────────────────────────────────────────────────────────

  function updateStep1(patch) {
    setStep1((prev) => ({ ...prev, ...patch }))
  }

  function updateStep2(patch) {
    setStep2((prev) => ({ ...prev, ...patch }))
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

  function addReceipt(receipt) {
    setReceipts((prev) => [...prev, { ...receipt, localId: generateId() }])
  }

  function editReceipt(localId, updated) {
    setReceipts((prev) => prev.map((r) => r.localId === localId ? { ...r, ...updated } : r))
  }

  function removeReceipt(localId) {
    setReceipts((prev) => prev.filter((r) => r.localId !== localId))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')

    let claimId = null

    try {
      const totalAmount = receipts.reduce((s, r) => s + r.amount, 0)

      // Auto-append remarks for FX receipts and MF approval
      let autoRemarks = step2.remarks.trim()
      const hasFxReceipt = receipts.some(r => r.is_foreign_currency && r.fx_screenshot_file)
      const FX_REMARK = '- Exchange Rate Screenshot is Attached'
      const MF_REMARK = "- Master's Approval Screenshot is attached"
      if (hasFxReceipt && !autoRemarks.includes(FX_REMARK))
        autoRemarks = autoRemarks ? `${autoRemarks}\n${FX_REMARK}` : FX_REMARK
      if (step2.wbsAccount === 'MF' && step2.mfApprovalFile && !autoRemarks.includes(MF_REMARK))
        autoRemarks = autoRemarks ? `${autoRemarks}\n${MF_REMARK}` : MF_REMARK

      // 1. Create the claim
      const claim = await createClaim.mutateAsync({
        claimer_id: step1.claimerId,
        claim_description: step2.claimDescription.trim(),
        total_amount: totalAmount,
        date: step2.date,
        wbs_account: step2.wbsAccount,
        remarks: autoRemarks || undefined,
        other_emails: step2.otherEmails,
        transport_form_needed: step2.transportFormNeeded,
        is_partial: step2.isPartial,
        partial_amount: step2.isPartial && step2.partialAmount ? Number(step2.partialAmount) : undefined,
      })

      claimId = claim?.id ?? claim?.claim?.id
      if (!claimId) throw new Error('No claim ID returned from server')

      // 1b. Upload MF approval if present
      if (step2.wbsAccount === 'MF' && step2.mfApprovalFile) {
        try { await uploadMfApproval({ claimId, file: step2.mfApprovalFile }) } catch {}
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
              date: t.date || undefined,
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
          try { await uploadBankTransactionImage({ btId: created.id, file }) } catch {}
        }
        for (const refund of (bt.refunds ?? [])) {
          if (!refund.amount || !refund.file) continue
          try { await createBtRefund({ btId: created.id, amount: Number(refund.amount), file: refund.file }) } catch {}
        }
      }

      // 3. Create receipts — pre-upload any attached photos first
      for (const r of receipts) {
        const driveIds = []
        for (const file of (r.files ?? [])) {
          try {
            const data = await uploadReceiptImage({ file, claim_id: claimId, image_type: 'receipt' })
            driveIds.push(data.drive_file_id)
          } catch {
            // Non-fatal: Drive unavailable, continue saving
          }
        }
        let fxDriveId = null
        if (r.is_foreign_currency && r.fx_screenshot_file) {
          try {
            const data = await uploadReceiptImage({ file: r.fx_screenshot_file, claim_id: claimId, image_type: 'exchange_rate' })
            fxDriveId = data.drive_file_id
          } catch {}
        }
        await createReceipt.mutateAsync({
          claim_id: claimId,
          bank_transaction_id: r.btLocalId ? btIdMap[r.btLocalId] : undefined,
          receipt_no: r.receipt_no || undefined,
          description: r.description,
          company: r.company || undefined,
          date: r.date || undefined,
          amount: r.amount,
          category: r.category,
          gst_code: r.gst_code,
          dr_cr: r.dr_cr,
          receipt_image_drive_ids: driveIds.length > 0 ? driveIds : undefined,
          is_foreign_currency: r.is_foreign_currency,
          exchange_rate_screenshot_drive_id: fxDriveId || undefined,
        })
      }

      savedSuccessfully.current = true
      sessionStorage.removeItem(DRAFT_KEY)
      navigate(`/claims/${claimId}`)
    } catch (err) {
      if (claimId) {
        navigate(`/claims/${claimId}`)
      } else {
        setSaveError(err?.response?.data?.detail || err?.message || 'Failed to save claim.')
        setSaving(false)
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 text-lg leading-none p-1 -ml-1"
        >
          ←
        </button>
        <h1 className="text-base font-bold text-gray-900">New Claim</h1>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <StepIndicator current={step} />

        {step === 1 && <Step1 data={step1} onChange={updateStep1} />}
        {step === 2 && <Step2 data={step2} onChange={updateStep2} />}
        {step === 3 && (
          <Step3
            bankTransactions={bankTransactions}
            onAddBt={addBt}
            onRemoveBt={removeBt}
            onEditBt={editBt}
            receipts={receipts}
            onAddReceipt={addReceipt}
            onRemoveReceipt={removeReceipt}
            onEditReceipt={editReceipt}
            expandedBtId={expandedBtId}
            onSetExpandedBtId={setExpandedBtId}
          />
        )}

        {saveError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={saving}
            className="flex-1 border border-gray-300 text-gray-700 text-sm font-semibold py-2.5 rounded-xl disabled:opacity-60"
          >
            Back
          </button>
        )}

        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={
              (step === 1 && !step1Valid) ||
              (step === 2 && !step2Valid)
            }
            className="flex-1 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50"
          >
            Next
          </button>
        )}

        {step === 3 && (
          <div className="flex-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                'Save Claim'
              )}
            </button>
            {saving && (
              <p className="text-xs text-gray-500 text-center">Uploading images — this may take a minute</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
