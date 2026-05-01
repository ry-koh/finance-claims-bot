import { Outlet, NavLink } from 'react-router-dom'

export default function Layout() {
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
        <NavLink to="/identifiers" className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
        }>
          <span className="text-xl">👥</span>
          <span>Identifiers</span>
        </NavLink>
      </nav>
    </div>
  )
}
