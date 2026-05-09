import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'
import AppDrawer from './AppDrawer'
import {
  IconHome, IconPlus, IconUsers, IconChat, IconMail, IconHelp, IconMenu, IconBookOpen,
  IconBarChart, IconUserCheck, IconShield, IconSettings, IconLayers, IconAlertTriangle,
} from './Icons'

const PAGE_TITLES = {
  '/': 'Home',
  '/claims/new': 'New Claim',
  '/analytics': 'Analytics',
  '/pending-registrations': 'Approvals',
  '/team': 'Finance Team',
  '/cca-treasurers': 'CCA Treasurers',
  '/reimbursements': 'Reimbursements',
  '/settings': 'Settings',
  '/contact': 'Contact',
  '/identifiers': 'Identifiers',
  '/help': 'Help',
  '/help/new': 'Ask a Question',
  '/help-inbox': 'Help Inbox',
  '/ccas': 'Portfolios & CCAs',
  '/system-status': 'System Status',
  '/sop': 'SOP',
}

const DIRECTOR_NAV = [
  {
    label: 'Claims',
    items: [
      { to: '/', label: 'Home', icon: <IconHome />, end: true },
      { to: '/claims/new', label: 'New Claim', icon: <IconPlus /> },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/analytics', label: 'Analytics', icon: <IconBarChart /> },
      { to: '/pending-registrations', label: 'Approvals', icon: <IconUserCheck />, badge: true },
      { to: '/help-inbox', label: 'Help Inbox', icon: <IconMail /> },
      { to: '/team', label: 'Finance Team', icon: <IconShield /> },
      { to: '/cca-treasurers', label: 'CCA Treasurers', icon: <IconUsers /> },
      { to: '/ccas', label: 'Portfolios & CCAs', icon: <IconLayers /> },
      { to: '/settings', label: 'Settings', icon: <IconSettings /> },
      { to: '/system-status', label: 'System Status', icon: <IconAlertTriangle /> },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/contact', label: 'Contact', icon: <IconChat /> },
      { to: '/sop', label: 'SOP', icon: <IconBookOpen /> },
    ],
  },
]

const MEMBER_NAV = [
  {
    label: 'Claims',
    items: [
      { to: '/', label: 'Home', icon: <IconHome />, end: true },
      { to: '/claims/new', label: 'New Claim', icon: <IconPlus /> },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/identifiers', label: 'Identifiers', icon: <IconUsers /> },
      { to: '/contact', label: 'Contact', icon: <IconChat /> },
      { to: '/help-inbox', label: 'Help Inbox', icon: <IconMail /> },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/sop', label: 'SOP', icon: <IconBookOpen /> },
    ],
  },
]

const TREASURER_NAV = [
  {
    label: 'Claims',
    items: [
      { to: '/', label: 'Home', icon: <IconHome />, end: true },
      { to: '/claims/new', label: 'New Claim', icon: <IconPlus /> },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/help', label: 'Help', icon: <IconHelp /> },
      { to: '/sop', label: 'SOP', icon: <IconBookOpen /> },
    ],
  },
]

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const { data: pendingCount = 0 } = usePendingCount(isDirector)

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/claims/') ? 'Claim' :
     location.pathname.startsWith('/help-inbox/') ? 'Question' :
     location.pathname.startsWith('/help/questions/') ? 'My Question' : 'Home')

  const navGroups = isDirector ? DIRECTOR_NAV : isTreasurer ? TREASURER_NAV : MEMBER_NAV

  return (
    <div className="app-shell flex flex-col h-screen">
      <header className="app-header fixed top-0 left-0 right-0 z-20 h-14 border-b flex items-center px-4 gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          className="relative text-gray-700 p-2 -ml-2 rounded-xl active:bg-gray-100"
          aria-label="Open menu"
        >
          <IconMenu className="w-5 h-5" />
          {isDirector && pendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </button>
        <span className="app-title font-semibold text-base">{pageTitle}</span>
      </header>
      <main className="app-main flex-1 overflow-y-auto pt-14">
        <Outlet />
      </main>
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navGroups={navGroups}
        pendingCount={pendingCount}
      />
    </div>
  )
}
