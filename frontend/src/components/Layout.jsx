import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useIsDirector, useIsTreasurer } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'
import AppDrawer from './AppDrawer'
import DirectorTestingBar from './DirectorTestingBar'
import {
  IconHome, IconPlus, IconUsers, IconChat, IconMail, IconHelp, IconBookOpen,
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
  '/identifiers': 'CCA Treasurers',
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
    label: 'People & Support',
    items: [
      { to: '/cca-treasurers', label: 'CCA Treasurers', icon: <IconUsers /> },
      { to: '/contact', label: 'Contact', icon: <IconChat /> },
      { to: '/help-inbox', label: 'Help Inbox', icon: <IconMail /> },
      { to: '/pending-registrations', label: 'Approvals', icon: <IconUserCheck />, badge: true },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/analytics', label: 'Analytics', icon: <IconBarChart /> },
      { to: '/team', label: 'Finance Team', icon: <IconShield /> },
      { to: '/ccas', label: 'Portfolios & CCAs', icon: <IconLayers /> },
      { to: '/settings', label: 'Settings', icon: <IconSettings /> },
      { to: '/system-status', label: 'System Status', icon: <IconAlertTriangle /> },
    ],
  },
  {
    label: 'Reference',
    items: [
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
    label: 'People & Support',
    items: [
      { to: '/identifiers', label: 'CCA Treasurers', icon: <IconUsers /> },
      { to: '/contact', label: 'Contact', icon: <IconChat /> },
      { to: '/help-inbox', label: 'Help Inbox', icon: <IconMail /> },
    ],
  },
  {
    label: 'Reference',
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

const DIRECTOR_BOTTOM_NAV = [
  { to: '/', label: 'Claims', icon: 'receipt_long', end: true, matches: ['/'] },
  { to: '/claims/new', label: 'New', icon: 'add_circle', matches: ['/claims/new'] },
  { to: '/pending-registrations', label: 'Review', icon: 'fact_check', matches: ['/pending-registrations'] },
  { to: '/analytics', label: 'Admin', icon: 'admin_panel_settings', matches: ['/analytics', '/team', '/settings', '/ccas', '/system-status', '/reimbursements'] },
]

const MEMBER_BOTTOM_NAV = [
  { to: '/', label: 'Claims', icon: 'receipt_long', end: true, matches: ['/'] },
  { to: '/claims/new', label: 'New', icon: 'add_circle', matches: ['/claims/new'] },
  { to: '/help-inbox', label: 'Support', icon: 'mark_email_unread', matches: ['/help-inbox', '/contact'] },
  { to: '/sop', label: 'SOP', icon: 'menu_book', matches: ['/sop'] },
]

const TREASURER_BOTTOM_NAV = [
  { to: '/', label: 'Claims', icon: 'receipt_long', end: true, matches: ['/'] },
  { to: '/claims/new', label: 'New', icon: 'add_circle', matches: ['/claims/new'] },
  { to: '/help', label: 'Help', icon: 'help', matches: ['/help'] },
  { to: '/sop', label: 'SOP', icon: 'menu_book', matches: ['/sop'] },
]

function getInitials(name) {
  return (name || 'FC')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'FC'
}

function isBottomNavItemActive(pathname, item) {
  if (item.end) return pathname === item.to
  return item.matches.some((match) => pathname === match || pathname.startsWith(match))
}

function BottomNavigation({ items, pathname, pendingCount }) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const active = isBottomNavItemActive(pathname, item)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={`bottom-nav-link ${active ? 'bottom-nav-link-active' : ''}`}
          >
            <span className={`material-symbols-outlined ${active ? 'material-symbols-filled' : ''}`}>
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.label === 'Review' && pendingCount > 0 && (
              <span className="absolute ml-8 mt-[-2.25rem] flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold leading-none text-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

export default function Layout() {
  const { user } = useAuth()
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
  const bottomNav = isDirector ? DIRECTOR_BOTTOM_NAV : isTreasurer ? TREASURER_BOTTOM_NAV : MEMBER_BOTTOM_NAV
  const showFab = location.pathname !== '/claims/new'

  return (
    <div className="app-shell flex flex-col h-screen">
      <header className="app-header fixed top-0 left-0 right-0 z-20 flex h-14 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="finance-logo">
            <span className="material-symbols-outlined material-symbols-filled">account_balance_wallet</span>
          </span>
          <span className="finance-wordmark">Finance Hub</span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <span className="finance-page-title">{pageTitle}</span>
          <button
            onClick={() => setDrawerOpen(true)}
            className="finance-avatar relative active:scale-95"
            aria-label="Open menu"
          >
            {getInitials(user?.name)}
            {isDirector && pendingCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold leading-none text-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>
      <main className="app-main flex-1 overflow-y-auto pt-14">
        <DirectorTestingBar />
        <Outlet />
      </main>
      {showFab && (
        <NavLink to="/claims/new" className="bottom-nav-fab" aria-label="Create new claim">
          <span className="material-symbols-outlined text-[2rem]">add</span>
        </NavLink>
      )}
      <BottomNavigation items={bottomNav} pathname={location.pathname} pendingCount={pendingCount} />
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navGroups={navGroups}
        pendingCount={pendingCount}
      />
    </div>
  )
}
