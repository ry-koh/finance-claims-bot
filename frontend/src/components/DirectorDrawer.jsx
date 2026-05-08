import { NavLink } from 'react-router-dom'
import { usePendingCount } from '../api/admin'
import { IconHome, IconPlus, IconBarChart, IconUserCheck, IconMail, IconShield, IconUsers, IconSettings, IconChat } from './Icons'

const NAV_GROUPS = [
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
      { to: '/settings', label: 'Settings', icon: <IconSettings /> },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/contact', label: 'Contact', icon: <IconChat /> },
    ],
  },
]

function PendingBadge() {
  const { data: count = 0 } = usePendingCount()
  if (!count) return null
  return (
    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function DirectorDrawer({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-full w-3/4 max-w-xs bg-white z-40 shadow-xl transform transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="font-bold text-gray-900 text-base">Menu</p>
        </div>
        <nav className="p-3 overflow-y-auto h-[calc(100%-57px)]">
          {NAV_GROUPS.map((group) => (
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
                  {item.badge && <PendingBadge />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
