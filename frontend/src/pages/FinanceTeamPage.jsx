import { useState } from 'react'
import { useTeamMembers, useUpdateTeamMember, useRemoveTeamMember } from '../api/admin'

function RoleBadge({ role }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
      {role === 'director' ? 'Finance Director' : 'Finance Member'}
    </span>
  )
}

function MemberRow({ member, updateMutation, removeMutation }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(member.name || '')
  const [editEmail, setEditEmail] = useState(member.email || '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rowError, setRowError] = useState(null)

  function openEdit() {
    setEditName(member.name || '')
    setEditEmail(member.email || '')
    setRowError(null)
    setEditing(true)
  }

  function handleSave() {
    setRowError(null)
    updateMutation.mutate(
      { id: member.id, role: member.role, cca_ids: [], name: editName.trim() || undefined, email: editEmail.trim() || undefined },
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

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
        </div>
        <RoleBadge role={member.role} />
      </div>

      {rowError && <p className="text-xs text-red-600 mb-2">{rowError}</p>}

      {!editing && !confirmRemove && member.role !== 'director' && (
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
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!editName.trim() || isSaving}
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

export default function FinanceTeamPage() {
  const { data: allMembers = [], isLoading, isError } = useTeamMembers()
  const updateMutation = useUpdateTeamMember()
  const removeMutation = useRemoveTeamMember()

  const members = allMembers.filter((m) => m.role === 'director' || m.role === 'member')
  const sorted = [
    ...members.filter((m) => m.role === 'director'),
    ...members.filter((m) => m.role === 'member').sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  ]

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
        <p className="text-center text-red-500 py-12 text-sm">Failed to load team members.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-bold text-gray-900">Finance Team</h1>
        <span className="ml-auto text-xs text-gray-400">{sorted.length} member{sorted.length !== 1 ? 's' : ''}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No team members</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              updateMutation={updateMutation}
              removeMutation={removeMutation}
            />
          ))}
        </div>
      )}
    </div>
  )
}
