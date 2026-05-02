import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortfolios, useCcasByPortfolio } from '../api/portfolios'
import { useClaimers, useCreateClaimer } from '../api/claimers'
import { useCreateClaim } from '../api/claims'
import { useCreateReceipt, uploadReceiptImage } from '../api/receipts'
import { createBankTransaction, uploadBankTransactionImage } from '../api/bankTransactions'
import { WBS_ACCOUNTS, CATEGORIES, GST_CODES, DR_CR_OPTIONS } from '../constants/claimConstants'

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
  const steps = ['Who', 'What', 'Bank Txns']
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

function Input({ value, onChange, type = 'text', placeholder, disabled, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
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
                  placeholder="A1234567B"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={newClaimer.phone}
                  onChange={(v) => setNewClaimer((p) => ({ ...p, phone: v }))}
                  placeholder="+65 9xxx"
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={newClaimer.email}
                onChange={(v) => setNewClaimer((p) => ({ ...p, email: v }))}
                placeholder="name@example.com"
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

      {/* Remarks */}
      <div>
        <Label>Remarks</Label>
        <Textarea
          value={data.remarks}
          onChange={(v) => onChange({ remarks: v })}
          placeholder="Optional remarks…"
          rows={2}
        />
      </div>

      {/* Transport Form Needed */}
      <div className="flex items-center gap-2">
        <input
          id="transport-form"
          type="checkbox"
          checked={data.transportFormNeeded}
          onChange={(e) => onChange({ transportFormNeeded: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
        />
        <label htmlFor="transport-form" className="text-sm text-gray-700">
          Transport form needed
        </label>
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
}

function ReceiptForm({ onAdd, existingCategories }) {
  const [form, setForm] = useState(EMPTY_RECEIPT)
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
    return e
  }

  function handleAdd() {
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }

    const uniqueAfter = new Set([...existingCategories, form.category])
    if (uniqueAfter.size > MAX_CATEGORIES) {
      setErrors({ category: `Max ${MAX_CATEGORIES} categories per claim. Please split into a separate claim.` })
      return
    }

    onAdd({ ...form, amount: Number(form.amount) })
    setForm(EMPTY_RECEIPT)
    setErrors({})
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-gray-700">Add Receipt</p>

      {/* Receipt photos */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Receipt Photos</p>
        {form.files.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {form.files.map((file, i) => (
              <div key={i} className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded px-2 py-0.5 text-xs">
                <span className="text-gray-700 truncate max-w-[100px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, files: prev.files.filter((_, j) => j !== i) }))}
                  className="text-red-400 ml-1"
                >×</button>
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
              const newFiles = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (newFiles.length) setForm((prev) => ({ ...prev, files: [...prev.files, ...newFiles] }))
            }}
          />
          + Add photo
        </label>
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
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>Company</Label>
          <Input
            value={form.company}
            onChange={(v) => set('company', v)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div>
        <Label>Receipt Date</Label>
        <Input
          type="date"
          value={form.date}
          onChange={(v) => set('date', v)}
        />
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="w-full bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg mt-1"
      >
        Add to List
      </button>
    </div>
  )
}

// ─── BtDraftCard ──────────────────────────────────────────────────────────────

function BtDraftCard({
  bt, btIndex, linkedReceipts, expanded, onToggle, onRemove,
  onAddReceipt, onRemoveReceipt, existingCategories,
  onAddBtFiles, onRemoveBtFile,
}) {
  const [showReceiptForm, setShowReceiptForm] = useState(false)
  const receiptSum = linkedReceipts.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2.5 bg-gray-50">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left"
        >
          <span className="text-gray-400 text-xs">{expanded ? '▼' : '▶'}</span>
          <span className="flex-1 text-xs font-semibold text-gray-700">
            Bank Tx {btIndex} · ${bt.amount.toFixed(2)}
            {linkedReceipts.length > 0 && (
              <span className="font-normal text-gray-500">
                {' '}· {linkedReceipts.length} receipt{linkedReceipts.length !== 1 ? 's' : ''} · ${receiptSum.toFixed(2)}
              </span>
            )}
            {bt.files?.length > 0 && (
              <span className="font-normal text-gray-400">
                {' '}· {bt.files.length} screenshot{bt.files.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>
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
          {/* Bank screenshots */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Bank Screenshots</p>
            {bt.files?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {bt.files.map((file, i) => (
                  <div key={i} className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded px-2 py-0.5 text-xs">
                    <span className="text-gray-700 truncate max-w-[100px]">{file.name}</span>
                    <button type="button" onClick={() => onRemoveBtFile(i)} className="text-red-400 ml-1">×</button>
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
                  const newFiles = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (newFiles.length) onAddBtFiles(newFiles)
                }}
              />
              + Add screenshot
            </label>
          </div>

          {linkedReceipts.length > 0 && (
            <div className="space-y-1">
              {linkedReceipts.map((r) => (
                <div
                  key={r.localId}
                  className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{r.description}</p>
                    <p className="text-xs text-gray-500">
                      {r.category}{r.company ? ` · ${r.company}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <span className="text-xs font-bold text-gray-900">${r.amount.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveReceipt(r.localId)}
                      className="text-gray-400 hover:text-red-500 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                </div>
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
  bankTransactions, onAddBt, onRemoveBt,
  receipts, onAddReceipt, onRemoveReceipt,
  expandedBtId, onSetExpandedBtId,
  onAddBtFiles, onRemoveBtFile,
}) {
  const [showAddBt, setShowAddBt] = useState(false)
  const [newBtAmount, setNewBtAmount] = useState('')
  const [btAmountError, setBtAmountError] = useState('')
  const [showUnlinkedForm, setShowUnlinkedForm] = useState(false)

  const allCategories = useMemo(() => receipts.map((r) => r.category), [receipts])
  const total = receipts.reduce((s, r) => s + r.amount, 0)
  const unlinkedReceipts = receipts.filter((r) => !r.btLocalId)

  function handleAddBt() {
    const val = Number(newBtAmount)
    if (!newBtAmount || isNaN(val) || val <= 0) {
      setBtAmountError('Enter a valid amount')
      return
    }
    onAddBt({ localId: generateId(), amount: val })
    setNewBtAmount('')
    setBtAmountError('')
    setShowAddBt(false)
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
                onAddReceipt={(r) => onAddReceipt({ ...r, btLocalId: bt.localId })}
                onRemoveReceipt={onRemoveReceipt}
                existingCategories={allCategories}
                onAddBtFiles={(files) => onAddBtFiles(bt.localId, files)}
                onRemoveBtFile={(idx) => onRemoveBtFile(bt.localId, idx)}
              />
            )
          })}
        </div>
      )}

      {/* Add BT form / button */}
      {showAddBt ? (
        <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">New Bank Transaction</p>
          <div>
            <Label required>Amount ($)</Label>
            <Input
              type="number"
              value={newBtAmount}
              onChange={(v) => { setNewBtAmount(v); if (btAmountError) setBtAmountError('') }}
              placeholder="0.00"
            />
            {btAmountError && <p className="text-xs text-red-500 mt-0.5">{btAmountError}</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddBt}
              className="flex-1 bg-blue-600 text-white text-sm font-medium py-1.5 rounded-lg"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowAddBt(false); setNewBtAmount(''); setBtAmountError('') }}
              className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-1.5 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddBt(true)}
          className="w-full border-2 border-dashed border-blue-300 text-blue-600 text-sm font-medium py-3 rounded-xl"
        >
          + Add Bank Transaction
        </button>
      )}

      {/* Unlinked receipts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-600">
            Unlinked Receipts{unlinkedReceipts.length > 0 ? ` (${unlinkedReceipts.length})` : ''}
          </p>
          {!showUnlinkedForm && (
            <button
              type="button"
              onClick={() => setShowUnlinkedForm(true)}
              className="text-xs text-blue-600 font-medium"
            >
              + Add
            </button>
          )}
        </div>

        {unlinkedReceipts.length > 0 && (
          <div className="space-y-1">
            {unlinkedReceipts.map((r) => (
              <div
                key={r.localId}
                className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{r.description}</p>
                  <p className="text-xs text-gray-500">
                    {r.category}{r.company ? ` · ${r.company}` : ''}
                    {r.files?.length > 0 && ` · ${r.files.length} photo${r.files.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-xs font-bold text-gray-900">${r.amount.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveReceipt(r.localId)}
                    className="text-gray-400 hover:text-red-500 text-sm leading-none"
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showUnlinkedForm && (
          <div>
            <ReceiptForm
              onAdd={(r) => { onAddReceipt(r); setShowUnlinkedForm(false) }}
              existingCategories={allCategories}
            />
            <button
              type="button"
              onClick={() => setShowUnlinkedForm(false)}
              className="w-full mt-2 text-xs text-gray-500 py-1"
            >
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
                    <span className="text-xs text-gray-400 ml-2">
                      {linked.length} receipt{linked.length !== 1 ? 's' : ''}
                    </span>
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
        <p className="text-xs text-gray-400 text-center py-2">
          Add a bank transaction to get started
        </p>
      )}
      {bankTransactions.length > 0 && receipts.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-1">
          Expand a bank transaction to add receipts
        </p>
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
  const [bankTransactions, setBankTransactions] = useState([])
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
        if (r) setReceipts(r.map((rec) => ({ ...rec, files: [] })))
        if (bt) setBankTransactions(bt.map((b) => ({ ...b, files: [] })))
        if (eid) setExpandedBtId(eid)
        if (s) setStep(s)
      }
    } catch {}
  }, [])

  // Persist draft to sessionStorage on every change (strip File objects — not serializable)
  useEffect(() => {
    try {
      const btsForDraft = bankTransactions.map(({ files: _f, ...bt }) => bt)
      const receiptsForDraft = receipts.map(({ files: _f, ...r }) => r)
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
    setBankTransactions((prev) => [...prev, { ...bt, files: [] }])
    setExpandedBtId(bt.localId)
  }

  function addBtFiles(btLocalId, files) {
    setBankTransactions((prev) =>
      prev.map((bt) => bt.localId === btLocalId ? { ...bt, files: [...(bt.files ?? []), ...files] } : bt)
    )
  }

  function removeBtFile(btLocalId, idx) {
    setBankTransactions((prev) =>
      prev.map((bt) => bt.localId === btLocalId ? { ...bt, files: bt.files.filter((_, i) => i !== idx) } : bt)
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

  function removeReceipt(localId) {
    setReceipts((prev) => prev.filter((r) => r.localId !== localId))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')

    let claimId = null

    try {
      const totalAmount = receipts.reduce((s, r) => s + r.amount, 0)

      // 1. Create the claim
      const claim = await createClaim.mutateAsync({
        claimer_id: step1.claimerId,
        claim_description: step2.claimDescription.trim(),
        total_amount: totalAmount,
        date: step2.date,
        wbs_account: step2.wbsAccount,
        remarks: step2.remarks.trim() || undefined,
        other_emails: step2.otherEmails,
        transport_form_needed: step2.transportFormNeeded,
      })

      claimId = claim?.id ?? claim?.claim?.id
      if (!claimId) throw new Error('No claim ID returned from server')

      // 2. Create bank transactions, upload screenshots, build local → real ID map
      const btIdMap = {}
      for (const bt of bankTransactions) {
        const created = await createBankTransaction({ claimId, amount: bt.amount })
        btIdMap[bt.localId] = created.id
        for (const file of (bt.files ?? [])) {
          await uploadBankTransactionImage({ btId: created.id, file })
        }
      }

      // 3. Create receipts — pre-upload any attached photos first
      for (const r of receipts) {
        const driveIds = []
        for (const file of (r.files ?? [])) {
          const data = await uploadReceiptImage({ file, claim_id: claimId, image_type: 'receipt' })
          driveIds.push(data.drive_file_id)
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
            receipts={receipts}
            onAddReceipt={addReceipt}
            onRemoveReceipt={removeReceipt}
            expandedBtId={expandedBtId}
            onSetExpandedBtId={setExpandedBtId}
            onAddBtFiles={addBtFiles}
            onRemoveBtFile={removeBtFile}
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
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              'Save Claim'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
