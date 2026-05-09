import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import RegistrationPage from './pages/RegistrationPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import { Button, Card } from './components/ui'

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
const ReimbursementProcessPage = lazy(() => import('./pages/ReimbursementProcessPage'))
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
    <div className="app-shell flex items-center justify-center h-screen p-4">
      <Card className="flex w-full max-w-xs flex-col items-center gap-3 p-6">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-semibold text-gray-500">Loading workspace</p>
      </Card>
    </div>
  )
}

function ErrorScreen({ onRetry, message }) {
  return (
    <div className="app-shell flex flex-col items-center justify-center h-screen px-6 text-center">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-2 text-base font-bold text-gray-900">Connection interrupted</h1>
        <p className="mb-4 text-gray-500 text-sm">{message || 'The server is busy. Please try again in a moment.'}</p>
        <Button onClick={onRetry} className="w-full">
          Retry
        </Button>
      </Card>
    </div>
  )
}

export default function App() {
  const { user, retryAuth } = useAuth()
  const [retryNotice, setRetryNotice] = useState(false)

  useEffect(() => {
    const onRetrying = () => {
      setRetryNotice(true)
      window.clearTimeout(window.__apiRetryNoticeTimer)
      window.__apiRetryNoticeTimer = window.setTimeout(() => setRetryNotice(false), 2500)
    }
    window.addEventListener('api:retrying', onRetrying)
    return () => window.removeEventListener('api:retrying', onRetrying)
  }, [])

  const retryBanner = retryNotice && (
    <div className="fixed left-4 right-4 top-4 z-50 rounded-xl bg-blue-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
      Server is waking up. Retrying...
    </div>
  )

  if (user === undefined) return <>{retryBanner}<LoadingScreen /></>
  if (user.status === 'error') return <>{retryBanner}<ErrorScreen onRetry={retryAuth} message={user.message} /></>
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <>
    {retryBanner}
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
                  <Route path="reimbursements" element={<ReimbursementProcessPage />} />
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
