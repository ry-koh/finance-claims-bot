import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTreasurers, useSendMessage } from '../api/messages'

function TreasurerCard({ treasurer }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const sendMut = useSendMessage()

  function handleSend() {
    if (!message.trim()) return
    setErr('')
    sendMut.mutate(
      { telegram_id: treasurer.telegram_id, message: message.trim() },
      {
        onSuccess: () => { setSent(true); setMessage('') },
        onError: (e) => {
          const detail = e?.response?.data?.detail
          setErr(typeof detail === 'string' ? detail : 'Failed to send. Please try again.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{treasurer.name}</p>
          {treasurer.telegram_username && (
            <p className="text-xs text-gray-400">@{treasurer.telegram_username}</p>
          )}
          {treasurer.ccas?.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {treasurer.ccas.map((c) => c.name).join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={() => { setOpen((o) => !o); setSent(false); setErr('') }}
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white active:bg-blue-700"
        >
          Message
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-gray-100 pt-3 flex flex-col gap-2">
          {sent ? (
            <p className="text-xs text-green-600 font-medium">Message sent to {treasurer.name}.</p>
          ) : (
            <>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder={`Message to ${treasurer.name}…`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              />
              {err && <p className="text-xs text-red-600">{err}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSend}
                  disabled={!message.trim() || sendMut.isPending}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {sendMut.isPending ? 'Sending…' : 'Send via Bot'}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  disabled={sendMut.isPending}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function ContactPage() {
  const navigate = useNavigate()
  const { data: treasurers = [], isLoading, isError } = useTreasurers()

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/')} className="text-blue-600 text-sm">← Back</button>
        <h1 className="text-lg font-bold text-gray-900">Contact Treasurers</h1>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Messages are sent to the treasurer's Telegram chat via the finance bot.
      </p>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {isError && (
        <p className="text-center text-red-500 py-12 text-sm">Failed to load treasurers.</p>
      )}
      {!isLoading && !isError && treasurers.length === 0 && (
        <p className="text-center text-gray-400 py-12 text-sm">No active treasurers found.</p>
      )}
      {!isLoading && !isError && treasurers.length > 0 && (
        <div className="space-y-3">
          {treasurers.map((t) => (
            <TreasurerCard key={t.id} treasurer={t} />
          ))}
        </div>
      )}
    </div>
  )
}
