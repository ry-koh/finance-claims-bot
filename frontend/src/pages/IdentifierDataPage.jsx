import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

function fetchTreasurers() {
  return api.get('/admin/treasurers').then((r) => r.data)
}

function TreasurerRow({ member }) {
  const ccaNames = (member.ccas || []).map((c) => c.name).join(', ')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
          {ccaNames && <p className="text-xs text-gray-500">{ccaNames}</p>}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap mt-1">
        {member.matric_number ? (
          <span className="text-xs text-gray-600">{member.matric_number}</span>
        ) : (
          <span className="text-xs text-gray-400 italic">No matric no.</span>
        )}
        {member.phone_number ? (
          <span className="text-xs text-gray-600">{member.phone_number}</span>
        ) : (
          <span className="text-xs text-gray-400 italic">No phone</span>
        )}
        {member.email && <span className="text-xs text-gray-500 truncate">{member.email}</span>}
      </div>
      {member.telegram_username && (
        <p className="mt-1 text-xs text-gray-400">@{member.telegram_username}</p>
      )}
    </div>
  )
}

export default function IdentifierDataPage() {
  const [search, setSearch] = useState('')

  const { data: treasurers, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'treasurers'],
    queryFn: fetchTreasurers,
  })

  const grouped = useMemo(() => {
    if (!treasurers?.length) return {}
    const q = search.toLowerCase()
    const filtered = search
      ? treasurers.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.matric_number || '').toLowerCase().includes(q) ||
            (t.ccas || []).some((c) => c.name.toLowerCase().includes(q))
        )
      : treasurers
    const result = {}
    filtered.forEach((t) => {
      const ccas = t.ccas || []
      if (ccas.length === 0) {
        const key = 'Unassigned'
        result[key] = result[key] || []
        result[key].push(t)
      } else {
        ccas.forEach((cca) => {
          const key = cca.name
          result[key] = result[key] || []
          result[key].push(t)
        })
      }
    })
    return result
  }, [treasurers, search])

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white px-4 py-3 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">CCA Treasurers</h1>
      </div>

      <div className="px-4 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, matric, or CCA…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {isLoading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
        {isError && <p className="text-sm text-red-600 text-center py-8">Failed to load: {error?.message}</p>}
        {!isLoading && !isError && Object.keys(grouped).length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            {search ? 'No treasurers match your search.' : 'No treasurers found.'}
          </p>
        )}
        {Object.entries(grouped).map(([ccaName, members]) => (
          <div key={ccaName}>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{ccaName}</p>
            <div className="space-y-2">
              {members.map((m) => (
                <TreasurerRow key={m.id} member={m} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
