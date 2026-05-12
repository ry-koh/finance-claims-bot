import { useState, useEffect } from 'react'
import { useSettings, useUpdateSettings } from '../api/settings'
import { useAuth } from '../context/AuthContext'

export default function SettingsPage() {
  const { data, isLoading } = useSettings()
  const updateMutation = useUpdateSettings()
  const { refreshTestingMode, setPreviewRole } = useAuth()

  const [academicYear, setAcademicYear] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [fdName, setFdName] = useState('')
  const [fdPhone, setFdPhone] = useState('')
  const [fdMatricNo, setFdMatricNo] = useState('')
  const [fdPersonalEmail, setFdPersonalEmail] = useState('')
  const [fdSalutation, setFdSalutation] = useState('')
  const [claimToEmail, setClaimToEmail] = useState('')
  const [claimCcEmail, setClaimCcEmail] = useState('')
  const [testingModeEnabled, setTestingModeEnabled] = useState(false)
  const [testingModeMessage, setTestingModeMessage] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setAcademicYear(data.academic_year || '')
      setAccountName(data.account_name || '')
      setAccountEmail(data.account_email || '')
      setFdName(data.fd_name || '')
      setFdPhone(data.fd_phone || '')
      setFdMatricNo(data.fd_matric_no || '')
      setFdPersonalEmail(data.fd_personal_email || data.fd_email || '')
      setFdSalutation(data.fd_salutation || '')
      setClaimToEmail(data.claim_to_email || '')
      setClaimCcEmail(data.claim_cc_email || '')
      setTestingModeEnabled(Boolean(data.testing_mode_enabled))
      setTestingModeMessage(data.testing_mode_message || 'The finance claims app is temporarily down for testing. Please check back later.')
    }
  }, [data])

  function handleSave(e) {
    e.preventDefault()
    updateMutation.mutate(
      {
        academic_year: academicYear,
        account_name: accountName,
        account_email: accountEmail,
        fd_name: fdName,
        fd_phone: fdPhone,
        fd_matric_no: fdMatricNo,
        fd_personal_email: fdPersonalEmail,
        fd_salutation: fdSalutation,
        claim_to_email: claimToEmail,
        claim_cc_email: claimCcEmail,
        testing_mode_enabled: testingModeEnabled,
        testing_mode_message: testingModeMessage,
      },
      {
        onSuccess: async () => {
          setSaved(true)
          if (!testingModeEnabled) setPreviewRole('director')
          await refreshTestingMode()
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
    <div className="mobile-page mx-auto min-h-full max-w-lg p-4">
      <div className="mb-4">
        <p className="section-eyebrow">Settings & Management</p>
        <h1 className="mt-1 text-xl font-bold leading-7 text-gray-900">Workspace controls</h1>
      </div>
      <form onSubmit={handleSave} className="space-y-4">

        <div className="ui-card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Academic Year</h2>
          <label className="block text-xs text-gray-500 mb-1">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="e.g. 2526"
            className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <p className="text-xs text-amber-600 mt-1">
            Changing the AY will reset the claim counter to 0001
          </p>
        </div>

        <div className="ui-card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Your App Identity</h2>
          <p className="text-xs text-gray-400 mb-3">Used for audit timeline names and your director account identity.</p>
          <label className="block text-xs text-gray-500 mb-1">Your Name</label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Ryan Koh Jun Hao"
            className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <label className="block text-xs text-gray-500 mb-1 mt-3">Your Personal / Account Email</label>
          <input
            type="email"
            value={accountEmail}
            onChange={(e) => setAccountEmail(e.target.value)}
            placeholder="e.g. e0596601@u.nus.edu"
            className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        <div className="ui-card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Testing Mode</h2>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={testingModeEnabled}
                onChange={(e) => setTestingModeEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Show downtime screen to users</span>
                <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                  CCA treasurers and finance team members will be blocked while Finance Director accounts stay open for testing.
                </span>
              </span>
            </label>
            <label className="mt-3 block text-xs text-gray-500">Downtime Message</label>
            <textarea
              value={testingModeMessage}
              onChange={(e) => setTestingModeMessage(e.target.value)}
              rows={3}
              className="toolbar-field mt-1 w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        <div className="ui-card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Claim Email Routing</h2>
          <p className="text-xs text-gray-400 mb-3">
            Used in the email block that treasurers copy and send after finance approves a claim.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Claim Submission To Email</label>
              <input
                type="email"
                value={claimToEmail}
                onChange={(e) => setClaimToEmail(e.target.value)}
                placeholder="e.g. rh.finance@u.nus.edu"
                className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <p className="text-xs text-gray-400 mt-1">Appears as the To line in claim submission emails.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Shared Finance Gmail / CC Email</label>
              <input
                type="email"
                value={claimCcEmail}
                onChange={(e) => setClaimCcEmail(e.target.value)}
                placeholder="e.g. 68findirector.rh@gmail.com"
                className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <p className="text-xs text-gray-400 mt-1">Appears as the default CC line in claim submission emails.</p>
            </div>
          </div>
        </div>

        <div className="ui-card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Document & Email Finance Director</h2>
          <p className="text-xs text-gray-400 mb-3">
            Used for generated document identity and email salutation. This can stay as the previous Finance Director until your handover is complete.
          </p>
          <div className="space-y-3">
            {[
              { label: 'Full Name', value: fdName, set: setFdName, type: 'text', placeholder: 'e.g. Goh Jun Kiat' },
              { label: 'Email Salutation', value: fdSalutation, set: setFdSalutation, type: 'text', placeholder: 'e.g. Jun Kiat' },
              { label: 'Phone Number', value: fdPhone, set: setFdPhone, type: 'text', placeholder: 'e.g. 91234567' },
              { label: 'Matric Number', value: fdMatricNo, set: setFdMatricNo, type: 'text', placeholder: 'e.g. A0123456B' },
              { label: 'FD Personal Email for Documents / Transport Form', value: fdPersonalEmail, set: setFdPersonalEmail, type: 'email', placeholder: 'e.g. E1337187@U.NUS.EDU' },
            ].map(({ label, value, set, type, placeholder }) => (
              <div key={label}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="toolbar-field w-full px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="ui-button ui-button-primary w-full disabled:opacity-50"
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
