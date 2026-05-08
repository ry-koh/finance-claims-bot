import { NavLink } from 'react-router-dom'

function PendingBadge({ count }) {
  if (!count) return null
  return (
    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function AppDrawer({ open, onClose, navGroups, pendingCount = 0 }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-full w-3/4 max-w-xs bg-white z-40 shadow-xl transform transition-transform duration-200 flex flex-col ${
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
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 active:bg-gray-100'
                    }`
                  }
                >
                  <span className="w-5 h-5 shrink-0 text-gray-500">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <PendingBadge count={pendingCount} />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-gray-100 px-4 py-3">
          <p className="text-xs font-semibold text-gray-800">Ryan Koh Jun Hao</p>
          <p className="text-[11px] text-gray-400 mt-0.5">68th Finance Director, Raffles Hall</p>
          <div className="flex gap-3 mt-2">
            <a
              href="https://linkedin.com/in/ry-koh/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-600 font-medium hover:underline"
            >
              LinkedIn
            </a>
            <a
              href="https://t.me/ry_koh"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-500 font-medium hover:underline"
            >
              Telegram
            </a>
            <a
              href="https://github.com/ry-koh/finance-claims-bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-gray-500 font-medium hover:underline"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
