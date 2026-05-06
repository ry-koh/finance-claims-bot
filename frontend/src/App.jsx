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
import TeamPage from './pages/TeamPage'
import AnalyticsPage from './pages/AnalyticsPage'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const { user } = useAuth()

  if (user === undefined) return <LoadingScreen />
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <Routes>
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
            {isDirector && (
              <>
                <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                <Route path="team" element={<TeamPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
              </>
            )}
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
