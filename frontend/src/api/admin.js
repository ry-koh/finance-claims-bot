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

export const fetchSystemStatus = () =>
  api.get('/admin/system-status').then((r) => r.data)

export const fetchStorageSummary = () =>
  api.get('/admin/storage-summary').then((r) => r.data)

export const backfillStorageSizes = ({ limit = 50 } = {}) =>
  api.post('/admin/storage-summary/backfill', null, { params: { limit } }).then((r) => r.data)

export function usePendingRegistrations() {
  return useQuery({
    queryKey: PENDING_KEYS.all,
    queryFn: fetchPendingRegistrations,
    refetchInterval: 30_000,
  })
}

export function usePendingCount(enabled = true) {
  return useQuery({
    queryKey: PENDING_KEYS.count,
    queryFn: fetchPendingCount,
    refetchInterval: 60_000,
    enabled,
  })
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['admin', 'system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 60_000,
  })
}

export function useStorageSummary() {
  return useQuery({
    queryKey: ['admin', 'storage-summary'],
    queryFn: fetchStorageSummary,
    refetchInterval: 60_000,
  })
}

export function useBackfillStorageSizes(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: backfillStorageSizes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storage-summary'] })
    },
    ...options,
  })
}

export function useApproveRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: approveRegistration,
    onSuccess: () => {
      // Invalidate list; prefix match also refreshes the count badge
      queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all })
      queryClient.invalidateQueries({ queryKey: PENDING_KEYS.count })
    },
    ...options,
  })
}

export function useRejectRegistration(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectRegistration,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_KEYS.all })
      queryClient.invalidateQueries({ queryKey: PENDING_KEYS.count })
    },
    ...options,
  })
}

export const TEAM_KEYS = {
  all: ['team'],
}

export const fetchTeamMembers = () =>
  api.get('/admin/team').then((r) => r.data)

export const updateTeamMember = ({ id, role, cca_ids = [], name, email }) =>
  api.patch(`/admin/team/${id}`, { role, cca_ids, name, email }).then((r) => r.data)

export const removeTeamMember = (id) =>
  api.delete(`/admin/team/${id}`).then((r) => r.data)

export function useTeamMembers() {
  return useQuery({
    queryKey: TEAM_KEYS.all,
    queryFn: fetchTeamMembers,
  })
}

export function useUpdateTeamMember(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateTeamMember,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEYS.all }),
    ...options,
  })
}

export function useRemoveTeamMember(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeTeamMember,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEYS.all }),
    ...options,
  })
}

export function useTreasurerOptions(ccaId) {
  return useQuery({
    queryKey: ['admin', 'treasurer-options', ccaId],
    queryFn: () => api.get('/admin/treasurer-options', { params: { cca_id: ccaId } }).then((r) => r.data),
    enabled: !!ccaId,
  })
}
