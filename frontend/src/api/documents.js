import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const DOCUMENT_KEYS = {
  all: ['documents'],
  list: (claimId) => ['documents', claimId],
}

// Raw API calls
export const generateDocuments = (claimId) =>
  api.post(`/documents/generate/${claimId}`).then((r) => r.data)

export const compileDocuments = (claimId) =>
  api.post(`/documents/compile/${claimId}`).then((r) => r.data)

export const uploadScreenshot = ({ claimId, file }) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/documents/upload-screenshot/${claimId}`, form).then((r) => r.data)
}

export const submitTransportData = ({ claimId, trips }) =>
  api.post(`/documents/transport-data/${claimId}`, { trips }).then((r) => r.data)

export const fetchDocuments = (claimId) =>
  api.get(`/documents/${claimId}`).then((r) => r.data)

// TanStack Query hooks
export function useDocuments(claimId) {
  return useQuery({
    queryKey: DOCUMENT_KEYS.list(claimId),
    queryFn: () => fetchDocuments(claimId),
    enabled: !!claimId,
  })
}

export function useGenerateDocuments(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: generateDocuments,
    onSuccess: (data, claimId) => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_KEYS.list(claimId) })
    },
    ...options,
  })
}

export function useCompileDocuments(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: compileDocuments,
    onSuccess: (data, claimId) => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_KEYS.list(claimId) })
    },
    ...options,
  })
}

export function useUploadScreenshot(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadScreenshot,
    onSuccess: (data, { claimId }) => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_KEYS.list(claimId) })
    },
    ...options,
  })
}

export function useSubmitTransportData(options = {}) {
  return useMutation({
    mutationFn: submitTransportData,
    ...options,
  })
}

export const sendToTelegram = ({ claim_ids }) =>
  api.post('/documents/send-telegram', { claim_ids }).then((r) => r.data)

export function useSendToTelegram(options = {}) {
  return useMutation({
    mutationFn: sendToTelegram,
    ...options,
  })
}
