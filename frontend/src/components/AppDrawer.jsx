import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

function PendingBadge({ count }) {
  if (!count) return null
  return (
    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

function ThemeModeToggle() {
  const { mode, resolvedTheme, setMode } = useTheme()
  const options = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Theme</p>
        <span className="text-[10px] font-semibold text-gray-400">
          {resolvedTheme === 'dark' ? 'Dark active' : 'Light active'}
        </span>
      </div>
      <div className="theme-toggle" role="group" aria-label="Theme mode">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-active={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function AppDrawer({ open, onClose, navGroups, pendingCount = 0 }) {
  const { user } = useAuth()
  const roleLabel = user?.role === 'director'
    ? 'Finance Director'
    : user?.role === 'member'
    ? 'Finance Team'
    : user?.role === 'treasurer'
    ? 'CCA Treasurer'
    : 'Finance Claims'

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`app-drawer fixed top-0 left-0 h-full w-3/4 max-w-xs z-40 transform transition-transform duration-200 flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-gray-100 shrink-0">
          <p className="font-bold text-gray-900 text-base">Menu</p>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-3 mb-1">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `drawer-nav-link flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 ${
                      isActive
                        ? 'drawer-nav-link-active'
                        : 'active:bg-gray-100'
                    }`
                  }
                >
                  <span className="w-5 h-5 shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <PendingBadge count={pendingCount} />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-gray-100 px-4 py-3 space-y-3">
          <ThemeModeToggle />
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="truncate text-xs font-bold text-gray-800">{user?.name || 'Finance Claims'}</p>
            <p className="mt-0.5 text-[11px] font-medium text-gray-500">{roleLabel}</p>
            {user?.email && (
              <p className="mt-1 truncate text-[11px] text-gray-400">{user.email}</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
