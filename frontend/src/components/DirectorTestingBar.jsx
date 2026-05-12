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
    <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] font-bold uppercase leading-none tracking-wide">Testing</p>
          {error && <p className="mt-0.5 max-w-[8rem] truncate text-[10px] font-semibold text-red-700">{error}</p>}
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-3 rounded-lg border border-amber-200 bg-white p-0.5">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreviewRole(option.value)}
              className={`truncate rounded-md px-1.5 py-1 text-[10px] font-bold transition ${
                previewRole === option.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 active:bg-gray-100'
              }`}
            >
              {option.value === 'treasurer' ? 'Treasurer' : option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleDisable}
          disabled={saving}
          className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[10px] font-bold text-amber-900 disabled:opacity-50"
        >
          {saving ? 'Off...' : 'Off'}
        </button>
      </div>
    </div>
  )
}
