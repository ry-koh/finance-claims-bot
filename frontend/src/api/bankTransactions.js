import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'
import { CLAIM_KEYS } from './claims'

export const createBankTransaction = ({ claimId, amount }) => {
  const form = new FormData()
  form.append('claim_id', claimId)
  form.append('amount', String(amount))
  return api.post('/bank-transactions', form).then((r) => r.data)
}

export const uploadBankTransactionImage = ({ btId, file }) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/bank-transactions/${btId}/images`, form).then((r) => r.data)
}

export const deleteBankTransactionImage = ({ btId, imageId }) =>
  api.delete(`/bank-transactions/${btId}/images/${imageId}`).then((r) => r.data)

export const deleteBankTransaction = (btId) =>
  api.delete(`/bank-transactions/${btId}`).then((r) => r.data)

export const updateBankTransaction = ({ btId, amount }) => {
  const form = new FormData()
  form.append('amount', String(amount))
  return api.patch(`/bank-transactions/${btId}`, form).then((r) => r.data)
}

export const createBtRefund = ({ btId, amount, file }) => {
  const form = new FormData()
  form.append('amount', String(amount))
  form.append('file', file)
  return api.post(`/bank-transactions/${btId}/refunds`, form).then((r) => r.data)
}

export const deleteBtRefund = ({ btId, refundId }) =>
  api.delete(`/bank-transactions/${btId}/refunds/${refundId}`).then((r) => r.data)

export function useCreateBankTransaction(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createBankTransaction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useUploadBankTransactionImage(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadBankTransactionImage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useDeleteBankTransactionImage(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBankTransactionImage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useDeleteBankTransaction(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBankTransaction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useUpdateBankTransaction(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateBankTransaction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useCreateBtRefund(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createBtRefund,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}

export function useDeleteBtRefund(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBtRefund,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) }),
  })
}
