import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCompleteReimbursements, useReimbursementPreview } from '../api/claims'

function parseClaimIds(raw) {
  return (raw || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function formatAmount(amount) {
  if (amount == null) return 'SGD 0.00'
  return `SGD ${Number(amount).toFixed(2)}`
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-base font-bold text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}

function SkippedClaims({ skipped }) {
  if (!skipped?.length) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-bold text-amber-800">
        {skipped.length} claim{skipped.length === 1 ? '' : 's'} skipped
      </p>
      <div className="mt-2 space-y-1">
        {skipped.slice(0, 5).map((claim, idx) => (
          <p key={`${claim.id}-${idx}`} className="text-xs text-amber-700">
            {(claim.reference_code || claim.id || 'Unknown claim')} - {claim.reason}
          </p>
        ))}
        {skipped.length > 5 && (
          <p className="text-xs font-semibold text-amber-700">
            +{skipped.length - 5} more skipped
          </p>
        )}
      </div>
    </div>
  )
}

function PayeeCard({ group, paid, copiedPhone, onToggle, onCopyPhone, onOpenClaim }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${
      paid ? 'border-teal-200 bg-teal-50' : 'border-gray-100 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <label className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={paid}
            onChange={onToggle}
            className="mt-0.5 h-5 w-5 rounded border-gray-300 text-teal-600"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-gray-900">{group.name}</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {group.payee_type === 'one_off' ? 'One-off payee' : 'Registered treasurer'}
            </span>
          </span>
        </label>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-gray-900">{formatAmount(group.total_amount)}</p>
          <p className="text-[11px] font-semibold text-gray-400">
            {group.claim_count} claim{group.claim_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <span className="font-semibold text-gray-400">Phone</span>
          {group.phone_number ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-gray-700">{group.phone_number}</span>
              <button
                onClick={onCopyPhone}
                className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-600"
              >
                {copiedPhone === group.phone_number ? 'Copied' : 'Copy'}
              </button>
            </span>
          ) : (
            <span className="font-semibold text-red-500">Missing</span>
          )}
        </div>
        {group.email && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-semibold text-gray-400">Email</span>
            <span className="min-w-0 truncate text-right font-semibold text-gray-600">{group.email}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <span className="font-semibold text-gray-400">Bot</span>
          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
            group.telegram_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {group.telegram_id ? 'Will send' : 'No Telegram'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {group.claims.map((claim) => (
          <button
            key={claim.id}
            onClick={() => onOpenClaim(claim.id)}
            className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700"
          >
            {claim.reference_code || claim.id.slice(0, 8)} - {formatAmount(claim.amount)}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ReimbursementProcessPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const claimIds = useMemo(() => parseClaimIds(searchParams.get('claim_ids')), [searchKey, searchParams])
  const idsKey = claimIds.join(',')

  const { data, isLoading, isError, refetch } = useReimbursementPreview(claimIds)
  const completeMutation = useCompleteReimbursements()

  const [paidGroups, setPaidGroups] = useState({})
  const [copiedPhone, setCopiedPhone] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    setPaidGroups({})
    setCopiedPhone('')
    setConfirmOpen(false)
    setResult(null)
  }, [idsKey])

  const groups = data?.groups ?? []
  const allPaid = groups.length > 0 && groups.every((group) => paidGroups[group.key])
  const missingPhoneCount = groups.filter((group) => !group.phone_number).length

  function toggleGroup(key) {
    setPaidGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function markAllPaid() {
    setPaidGroups(Object.fromEntries(groups.map((group) => [group.key, true])))
  }

  async function copyPhone(phone) {
    if (!phone || !navigator?.clipboard) return
    await navigator.clipboard.writeText(phone)
    setCopiedPhone(phone)
    window.setTimeout(() => setCopiedPhone(''), 1500)
  }

  async function completeRun() {
    const response = await completeMutation.mutateAsync({ claim_ids: claimIds })
    setResult(response)
    setConfirmOpen(false)
  }

  if (claimIds.length === 0) {
    return (
      <div className="min-h-full bg-gray-50 px-4 py-5">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">Reimbursement Process</h1>
          <p className="mt-2 text-sm text-gray-500">
            Select submitted claims from the Claims page, then tap Reimburse Process.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Go to Claims
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gray-50 pb-28">
      <div className="border-b border-gray-100 bg-white px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Reimbursement Process</h1>
            <p className="text-xs text-gray-500">PayLah checklist grouped by claimer.</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600"
          >
            Back
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Payees" value={data?.total_payees ?? '-'} />
          <Stat label="Claims" value={data?.total_claims ?? '-'} />
          <Stat label="Total" value={data ? formatAmount(data.total_amount) : '-'} />
          <Stat label="Bot Messages" value={data?.notifiable_payees ?? '-'} />
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-100 bg-white p-5 text-center shadow-sm">
            <p className="text-sm font-semibold text-red-600">Could not load reimbursement preview.</p>
            <button onClick={() => refetch()} className="mt-3 text-sm font-semibold text-blue-600">
              Try again
            </button>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <SkippedClaims skipped={data?.skipped} />

            {missingPhoneCount > 0 && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <p className="text-sm font-bold text-red-700">
                  {missingPhoneCount} payee{missingPhoneCount === 1 ? '' : 's'} missing phone numbers
                </p>
                <p className="mt-1 text-xs text-red-600">
                  You can still complete the run, but those rows need manual payment details.
                </p>
              </div>
            )}

            {groups.length === 0 ? (
              <div className="rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm">
                <p className="text-sm font-semibold text-gray-700">No submitted claims to reimburse.</p>
                <p className="mt-1 text-xs text-gray-500">Only claims in Submitted status appear in this process.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => (
                  <PayeeCard
                    key={group.key}
                    group={group}
                    paid={!!paidGroups[group.key]}
                    copiedPhone={copiedPhone}
                    onToggle={() => toggleGroup(group.key)}
                    onCopyPhone={() => copyPhone(group.phone_number)}
                    onOpenClaim={(claimId) => navigate(`/claims/${claimId}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3 shadow-lg">
        {result ? (
          <div className="space-y-2">
            <p className="text-sm font-bold text-gray-900">
              Reimbursed {result.updated} claim{result.updated === 1 ? '' : 's'}.
            </p>
            <p className="text-xs text-gray-500">
              Bot messages sent: {result.messages_sent}. Skipped/no Telegram: {result.messages_skipped}.
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white"
            >
              Back to Claims
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              disabled={groups.length === 0 || completeMutation.isPending}
              onClick={markAllPaid}
              className="shrink-0 rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-600 disabled:opacity-40"
            >
              Mark All Paid
            </button>
            <button
              disabled={!allPaid || completeMutation.isPending}
              onClick={() => setConfirmOpen(true)}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white disabled:bg-teal-300"
            >
              {completeMutation.isPending ? 'Completing...' : 'Reimbursed All'}
            </button>
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="mx-4 mb-4 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900">Complete reimbursement?</h2>
            <p className="mt-2 text-sm text-gray-500">
              This will mark {data?.total_claims ?? 0} submitted claim{data?.total_claims === 1 ? '' : 's'} as
              reimbursed and send grouped Telegram messages where possible.
            </p>
            {completeMutation.isError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                Could not complete reimbursement. Please try again.
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={completeRun}
                disabled={completeMutation.isPending}
                className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white disabled:bg-teal-300"
              >
                {completeMutation.isPending ? 'Sending...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
