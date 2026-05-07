import { useState, useEffect } from 'react'
import { useSettings, useUpdateSettings } from '../api/settings'

export default function SettingsPage() {
  const { data, isLoading } = useSettings()
  const updateMutation = useUpdateSettings()

  const [academicYear, setAcademicYear] = useState('')
  const [fdName, setFdName] = useState('')
  const [fdPhone, setFdPhone] = useState('')
  const [fdMatricNo, setFdMatricNo] = useState('')
  const [fdEmail, setFdEmail] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setAcademicYear(data.academic_year || '')
      setFdName(data.fd_name || '')
      setFdPhone(data.fd_phone || '')
      setFdMatricNo(data.fd_matric_no || '')
      setFdEmail(data.fd_email || '')
    }
  }, [data])

  function handleSave(e) {
    e.preventDefault()
    updateMutation.mutate(
      {
        academic_year: academicYear,
        fd_name: fdName,
        fd_phone: fdPhone,
        fd_matric_no: fdMatricNo,
        fd_email: fdEmail,
      },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        },
      }
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-6">Settings</h1>
      <form onSubmit={handleSave} className="space-y-6">

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Academic Year</h2>
          <label className="block text-xs text-gray-500 mb-1">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="e.g. 2526"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <p className="text-xs text-amber-600 mt-1">
            Changing the AY will reset the claim counter to 0001
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Finance Director Profile</h2>
          <p className="text-xs text-gray-400 mb-3">Used in generated documents (Summary, RFP, Transport form)</p>
          <div className="space-y-3">
            {[
              { label: 'Full Name', value: fdName, set: setFdName, type: 'text', placeholder: 'e.g. Tan Wei Ming' },
              { label: 'Phone Number', value: fdPhone, set: setFdPhone, type: 'text', placeholder: 'e.g. 91234567' },
              { label: 'Matric Number', value: fdMatricNo, set: setFdMatricNo, type: 'text', placeholder: 'e.g. A0123456B' },
              { label: 'Personal Email', value: fdEmail, set: setFdEmail, type: 'email', placeholder: 'e.g. weiming@example.com' },
            ].map(({ label, value, set, type, placeholder }) => (
              <div key={label}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {updateMutation.isPending && (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

        {updateMutation.isError && (
          <p className="text-sm text-red-500 text-center mt-2">
            Failed to save settings. Please try again.
          </p>
        )}
      </form>
    </div>
  )
}
