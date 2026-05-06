import { Outlet, NavLink } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'

function PendingBadge() {
  const { data: count = 0 } = usePendingCount()
  if (!count) return null
  return (
    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

function DirectorNav() {
  return (
    <>
      <NavLink to="/pending-registrations" className={({ isActive }) =>
        `flex-1 flex flex-col items-center py-2 text-xs relative ${isActive ? 'text-blue-600' : 'text-gray-500'}`
      }>
        <span className="relative inline-block text-xl">
          👤
          <PendingBadge />
        </span>
        <span>Approvals</span>
      </NavLink>
      <NavLink to="/analytics" className={({ isActive }) =>
        `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
      }>
        <span className="text-xl">📊</span>
        <span>Analytics</span>
      </NavLink>
    </>
  )
}

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 flex">
        <NavLink to="/" end className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">🏠</span>
          <span>Home</span>
        </NavLink>
        <NavLink to="/claims/new" className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">➕</span>
          <span>New Claim</span>
        </NavLink>
        {!isTreasurer && (
          <NavLink to="/identifiers" className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }>
            <span className="text-xl">👥</span>
            <span>Identifiers</span>
          </NavLink>
        )}
        {isDirector && <DirectorNav />}
      </nav>
    </div>
  )
}
