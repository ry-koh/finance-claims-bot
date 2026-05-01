import { useMutation } from '@tanstack/react-query'
import api from './client'

// Raw API calls
export const sendEmail = (claimId) =>
  api.post(`/email/send/${claimId}`).then((r) => r.data)

export const resendEmail = (claimId) =>
  api.post(`/email/resend/${claimId}`).then((r) => r.data)

// TanStack Query hooks
export function useSendEmail(options = {}) {
  return useMutation({
    mutationFn: sendEmail,
    ...options,
  })
}

export function useResendEmail(options = {}) {
  return useMutation({
    mutationFn: resendEmail,
    ...options,
  })
}
