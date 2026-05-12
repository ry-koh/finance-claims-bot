import { useState } from 'react'
import { useUpdateTestingMode } from '../api/settings'
import { useAuth } from '../context/AuthContext'

const ROLE_OPTIONS = [
  { value: 'director', label: 'Director' },
  { value: 'member', label: 'Finance Team' },
  { value: 'treasurer', label: 'CCA Treasurer' },
]

export default function DirectorTestingBar() {
  const {
    actualUser,
    testingMode,
    previewRole,
    setPreviewRole,
    refreshTestingMode,
  } = useAuth()
  const updateMode = useUpdateTestingMode()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (actualUser?.role !== 'director' || !testingMode?.enabled) return null

  async function handleDisable() {
    setSaving(true)
    setError('')
    try {
      await updateMode.mutateAsync({ enabled: false, message: testingMode.message })
      setPreviewRole('director')
      await refreshTestingMode()
    } catch {
      setError('Could not turn off testing mode.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sticky top-0 z-10 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide">Testing mode is on</p>
          <p className="mt-0.5 text-xs text-amber-800">
            CCA treasurers and finance team members see the downtime screen. Your view switch is a UI preview.
          </p>
          {error && <p className="mt-1 text-xs font-semibold text-red-700">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="grid grid-cols-3 rounded-lg border border-amber-200 bg-white p-1">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreviewRole(option.value)}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                  previewRole === option.value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 active:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={saving}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-50"
          >
            {saving ? 'Turning off...' : 'Turn Off Testing'}
          </button>
        </div>
      </div>
    </div>
  )
}
