import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import NewClaimPage from './pages/NewClaimPage'
import ClaimDetailPage from './pages/ClaimDetailPage'
import IdentifierDataPage from './pages/IdentifierDataPage'
import RegistrationPage from './pages/RegistrationPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import TreasurerHomePage from './pages/TreasurerHomePage'
import PendingRegistrationsPage from './pages/PendingRegistrationsPage'
import FinanceTeamPage from './pages/FinanceTeamPage'
import CcaTreasurersPage from './pages/CcaTreasurersPage'
import AnalyticsPage from './pages/AnalyticsPage'
import ApprovalWizardPage from './pages/ApprovalWizardPage'
import ContactPage from './pages/ContactPage'
import SettingsPage from './pages/SettingsPage'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorScreen({ onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
      <p className="text-gray-500 text-sm">The server is busy. Please try again in a moment.</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg active:bg-blue-700"
      >
        Retry
      </button>
    </div>
  )
}

export default function App() {
  const { user, retryAuth } = useAuth()

  if (user === undefined) return <LoadingScreen />
  if (user.status === 'error') return <ErrorScreen onRetry={retryAuth} />
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <Routes>
      {!isTreasurer && (
        <Route path="/claims/:id/approve" element={<ApprovalWizardPage />} />
      )}
      <Route path="/" element={<Layout />}>
        {isTreasurer ? (
          <>
            <Route index element={<TreasurerHomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
          </>
        ) : (
          <>
            <Route index element={<HomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
            <Route path="identifiers" element={<IdentifierDataPage />} />
            <Route path="contact" element={<ContactPage />} />
            {isDirector && (
              <>
                <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                <Route path="team" element={<FinanceTeamPage />} />
                <Route path="cca-treasurers" element={<CcaTreasurersPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </>
            )}
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
