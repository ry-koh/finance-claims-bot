import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const CLAIMER_KEYS = {
  all: ['claimers'],
  list: (params) => ['claimers', 'list', params],
  detail: (id) => ['claimers', id],
}

// Raw API calls
export const fetchClaimers = ({ cca_id, search } = {}) => {
  const params = {}
  if (cca_id) params.cca_id = cca_id
  if (search) params.search = search
  return api.get('/claimers', { params }).then((r) => r.data)
}

export const fetchClaimer = (id) =>
  api.get(`/claimers/${id}`).then((r) => r.data)

export const createClaimer = (body) =>
  api.post('/claimers', body).then((r) => r.data)

export const updateClaimer = ({ id, ...body }) =>
  api.patch(`/claimers/${id}`, body).then((r) => r.data)

export const deleteClaimer = (id) =>
  api.delete(`/claimers/${id}`).then((r) => r.data)

// TanStack Query hooks
export function useClaimers(params = {}) {
  return useQuery({
    queryKey: CLAIMER_KEYS.list(params),
    queryFn: () => fetchClaimers(params),
    enabled: 'cca_id' in params ? !!params.cca_id : true,
  })
}

export function useClaimer(id) {
  return useQuery({
    queryKey: CLAIMER_KEYS.detail(id),
    queryFn: () => fetchClaimer(id),
    enabled: !!id,
  })
}

export function useCreateClaimer(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createClaimer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIMER_KEYS.all })
    },
    ...options,
  })
}

export function useUpdateClaimer(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateClaimer,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: CLAIMER_KEYS.all })
      if (data?.id) {
        queryClient.setQueryData(CLAIMER_KEYS.detail(data.id), data)
      }
    },
    ...options,
  })
}

export function useDeleteClaimer(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteClaimer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIMER_KEYS.all })
    },
    ...options,
  })
}
