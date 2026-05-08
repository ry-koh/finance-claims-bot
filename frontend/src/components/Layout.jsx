import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'
import DirectorDrawer from './DirectorDrawer'
import { IconHome, IconPlus, IconUsers, IconChat, IconMail, IconHelp, IconMenu, IconBookOpen } from './Icons'

const PAGE_TITLES = {
  '/': 'Home',
  '/claims/new': 'New Claim',
  '/analytics': 'Analytics',
  '/pending-registrations': 'Approvals',
  '/team': 'Finance Team',
  '/cca-treasurers': 'CCA Treasurers',
  '/settings': 'Settings',
  '/contact': 'Contact',
  '/identifiers': 'Identifiers',
  '/help': 'Help',
  '/help/new': 'Ask a Question',
  '/help-inbox': 'Help Inbox',
}

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const { data: pendingCount = 0 } = usePendingCount()

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/claims/') ? 'Claim' :
     location.pathname.startsWith('/help-inbox/') ? 'Question' :
     location.pathname.startsWith('/help/questions/') ? 'My Question' : 'Home')

  if (isDirector) {
    return (
      <div className="flex flex-col h-screen">
        <header className="fixed top-0 left-0 right-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative text-gray-700 p-1 -ml-1"
            aria-label="Open menu"
          >
            <IconMenu className="w-5 h-5" />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <span className="font-semibold text-gray-900 text-base">{pageTitle}</span>
        </header>
        <main className="flex-1 overflow-y-auto pt-14">
          <Outlet />
        </main>
        <DirectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 flex">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <IconHome className="w-5 h-5" />
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/claims/new"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <IconPlus className="w-5 h-5" />
          <span>New Claim</span>
        </NavLink>
        {isTreasurer ? (
          <>
            <NavLink
              to="/help"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconHelp className="w-5 h-5" />
              <span>Help</span>
            </NavLink>
            <NavLink
              to="/sop"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconBookOpen className="w-5 h-5" />
              <span>SOP</span>
            </NavLink>
          </>
        ) : (
          <>
            <NavLink
              to="/identifiers"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconUsers className="w-5 h-5" />
              <span>Identifiers</span>
            </NavLink>
            <NavLink
              to="/contact"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconChat className="w-5 h-5" />
              <span>Contact</span>
            </NavLink>
            <NavLink
              to="/help-inbox"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconMail className="w-5 h-5" />
              <span>Inbox</span>
            </NavLink>
            <NavLink
              to="/sop"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <IconBookOpen className="w-5 h-5" />
              <span>SOP</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
