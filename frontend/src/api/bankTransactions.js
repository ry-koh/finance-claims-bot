import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'
import { CLAIM_KEYS } from './claims'

export const createBankTransaction = (claimId) => {
  const form = new FormData()
  form.append('claim_id', claimId)
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

export function useCreateBankTransaction(claimId) {
  return useMutation({ mutationFn: () => createBankTransaction(claimId) })
}

export function useUploadBankTransactionImage() {
  return useMutation({ mutationFn: uploadBankTransactionImage })
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
