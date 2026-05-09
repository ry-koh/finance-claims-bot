import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const RECEIPT_KEYS = {
  all: ['receipts'],
  list: (params) => ['receipts', 'list', params],
  detail: (id) => ['receipts', id],
}

// Raw API calls
export const processReceiptImage = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/receipts/process-image', form).then((r) => r.data)
}

export const processPdfPages = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/receipts/process-pdf-pages', form).then((r) => r.data)
}

export const uploadReceiptImage = ({ file, claim_id, image_type }) => {
  const form = new FormData()
  form.append('file', file)
  form.append('claim_id', String(claim_id))
  form.append('image_type', image_type)
  return api.post('/receipts/upload-image', form).then((r) => r.data)
}

export const createReceipt = (body) =>
  api.post('/receipts', body).then((r) => r.data)

export const fetchReceipts = ({ claim_id } = {}) => {
  const params = {}
  if (claim_id) params.claim_id = claim_id
  return api.get('/receipts', { params }).then((r) => r.data)
}

export const fetchReceipt = (id) =>
  api.get(`/receipts/${id}`).then((r) => r.data)

export const updateLineItem = ({ id, ...body }) =>
  api.patch(`/receipts/line-items/${id}`, body).then((r) => r.data)

export const updateReceipt = ({ id, confirm_category_change = false, ...body }) =>
  api
    .patch(`/receipts/${id}`, body, {
      params: { confirm_category_change },
    })
    .then((r) => r.data)

export const deleteReceipt = (id) =>
  api.delete(`/receipts/${id}`).then((r) => r.data)

// TanStack Query hooks
export function useReceipts(params = {}) {
  return useQuery({
    queryKey: RECEIPT_KEYS.list(params),
    queryFn: () => fetchReceipts(params),
    enabled: !!params.claim_id,
  })
}

export function useReceipt(id) {
  return useQuery({
    queryKey: RECEIPT_KEYS.detail(id),
    queryFn: () => fetchReceipt(id),
    enabled: !!id,
  })
}

export function useProcessReceiptImage(options = {}) {
  return useMutation({
    mutationFn: processReceiptImage,
    ...options,
  })
}

export function useUploadReceiptImage(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadReceiptImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all })
    },
    ...options,
  })
}

export function useCreateReceipt(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all })
    },
    ...options,
  })
}

export function useUpdateLineItem(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateLineItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all })
    },
    ...options,
  })
}

export function useUpdateReceipt(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateReceipt,
    onSuccess: (data) => {
      if (!data?.requires_confirmation) {
        queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all })
      }
    },
    ...options,
  })
}

export function useDeleteReceipt(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all })
    },
    ...options,
  })
}

export const uploadReceiptImageById = ({ receiptId, file }) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/receipts/${receiptId}/images`, form).then((r) => r.data)
}

export const uploadReceiptFxImageById = ({ receiptId, file }) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/receipts/${receiptId}/fx-images`, form).then((r) => r.data)
}

export const deleteReceiptImage = ({ receiptId, imageId }) =>
  api.delete(`/receipts/${receiptId}/images/${imageId}`).then((r) => r.data)

export function useUploadReceiptImageById(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadReceiptImageById,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all }),
  })
}

export function useDeleteReceiptImage(claimId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteReceiptImage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECEIPT_KEYS.all }),
  })
}
