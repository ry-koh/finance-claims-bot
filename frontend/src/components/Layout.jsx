import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import DirectorDrawer from './DirectorDrawer'

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
}

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/claims/') ? 'Claim' : 'Home')

  if (isDirector) {
    return (
      <div className="flex flex-col h-screen">
        <header className="fixed top-0 left-0 right-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-2xl text-gray-700 p-1 -ml-1"
            aria-label="Open menu"
          >
            ☰
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
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">🏠</span>
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/claims/new"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">➕</span>
          <span>New Claim</span>
        </NavLink>
        {!isTreasurer && (
          <NavLink
            to="/identifiers"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }
          >
            <span className="text-xl">👥</span>
            <span>Identifiers</span>
          </NavLink>
        )}
        {!isTreasurer && (
          <NavLink
            to="/contact"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }
          >
            <span className="text-xl">💬</span>
            <span>Contact</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}
