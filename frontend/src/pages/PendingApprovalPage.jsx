import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateRegistration, getMe } from '../api/auth'
import { useAllCcas } from '../api/portfolios'

export default function PendingApprovalPage() {
  const { user, setUser } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [selectedCcaIds, setSelectedCcaIds] = useState(
    (user?.ccas || []).map((c) => c.id)
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: allCcas = [] } = useAllCcas()

  function toggleCca(id) {
    setSelectedCcaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await updateRegistration({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: user.role,
        cca_ids: user.role === 'treasurer' ? selectedCcaIds : [],
      })
      const updated = await getMe()
      setUser(updated)
      setEditing(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl">⏳</div>
          <div>
            <h1 className="text-base font-bold text-gray-900">Awaiting Approval</h1>
            <p className="text-xs text-gray-500">Your registration is being reviewed</p>
          </div>
        </div>

        {!editing ? (
          <>
            <div className="space-y-2 mb-4">
              <DetailRow label="Name" value={user?.name} />
              <DetailRow label="Email" value={user?.email} />
              <DetailRow
                label="Role"
                value={user?.role === 'treasurer' ? 'CCA Treasurer' : 'Finance Member'}
              />
              {user?.role === 'treasurer' && user?.ccas?.length > 0 && (
                <DetailRow label="CCA(s)" value={user.ccas.map((c) => c.name).join(', ')} />
              )}
            </div>
            <button
              onClick={() => setEditing(true)}
              className="w-full py-2 border border-gray-300 rounded-xl text-sm text-gray-600 font-medium"
            >
              Edit Registration
            </button>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Email{' '}
                {user?.role === 'member' && (
                  <span className="text-gray-400 font-normal">(@u.nus.edu)</span>
                )}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            {user?.role === 'treasurer' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CCA(s)</label>
                <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {allCcas.map((cca) => (
                    <label
                      key={cca.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCcaIds.includes(cca.id)}
                        onChange={() => toggleCca(cca.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{cca.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value || '—'}</span>
    </div>
  )
}
