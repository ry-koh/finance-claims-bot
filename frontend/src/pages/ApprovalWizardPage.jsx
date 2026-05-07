import { useState, useEffect } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useClaim } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'

// ─── sessionStorage helpers ───────────────────────────────────────────────────

const STORAGE_KEY = (claimId) => `approval_${claimId}`

function initSelections(claim) {
  const lineItemMap = Object.fromEntries(
    (claim.line_items ?? []).map((li) => [li.id, li])
  )
  const selections = {}
  for (const r of claim.receipts ?? []) {
    const li = r.line_item_id ? lineItemMap[r.line_item_id] : null
    selections[r.id] = {
      category: li?.category ?? '',
      gst_code: li?.gst_code ?? 'IE',
      dr_cr: li?.dr_cr ?? 'DR',
      remark: '',
    }
  }
  return selections
}

function loadDraft(claimId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(claimId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(claimId, state) {
  try {
    sessionStorage.setItem(STORAGE_KEY(claimId), JSON.stringify(state))
  } catch {}
}

export function clearDraft(claimId) {
  sessionStorage.removeItem(STORAGE_KEY(claimId))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ApprovalWizardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: claim, isLoading } = useClaim(id)

  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState({})
  const [initialized, setInitialized] = useState(false)

  // Restore or init draft once claim loads
  useEffect(() => {
    if (!claim || initialized) return
    const draft = loadDraft(id)
    if (draft) {
      setStep(draft.step)
      setSelections(draft.selections)
    } else {
      setSelections(initSelections(claim))
    }
    setInitialized(true)
  }, [claim, id, initialized])

  // Persist on every change
  useEffect(() => {
    if (!initialized) return
    saveDraft(id, { step, selections })
  }, [step, selections, id, initialized])

  function updateSelection(receiptId, patch) {
    setSelections((prev) => ({
      ...prev,
      [receiptId]: { ...prev[receiptId], ...patch },
    }))
  }

  if (!isFinanceTeam) return <Navigate to="/" replace />

  if (isLoading || !claim || !initialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const receipts = claim.receipts ?? []
  const bankTransactions = claim.bank_transactions ?? []
  const totalSteps = receipts.length

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <p className="p-4 text-sm text-gray-500">
        Step {step} of {totalSteps} — {claim.reference_code}
      </p>
    </div>
  )
}
