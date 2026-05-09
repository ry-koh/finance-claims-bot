import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const PAYER_KEYS = {
  all: ['payers'],
  list: (treasurerId) => ['payers', treasurerId],
}

export const fetchPayers = (treasurerId) =>
  api.get('/payers', { params: { treasurer_id: treasurerId } }).then((r) => r.data)

export const createPayer = (body) =>
  api.post('/payers', body).then((r) => r.data)

export const updatePayer = ({ id, ...body }) =>
  api.patch(`/payers/${id}`, body).then((r) => r.data)

export const deletePayer = (id) =>
  api.delete(`/payers/${id}`).then((r) => r.data)

export function usePayers(treasurerId, enabled = true) {
  return useQuery({
    queryKey: PAYER_KEYS.list(treasurerId),
    queryFn: () => fetchPayers(treasurerId),
    enabled: enabled && !!treasurerId,
  })
}

export function useCreatePayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createPayer,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: PAYER_KEYS.list(data.owner_treasurer_id) })
    },
  })
}

export function useUpdatePayer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updatePayer,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: PAYER_KEYS.list(data.owner_treasurer_id) })
    },
  })
}

export function useDeletePayer(treasurerId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deletePayer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYER_KEYS.list(treasurerId) })
    },
  })
}
