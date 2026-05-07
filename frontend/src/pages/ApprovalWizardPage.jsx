import { useParams, useNavigate } from 'react-router-dom'
import { useClaim } from '../api/claims'
import { useIsFinanceTeam } from '../context/AuthContext'

export default function ApprovalWizardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFinanceTeam = useIsFinanceTeam()
  const { data: claim, isLoading } = useClaim(id)

  if (!isFinanceTeam) {
    navigate('/', { replace: true })
    return null
  }

  if (isLoading || !claim) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <p className="p-4 text-sm text-gray-500">Approval wizard — {claim.reference_code}</p>
    </div>
  )
}
