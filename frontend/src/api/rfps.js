import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const RFP_KEYS = {
  all: ['rfps'],
  list: () => ['rfps', 'list'],
}

export const fetchRfps = () =>
  api.get('/rfps').then((r) => r.data)

export const createRfp = (payload) =>
  api.post('/rfps', payload).then((r) => r.data)

export const sendRfpToTelegram = (rfpId) =>
  api.post(`/rfps/${rfpId}/send-telegram`).then((r) => r.data)

export const updateRfp = ({ rfpId, payload }) =>
  api.patch(`/rfps/${rfpId}`, payload).then((r) => r.data)

export const deleteRfp = (rfpId) =>
  api.delete(`/rfps/${rfpId}`).then((r) => r.data)

export const rfpDownloadUrl = (rfpId) =>
  `${api.defaults.baseURL}/rfps/${rfpId}/download`

export function useRfps() {
  return useQuery({
    queryKey: RFP_KEYS.list(),
    queryFn: fetchRfps,
  })
}

export function useCreateRfp(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createRfp,
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: RFP_KEYS.all })
      options.onSuccess?.(...args)
    },
  })
}

export function useSendRfpToTelegram(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: sendRfpToTelegram,
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: RFP_KEYS.all })
      options.onSuccess?.(...args)
    },
  })
}

export function useUpdateRfp(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateRfp,
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: RFP_KEYS.all })
      options.onSuccess?.(...args)
    },
  })
}

export function useDeleteRfp(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteRfp,
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: RFP_KEYS.all })
      options.onSuccess?.(...args)
    },
  })
}
