import { useState, useMemo } from 'react'
import { useClaimers, useCreateClaimer, useUpdateClaimer, useDeleteClaimer } from '../api/claimers'
import { usePortfolios } from '../api/portfolios'
import api from '../api/client'
import { useQuery } from '@tanstack/react-query'

// Fetch all CCAs across all portfolios in one shot
function useAllCcas(portfolios) {
  return useQuery({
    queryKey: ['all-ccas', (portfolios || []).map((p) => p.id)],
    queryFn: async () => {
      if (!portfolios?.length) return []
      const results = await Promise.all(
        portfolios.map((p) =>
          api.get(`/portfolios/${p.id}/ccas`).then((r) =>
            r.data.map((c) => ({ ...c, portfolio: p }))
          )
        )
      )
      return results.flat()
    },
    enabled: !!(portfolios?.length),
  })
}

// ── Inline edit / add form ────────────────────────────────────────────────────
function ClaimerForm({ initial, ccas, onSave, onCancel, saving }) {
  const [fields, setFields] = useState({
    name: initial?.name ?? '',
    matric_no: initial?.matric_no ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    cca_id: initial?.cca_id ?? initial?.cca?.id ?? '',
  })

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!fields.name.trim()) return
    if (!fields.cca_id) return
    onSave(fields)
  }

  // Group ccas by portfolio name for the select
  const grouped = useMemo(() => {
    const map = {}
    ;(ccas || []).forEach((c) => {
      const pName = c.portfolio?.name ?? 'Other'
      if (!map[pName]) map[pName] = []
      map[pName].push(c)
    })
    return map
  }, [ccas])

  return (
    <form onSubmit={handleSubmit} className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">CCA *</label>
        <select
          value={fields.cca_id}
          onChange={set('cca_id')}
          required
          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select CCA…</option>
          {Object.entries(grouped).map(([portfolio, ccaList]) => (
            <optgroup key={portfolio} label={portfolio}>
              {ccaList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
        <input
          type="text"
          value={fields.name}
          onChange={set('name')}
          required
          placeholder="Full name"
          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Matric No.</label>
          <input
            type="text"
            value={fields.matric_no}
            onChange={set('matric_no')}
            placeholder="A0XXXXXX"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Phone</label>
          <input
            type="tel"
            value={fields.phone}
            onChange={set('phone')}
            placeholder="+65XXXXXXXX"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-0.5">Email</label>
        <input
          type="email"
          value={fields.email}
          onChange={set('email')}
          placeholder="e@u.nus.edu"
          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-blue-600 text-white text-sm font-medium rounded py-1.5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium rounded py-1.5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Single claimer row ────────────────────────────────────────────────────────
function ClaimerRow({ claimer, ccas, onEditSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const updateMutation = useUpdateClaimer()
  const deleteMutation = useDeleteClaimer()

  const handleSave = (fields) => {
    updateMutation.mutate(
      { id: claimer.id, ...fields },
      {
        onSuccess: (updated) => {
          setEditing(false)
          onEditSaved?.(updated)
        },
      }
    )
  }

  const handleDelete = () => {
    setDeleteError(null)
    deleteMutation.mutate(claimer.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        onDeleted?.(claimer.id)
      },
      onError: (err) => {
        const status = err?.response?.status
        if (status === 409) {
          setDeleteError('Cannot delete: claimer has active claims.')
        } else {
          setDeleteError('Delete failed. Please try again.')
        }
      },
    })
  }

  if (editing) {
    return (
      <li className="px-3 pb-2">
        <ClaimerForm
          initial={claimer}
          ccas={ccas}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
          saving={updateMutation.isPending}
        />
      </li>
    )
  }

  return (
    <li className="px-3 py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{claimer.name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {claimer.matric_no && (
              <span className="text-xs text-gray-500">{claimer.matric_no}</span>
            )}
            {claimer.phone && (
              <span className="text-xs text-gray-500">{claimer.phone}</span>
            )}
            {claimer.email && (
              <span className="text-xs text-gray-500 truncate">{claimer.email}</span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 font-medium px-2 py-1 rounded hover:bg-blue-50"
          >
            Edit
          </button>
          <button
            onClick={() => { setConfirmDelete(true); setDeleteError(null) }}
            className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
          <p className="text-xs text-red-700 mb-2">Delete <strong>{claimer.name}</strong>?</p>
          {deleteError && (
            <p className="text-xs text-red-600 mb-2">{deleteError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="flex-1 text-xs bg-red-600 text-white rounded py-1 font-medium disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              onClick={() => { setConfirmDelete(false); setDeleteError(null) }}
              disabled={deleteMutation.isPending}
              className="flex-1 text-xs bg-gray-100 text-gray-700 rounded py-1 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IdentifierDataPage() {
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const claimerParams = search ? { search } : {}
  const { data: claimers, isLoading, isError, error } = useClaimers(claimerParams)
  const { data: portfolios } = usePortfolios()
  const { data: allCcas } = useAllCcas(portfolios)
  const createMutation = useCreateClaimer()

  const handleAdd = (fields) => {
    createMutation.mutate(fields, {
      onSuccess: () => {
        setShowAddForm(false)
      },
    })
  }

  // Group claimers: portfolio → cca → [claimers]
  const grouped = useMemo(() => {
    if (!claimers?.length) return {}
    const map = {}
    claimers.forEach((c) => {
      const portfolio = c.cca?.portfolio?.name ?? 'Unknown Portfolio'
      const cca = c.cca?.name ?? 'Unknown CCA'
      if (!map[portfolio]) map[portfolio] = {}
      if (!map[portfolio][cca]) map[portfolio][cca] = []
      map[portfolio][cca].push(c)
    })
    return map
  }, [claimers])

  const isEmpty = !isLoading && !isError && claimers?.length === 0

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-4 pb-3 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Identifier Data</h1>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="text-sm bg-blue-600 text-white font-medium px-3 py-1.5 rounded-lg"
          >
            {showAddForm ? 'Cancel' : '+ Add Claimer'}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, matric or email…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Add form */}
        {showAddForm && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">New Claimer</h2>
            <ClaimerForm
              ccas={allCcas}
              onSave={handleAdd}
              onCancel={() => setShowAddForm(false)}
              saving={createMutation.isPending}
            />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            Loading claimers…
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            Failed to load claimers: {error?.message ?? 'Unknown error'}
          </div>
        )}

        {/* Empty */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <span className="text-4xl mb-2">👥</span>
            <p className="text-sm">
              {search ? 'No claimers match your search.' : 'No claimers found.'}
            </p>
          </div>
        )}

        {/* Grouped list */}
        {!isLoading && !isError && Object.entries(grouped).map(([portfolio, ccaMap]) => (
          <div key={portfolio}>
            {/* Portfolio heading */}
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2 first:mt-0">
              {portfolio}
            </h2>

            <div className="space-y-2">
              {Object.entries(ccaMap).map(([cca, members]) => (
                <div key={cca} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  {/* CCA sub-heading */}
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-sm font-medium text-gray-700">{cca}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {members.length} {members.length === 1 ? 'person' : 'people'}
                    </span>
                  </div>

                  <ul>
                    {members.map((claimer) => (
                      <ClaimerRow
                        key={claimer.id}
                        claimer={claimer}
                        ccas={allCcas}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
