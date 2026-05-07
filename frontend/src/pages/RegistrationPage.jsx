import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { register } from '../api/auth'
import { usePublicCcas } from '../api/portfolios'

export default function RegistrationPage() {
  const { setUser } = useAuth()
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [telegramUsername, setTelegramUsername] = useState(
    () => window?.Telegram?.WebApp?.initDataUnsafe?.user?.username ?? ''
  )
  const [selectedCcaIds, setSelectedCcaIds] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: allCcas = [] } = usePublicCcas()

  function toggleCca(id) {
    setSelectedCcaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        cca_ids: role === 'treasurer' ? selectedCcaIds : [],
        telegram_username: telegramUsername.trim().replace(/^@/, ''),
      })
      setUser(result)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    !submitting &&
    role &&
    name.trim() &&
    email.trim() &&
    (role !== 'treasurer' || selectedCcaIds.length > 0)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Welcome</h1>
        <p className="text-sm text-gray-500 mb-6">Register to access the Finance Claims app</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">I am a</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'treasurer', label: 'CCA Treasurer' },
                { value: 'member', label: 'Finance Member' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors ${
                    role === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {role && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Your full name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                  {role === 'member' && (
                    <span className="text-gray-400 font-normal ml-1">(@u.nus.edu)</span>
                  )}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={role === 'member' ? 'eXXXXXXX@u.nus.edu' : 'your@email.com'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Telegram Username
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-300">
                  <span className="px-3 text-gray-400 text-sm bg-gray-50 border-r border-gray-300 py-2">@</span>
                  <input
                    type="text"
                    value={telegramUsername}
                    onChange={(e) => setTelegramUsername(e.target.value.replace(/^@/, ''))}
                    className="flex-1 px-3 py-2 text-sm focus:outline-none"
                    placeholder="your_username"
                  />
                </div>
              </div>

              {role === 'treasurer' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Your CCA(s) <span className="text-red-500">*</span>
                  </label>
                  <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
                    {allCcas.map((cca) => (
                      <label
                        key={cca.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCcaIds.includes(cca.id)}
                          onChange={() => toggleCca(cca.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-800">{cca.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{cca.portfolio?.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit Registration'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
