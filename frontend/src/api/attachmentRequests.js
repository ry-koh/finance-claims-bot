import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const ATTACHMENT_KEYS = {
  requests: (claimId) => ['claims', claimId, 'attachment-requests'],
}

export function useAttachmentRequests(claimId) {
  return useQuery({
    queryKey: ATTACHMENT_KEYS.requests(claimId),
    queryFn: () => api.get(`/claims/${claimId}/attachment-requests`).then((r) => r.data),
    enabled: !!claimId,
    staleTime: 10_000,
  })
}

export function useRequestAttachment(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => api.post(`/claims/${claimId}/request-attachment`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useUploadAttachmentFile(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/claims/${claimId}/attachment-upload`, form).then((r) => r.data)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) }),
  })
}

export function useDeleteAttachmentFile(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId) =>
      api.delete(`/claims/${claimId}/attachment-requests/current/files/${fileId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) }),
  })
}

export function useSubmitAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/claims/${claimId}/attachment-submit`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useAcceptAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/claims/${claimId}/attachment-accept`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['claims', claimId] }),
  })
}

export function useRejectAttachments(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => api.post(`/claims/${claimId}/attachment-reject`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', claimId] })
      queryClient.invalidateQueries({ queryKey: ATTACHMENT_KEYS.requests(claimId) })
    },
  })
}

export function useDownloadAttachmentFile(claimId) {
  return useMutation({
    mutationFn: (fileId) =>
      api
        .get(`/claims/${claimId}/attachment-requests/current/files/${fileId}/download`)
        .then((r) => r.data),
  })
}
