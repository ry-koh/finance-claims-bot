import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const CLAIM_KEYS = {
  all: ['claims'],
  list: (params) => ['claims', 'list', params],
  detail: (id) => ['claims', id],
}

// Raw API calls
export const fetchClaims = ({ status, page, page_size } = {}) => {
  const params = {}
  if (status) params.status = status
  if (page !== undefined) params.page = page
  if (page_size !== undefined) params.page_size = page_size
  return api.get('/claims', { params }).then((r) => r.data)
}

export const fetchClaim = (id) =>
  api.get(`/claims/${id}`).then((r) => r.data)

export const createClaim = (body) =>
  api.post('/claims', body).then((r) => r.data)

export const updateClaim = ({ id, ...body }) =>
  api.patch(`/claims/${id}`, body).then((r) => r.data)

export const deleteClaim = ({ id, hard = false }) =>
  api.delete(`/claims/${id}`, { params: { hard } }).then((r) => r.data)

export const restoreClaim = (id) =>
  api.post(`/claims/${id}/restore`).then((r) => r.data)

// TanStack Query hooks
export function useClaims(params = {}) {
  return useQuery({
    queryKey: CLAIM_KEYS.list(params),
    queryFn: () => fetchClaims(params),
  })
}

export function useClaim(id) {
  return useQuery({
    queryKey: CLAIM_KEYS.detail(id),
    queryFn: () => fetchClaim(id),
    enabled: !!id,
  })
}

export function useCreateClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useUpdateClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useDeleteClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useRestoreClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: restoreClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}
