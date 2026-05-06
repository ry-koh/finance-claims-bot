import { useNavigate } from 'react-router-dom'
import {
  usePendingRegistrations,
  useApproveRegistration,
  useRejectRegistration,
} from '../api/admin'

export default function PendingRegistrationsPage() {
  const navigate = useNavigate()
  const { data: pending = [], isLoading, isError } = usePendingRegistrations()
  const approve = useApproveRegistration()
  const reject = useRejectRegistration()

  const mutationError = approve.error || reject.error

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
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => navigate('/')} className="text-blue-600 text-sm">← Back</button>
          <h1 className="text-lg font-bold text-gray-900">Pending Registrations</h1>
        </div>
        <div className="text-center text-red-500 py-12 text-sm">
          Failed to load pending registrations. Please try again.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/')} className="text-blue-600 text-sm">← Back</button>
        <h1 className="text-lg font-bold text-gray-900">Pending Registrations</h1>
      </div>

      {mutationError && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          Action failed — please try again.
        </div>
      )}

      {pending.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No pending registrations</div>
      ) : (
        <div className="space-y-3">
          {pending.map((member) => {
            const isThisApproving = approve.isPending && approve.variables === member.id
            const isThisRejecting = reject.isPending && reject.variables === member.id
            const anyPending = approve.isPending || reject.isPending

            return (
              <div
                key={member.id}
                className={`bg-white rounded-xl border border-gray-100 shadow-sm p-4 transition-opacity ${
                  anyPending && !isThisApproving && !isThisRejecting ? 'opacity-50' : ''
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-500">{member.email}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    member.role === 'treasurer'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {member.role === 'treasurer' ? 'CCA Treasurer' : 'Finance Member'}
                  </span>
                </div>

                {member.role === 'treasurer' && member.ccas?.length > 0 && (
                  <p className="text-xs text-gray-500 mb-3">
                    CCAs: {member.ccas.map((c) => c.name).join(', ')}
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => approve.mutate(member.id)}
                    disabled={anyPending}
                    className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {isThisApproving && (
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => reject.mutate(member.id)}
                    disabled={anyPending}
                    className="flex-1 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {isThisRejecting && (
                      <span className="w-3 h-3 border-2 border-red-700 border-t-transparent rounded-full animate-spin" />
                    )}
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
