import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

// Query key constants
export const CLAIM_KEYS = {
  all: ['claims'],
  list: (params) => ['claims', 'list', params],
  detail: (id) => ['claims', id],
}

// Raw API calls
export const fetchClaims = ({ status, statuses, page, page_size, search, date_from, date_to } = {}) => {
  const params = {}
  if (status) params.status = status
  if (statuses?.length) params.statuses = Array.isArray(statuses) ? statuses.join(',') : statuses
  if (page !== undefined) params.page = page
  if (page_size !== undefined) params.page_size = page_size
  if (search) params.search = search
  if (date_from) params.date_from = date_from
  if (date_to) params.date_to = date_to
  return api.get('/claims', { params }).then((r) => {
    if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) {
      throw new Error('Invalid claims response from API.')
    }
    return r.data
  })
}

export const fetchClaimCounts = () =>
  api.get('/claims/counts').then((r) => {
    if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) {
      throw new Error('Invalid claim counts response from API.')
    }
    return r.data
  })

export const exportClaims = async ({ status, statuses, search, date_from, date_to } = {}) => {
  const params = {}
  if (status) params.status = status
  if (statuses?.length) params.statuses = Array.isArray(statuses) ? statuses.join(',') : statuses
  if (search) params.search = search
  if (date_from) params.date_from = date_from
  if (date_to) params.date_to = date_to
  const resp = await api.get('/claims/export', { params, responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([resp.data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'claims_export.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export const fetchClaim = (id) =>
  api.get(`/claims/${id}`).then((r) => r.data)

export const fetchClaimEvents = (id) =>
  api.get(`/claims/${id}/events`).then((r) => r.data)

export const createClaim = (body) =>
  api.post('/claims', body).then((r) => r.data)

export const updateClaim = ({ id, ...body }) =>
  api.patch(`/claims/${id}`, body).then((r) => r.data)

export const deleteClaim = ({ id, hard = false }) =>
  api.delete(`/claims/${id}`, { params: { hard } }).then((r) => r.data)

export const restoreClaim = (id) =>
  api.post(`/claims/${id}/restore`).then((r) => r.data)

// TanStack Query hooks
export function useClaims(params = {}) {
  return useQuery({
    queryKey: CLAIM_KEYS.list(params),
    queryFn: () => fetchClaims(params),
    refetchInterval: 30_000,
  })
}

export function useEmailReminderClaims(enabled = true) {
  const params = {
    statuses: ['email_sent', 'screenshot_pending'],
    page: 1,
    page_size: 500,
  }
  return useQuery({
    queryKey: [...CLAIM_KEYS.all, 'email-reminder-targets'],
    queryFn: () => fetchClaims(params),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useClaimCounts() {
  return useQuery({
    queryKey: [...CLAIM_KEYS.all, 'counts'],
    queryFn: fetchClaimCounts,
    refetchInterval: 30_000,
  })
}

export function useClaim(id) {
  return useQuery({
    queryKey: CLAIM_KEYS.detail(id),
    queryFn: () => fetchClaim(id),
    enabled: !!id,
    // Only poll during background doc generation; all other updates come via mutation invalidations.
    // Continuous polling causes a race: an in-flight poll can overwrite fresh post-mutation data.
    refetchInterval: (query) =>
      query.state.data?.error_message === '__generating__' ? 3_000 : false,
  })
}

export function useClaimEvents(id) {
  return useQuery({
    queryKey: [...CLAIM_KEYS.detail(id), 'events'],
    queryFn: () => fetchClaimEvents(id),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useUpdateClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useDeleteClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export function useRestoreClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: restoreClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export const submitClaim = (claimId) =>
  api.post(`/claims/${claimId}/submit`).then((r) => r.data)

export const reimburseClaim = (claimId) =>
  api.post(`/claims/${claimId}/reimburse`).then((r) => r.data)

export const remindTreasurerEmail = (claimId) =>
  api.post(`/claims/${claimId}/email-reminder`).then((r) => r.data)

export const remindAllTreasurerEmails = ({ treasurerIds } = {}) => {
  const body = treasurerIds?.length ? { treasurer_ids: treasurerIds } : undefined
  return api.post('/claims/email-reminders', body).then((r) => r.data)
}

export function useSubmitClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitClaim,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}

export function useReimburseClaim(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reimburseClaim,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}

export function useRemindTreasurerEmail(options = {}) {
  return useMutation({
    mutationFn: remindTreasurerEmail,
    ...options,
  })
}

export function useRemindAllTreasurerEmails(options = {}) {
  return useMutation({
    mutationFn: remindAllTreasurerEmails,
    ...options,
  })
}

export const bulkUpdateStatus = ({ claim_ids, status }) =>
  api.patch('/claims/bulk', { claim_ids, status }).then((r) => r.data)

export function useBulkUpdateStatus(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkUpdateStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export const fetchReimbursementPreview = ({ claim_ids }) =>
  api.post('/claims/reimbursements/preview', { claim_ids }).then((r) => r.data)

export function useReimbursementPreview(claimIds = []) {
  return useQuery({
    queryKey: ['reimbursements', 'preview', claimIds],
    queryFn: () => fetchReimbursementPreview({ claim_ids: claimIds }),
    enabled: claimIds.length > 0,
  })
}

export const completeReimbursements = ({ claim_ids }) =>
  api.post('/claims/reimbursements/complete', { claim_ids }).then((r) => r.data)

export function useCompleteReimbursements(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: completeReimbursements,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all })
    },
    ...options,
  })
}

export const submitForReview = (claimId) =>
  api.post(`/claims/${claimId}/submit-review`).then((r) => r.data)

export const rejectReview = ({ claimId, comment }) =>
  api.post(`/claims/${claimId}/reject-review`, { comment }).then((r) => r.data)

export function useSubmitForReview(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitForReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}

export function useRejectReview(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAIM_KEYS.all }),
    ...options,
  })
}
