import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const PENDING_KEYS = {
  all: ['pending-registrations'],
  count: ['pending-registrations', 'count'],
}

export const fetchPendingRegistrations = () =>
  api.get('/admin/pending-registrations').then((r) => r.data)

export const fetchPendingCount = () =>
  api.get('/admin/pending-registrations/count').then((r) => r.data.count)

export const approveRegistration = (memberId) =>
  api.post(`/admin/approve/${memberId}`).then((r) => r.data)

export const rejectRegistration = (memberId) =>
  api.delete(`/admin/reject/${memberId}`).then((r) => r.data)

export function usePendingRegistrations() {
  return useQuery({
    queryKey: PENDING_KEYS.all,
    queryFn: fetchPendingRegistrations,
  })
}

export function usePendingCount() {
  return useQuery({
    queryKey: PENDING_KEYS.count,
    queryFn: fetchPendingCount,
    refetchInterval: 60_000,
  })
}

export function useApproveRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: approveRegistration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all }),
    ...options,
  })
}

export function useRejectRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectRegistration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all }),
    ...options,
  })
}
