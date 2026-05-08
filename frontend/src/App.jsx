import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import RegistrationPage from './pages/RegistrationPage'
import PendingApprovalPage from './pages/PendingApprovalPage'

const HomePage = lazy(() => import('./pages/HomePage'))
const NewClaimPage = lazy(() => import('./pages/NewClaimPage'))
const ClaimDetailPage = lazy(() => import('./pages/ClaimDetailPage'))
const IdentifierDataPage = lazy(() => import('./pages/IdentifierDataPage'))
const TreasurerHomePage = lazy(() => import('./pages/TreasurerHomePage'))
const PendingRegistrationsPage = lazy(() => import('./pages/PendingRegistrationsPage'))
const FinanceTeamPage = lazy(() => import('./pages/FinanceTeamPage'))
const CcaTreasurersPage = lazy(() => import('./pages/CcaTreasurersPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const ApprovalWizardPage = lazy(() => import('./pages/ApprovalWizardPage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SystemStatusPage = lazy(() => import('./pages/SystemStatusPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const HelpNewQuestionPage = lazy(() => import('./pages/HelpNewQuestionPage'))
const HelpQuestionDetailPage = lazy(() => import('./pages/HelpQuestionDetailPage'))
const HelpInboxPage = lazy(() => import('./pages/HelpInboxPage'))
const HelpInboxThreadPage = lazy(() => import('./pages/HelpInboxThreadPage'))
const CcasPage = lazy(() => import('./pages/CcasPage'))
const SopPage = lazy(() => import('./pages/SopPage'))

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
    <>
    <Analytics />
    <Suspense fallback={<LoadingScreen />}>
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
              <Route path="help" element={<HelpPage />} />
              <Route path="help/new" element={<HelpNewQuestionPage />} />
              <Route path="help/questions/:id" element={<HelpQuestionDetailPage />} />
            </>
          ) : (
            <>
              <Route index element={<HomePage />} />
              <Route path="claims/new" element={<NewClaimPage />} />
              <Route path="claims/:id" element={<ClaimDetailPage />} />
              <Route path="identifiers" element={<IdentifierDataPage />} />
              <Route path="contact" element={<ContactPage />} />
              <Route path="help-inbox" element={<HelpInboxPage />} />
              <Route path="help-inbox/:id" element={<HelpInboxThreadPage />} />
              {isDirector && (
                <>
                  <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                  <Route path="team" element={<FinanceTeamPage />} />
                  <Route path="cca-treasurers" element={<CcaTreasurersPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="ccas" element={<CcasPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="system-status" element={<SystemStatusPage />} />
                </>
              )}
            </>
          )}
          <Route path="sop" element={<SopPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
    </>
  )
}
