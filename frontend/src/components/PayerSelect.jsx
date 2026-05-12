import { useEffect, useMemo, useState } from 'react'

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function optionKey(option) {
  if (!option) return ''
  if (option.is_saved) return `saved:${option.id}`
  if (option.is_self) return `self:${option.id}`
  return `claim:${cleanEmail(option.email)}:${option.name || ''}`
}

function toSnapshot(option) {
  if (!option) return { payer_id: null, payer_name: '', payer_email: '' }
  return {
    payer_id: option.is_saved ? option.id : null,
    payer_name: option.name || '',
    payer_email: cleanEmail(option.email),
  }
}

function normalizeOption(option) {
  return {
    ...option,
    email: cleanEmail(option.email),
    is_saved: Boolean(option.is_saved),
    is_self: Boolean(option.is_self),
  }
}

export default function PayerSelect({
  payer,
  onChange,
  options = [],
  onCreatePayer,
  onUpdatePayer,
  onDeletePayer,
  canManageSaved = false,
  loading = false,
  disabled = false,
  error,
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [localError, setLocalError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')

  const normalizedOptions = useMemo(
    () => options.map(normalizeOption).filter((option) => option.name && option.email),
    [options]
  )
  const savedOptions = normalizedOptions.filter((option) => option.is_saved)

  const selectedKey = useMemo(() => {
    if (!payer?.payer_name && !payer?.payer_email && !payer?.payer_id) return ''
    const match = normalizedOptions.find((option) => {
      if (payer?.payer_id && option.is_saved) return option.id === payer.payer_id
      return cleanEmail(option.email) === cleanEmail(payer?.payer_email) && option.name === payer?.payer_name
    })
    return match ? optionKey(match) : `custom:${cleanEmail(payer?.payer_email)}:${payer?.payer_name || ''}`
  }, [normalizedOptions, payer])

  useEffect(() => {
    if (disabled || loading) return
    if (payer?.payer_name && payer?.payer_email) return
    const first = normalizedOptions[0]
    if (first) onChange(toSnapshot(first))
  }, [disabled, loading, normalizedOptions, onChange, payer?.payer_email, payer?.payer_name])

  async function handleAdd() {
    const name = newName.trim()
    const email = cleanEmail(newEmail)
    if (!name || !email || !email.includes('@')) {
      setLocalError('Enter the invoice name and their email.')
      return
    }
    setLocalError('')
    try {
      const created = await onCreatePayer?.({ name, email })
      const option = normalizeOption(created || { name, email, is_saved: false })
      onChange(toSnapshot(option))
      setNewName('')
      setNewEmail('')
      setShowAdd(false)
    } catch (err) {
      setLocalError(err?.response?.data?.detail || 'Could not save payer.')
    }
  }

  function startEdit(option) {
    setEditingId(option.id)
    setEditName(option.name)
    setEditEmail(option.email)
    setLocalError('')
  }

  async function saveEdit(option) {
    const name = editName.trim()
    const email = cleanEmail(editEmail)
    if (!name || !email || !email.includes('@')) {
      setLocalError('Enter the invoice name and their email.')
      return
    }
    try {
      const updated = await onUpdatePayer?.(option.id, { name, email })
      if (payer?.payer_id === option.id) onChange(toSnapshot(normalizeOption(updated)))
      setEditingId(null)
    } catch (err) {
      setLocalError(err?.response?.data?.detail || 'Could not update payer.')
    }
  }

  async function removeSaved(option) {
    try {
      await onDeletePayer?.(option.id)
      if (payer?.payer_id === option.id) {
        const fallback = normalizedOptions.find((item) => item.id !== option.id)
        onChange(toSnapshot(fallback))
      }
    } catch (err) {
      setLocalError(err?.response?.data?.detail || 'Could not delete payer.')
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">
          Name on invoice <span className="text-red-500">*</span>
        </label>
        <p className="mb-1 text-xs text-gray-400">
          If another person appears on the invoice, add their name and email here. This is the email stored in the database for reimbursement records.
        </p>
        <select
          value={selectedKey}
          disabled={disabled || loading || normalizedOptions.length === 0}
          onChange={(event) => {
            const option = normalizedOptions.find((item) => optionKey(item) === event.target.value)
            onChange(toSnapshot(option))
          }}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="" disabled>
            {loading ? 'Loading people...' : 'Select invoice person'}
          </option>
          {normalizedOptions.map((option) => (
            <option key={optionKey(option)} value={optionKey(option)}>
              {option.name} ({option.email}){option.is_self ? ' - self' : ''}
            </option>
          ))}
          {selectedKey.startsWith('custom:') && (
            <option value={selectedKey}>
              {payer.payer_name} ({payer.payer_email})
            </option>
          )}
        </select>
        {(error || localError) && <p className="mt-1 text-xs text-red-500">{error || localError}</p>}
      </div>

      <button
        type="button"
        onClick={() => setShowAdd((value) => !value)}
        disabled={disabled}
        className="text-xs font-medium text-blue-600 disabled:text-gray-400"
      >
        {showAdd ? 'Cancel entry' : '+ Add invoice person'}
      </button>

      {showAdd && (
        <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name on invoice"
              className="rounded-lg border border-blue-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="Email to record"
              className="rounded-lg border border-blue-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Save person
          </button>
        </div>
      )}

      {canManageSaved && savedOptions.length > 0 && (
        <div className="space-y-1 rounded-xl border border-gray-100 bg-white p-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Saved invoice people
          </p>
          {savedOptions.map((option) => (
            <div key={option.id} className="rounded-lg bg-gray-50 px-2 py-1.5">
              {editingId === option.id ? (
                <div className="space-y-1.5">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => saveEdit(option)} className="text-xs font-semibold text-blue-600">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-gray-500">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-gray-700">{option.name}</p>
                    <p className="truncate text-[11px] text-gray-500">{option.email}</p>
                  </div>
                  <button type="button" onClick={() => startEdit(option)} className="text-xs font-semibold text-blue-600">
                    Edit
                  </button>
                  <button type="button" onClick={() => removeSaved(option)} className="text-xs font-semibold text-red-500">
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
