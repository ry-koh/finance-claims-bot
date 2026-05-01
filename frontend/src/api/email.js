import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'
import { CLAIM_KEYS } from './claims'

// Raw API calls
export const sendEmail = (claimId) =>
  api.post(`/email/send/${claimId}`).then((r) => r.data)

export const resendEmail = (claimId) =>
  api.post(`/email/resend/${claimId}`).then((r) => r.data)

// TanStack Query hooks
export function useSendEmail(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: sendEmail,
    onSuccess: (data, claimId) => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    },
    ...options,
  })
}

export function useResendEmail(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resendEmail,
    onSuccess: (data, claimId) => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.detail(claimId) })
    },
    ...options,
  })
}
