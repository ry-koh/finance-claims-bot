import { useState, useMemo } from 'react'
import { useTeamMembers, useUpdateTeamMember, useRemoveTeamMember } from '../api/admin'
import { usePublicCcas } from '../api/portfolios'

function TreasurerRow({ member, allCcas, updateMutation, removeMutation }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name || '')
  const [editEmail, setEditEmail] = useState(member.email || '')
  const [editCcaIds, setEditCcaIds] = useState((member.ccas || []).map((c) => c.id))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rowError, setRowError] = useState(null)

  function openEdit() {
    setEditName(member.name || '')
    setEditEmail(member.email || '')
    setEditCcaIds((member.ccas || []).map((c) => c.id))
    setRowError(null)
    setEditing(true)
  }

  function toggleCca(id) {
    setEditCcaIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function handleSave() {
    setRowError(null)
    updateMutation.mutate(
      { id: member.id, role: 'treasurer', cca_ids: editCcaIds, name: editName.trim() || undefined, email: editEmail.trim() || undefined },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setRowError(err?.response?.data?.detail || 'Update failed.'),
      }
    )
  }

  function handleRemove() {
    setRowError(null)
    removeMutation.mutate(member.id, {
      onSuccess: () => setConfirmRemove(false),
      onError: (err) => setRowError(err?.response?.data?.detail || 'Remove failed.'),
    })
  }

  const isSaving = updateMutation.isPending
  const isRemoving = removeMutation.isPending
  const ccaNames = (member.ccas || []).map((c) => c.name).join(', ')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
        </div>
      </div>
      {ccaNames && (
        <p className="text-xs text-gray-400 mb-2">CCAs: {ccaNames}</p>
      )}

      {rowError && <p className="text-xs text-red-600 mb-2">{rowError}</p>}

      {!editing && !confirmRemove && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={openEdit}
            className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => { setConfirmRemove(true); setRowError(null) }}
            className="flex-1 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium"
          >
            Remove
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Name</p>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Full name"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Email</p>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
              placeholder="Email address"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">CCAs</p>
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
              {allCcas.map((cca) => (
                <label
                  key={cca.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={editCcaIds.includes(cca.id)}
                    onChange={() => toggleCca(cca.id)}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-800">{cca.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{cca.portfolio?.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!editName.trim() || editCcaIds.length === 0 || isSaving}
              className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={isSaving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-red-700 mb-2">
            Remove <strong>{member.name}</strong>? They will lose access immediately.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isRemoving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Confirm
            </button>
            <button
              onClick={() => { setConfirmRemove(false); setRowError(null) }}
              disabled={isRemoving}
              className="flex-1 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CcaTreasurersPage() {
  const { data: allMembers = [], isLoading, isError } = useTeamMembers()
  const { data: allCcas = [] } = usePublicCcas()
  const updateMutation = useUpdateTeamMember()
  const removeMutation = useRemoveTeamMember()
  const [search, setSearch] = useState('')

  const treasurers = useMemo(() => {
    return allMembers
      .filter((m) => m.role === 'treasurer')
      .sort((a, b) => {
        const pa = a.ccas?.[0]?.portfolio?.name || ''
        const pb = b.ccas?.[0]?.portfolio?.name || ''
        if (pa !== pb) return pa.localeCompare(pb)
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [allMembers])

  const filtered = useMemo(() => {
    if (!search.trim()) return treasurers
    const q = search.toLowerCase()
    return treasurers.filter(
      (m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.ccas || []).some((c) => c.name.toLowerCase().includes(q))
    )
  }, [treasurers, search])

  const portfolioGroups = useMemo(() => {
    const map = {}
    filtered.forEach((m) => {
      const portfolio = m.ccas?.[0]?.portfolio?.name || 'No Portfolio'
      if (!map[portfolio]) map[portfolio] = []
      map[portfolio].push(m)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <p className="text-center text-red-500 py-12 text-sm">Failed to load treasurers.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-bold text-gray-900">CCA Treasurers</h1>
        <span className="ml-auto text-xs text-gray-400">{treasurers.length} total</span>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or CCA…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">
          {search ? 'No results for that search.' : 'No CCA Treasurers found.'}
        </div>
      ) : (
        <div className="space-y-4">
          {portfolioGroups.map(([portfolio, members]) => (
            <div key={portfolio}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
                {portfolio}
              </p>
              <div className="space-y-3">
                {members.map((member) => (
                  <TreasurerRow
                    key={member.id}
                    member={member}
                    allCcas={allCcas}
                    updateMutation={updateMutation}
                    removeMutation={removeMutation}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
