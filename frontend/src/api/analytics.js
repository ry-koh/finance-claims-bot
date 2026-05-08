import { useQuery } from '@tanstack/react-query'
import api from './client'

export const fetchAnalyticsSummary = ({ groupBy, statuses, dateFrom, dateTo }) => {
  const params = new URLSearchParams()
  params.set('group_by', groupBy)
  if (statuses?.length) statuses.forEach((s) => params.append('status', s))
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  return api.get(`/analytics/summary?${params}`).then((r) => r.data)
}

export function useAnalyticsSummary({ groupBy, statuses, dateFrom, dateTo, enabled = true }) {
  return useQuery({
    queryKey: ['analytics', 'summary', groupBy, statuses, dateFrom, dateTo],
    queryFn: () => fetchAnalyticsSummary({ groupBy, statuses, dateFrom, dateTo }),
    staleTime: 60_000,
    enabled: enabled && !!groupBy,
  })
}

export const fetchAnalyticsFundBreakdown = ({ groupBy, statuses, dateFrom, dateTo }) => {
  const params = new URLSearchParams()
  params.set('group_by', groupBy)
  if (statuses?.length) statuses.forEach((s) => params.append('status', s))
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  return api.get(`/analytics/fund-breakdown?${params}`).then((r) => r.data)
}

export function useAnalyticsFundBreakdown({ groupBy, statuses, dateFrom, dateTo }) {
  return useQuery({
    queryKey: ['analytics', 'fund-breakdown', groupBy, statuses, dateFrom, dateTo],
    queryFn: () => fetchAnalyticsFundBreakdown({ groupBy, statuses, dateFrom, dateTo }),
    staleTime: 60_000,
    enabled: !!groupBy,
  })
}
