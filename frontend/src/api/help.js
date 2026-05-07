import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const HELP_KEYS = {
  myQuestions: ['help', 'my-questions'],
  allQuestions: ['help', 'all-questions'],
  question: (id) => ['help', 'questions', id],
}

export const fetchMyQuestions = () =>
  api.get('/help/questions').then((r) => r.data)

export const fetchAllQuestions = () =>
  api.get('/help/questions/all').then((r) => r.data)

export const fetchQuestion = (id) =>
  api.get(`/help/questions/${id}`).then((r) => r.data)

export const createQuestion = (data) =>
  api.post('/help/questions', data).then((r) => r.data)

export const postAnswer = (questionId, data) =>
  api.post(`/help/questions/${questionId}/answers`, data).then((r) => r.data)

export const deleteQuestion = (questionId) =>
  api.delete(`/help/questions/${questionId}`).then((r) => r.data)

export const editQuestion = (questionId, data) =>
  api.patch(`/help/questions/${questionId}`, data).then((r) => r.data)

export const editAnswer = (questionId, answerId, data) =>
  api.patch(`/help/questions/${questionId}/answers/${answerId}`, data).then((r) => r.data)

export const uploadHelpImage = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/help/upload', form).then((r) => r.data)
}

export function useMyQuestions() {
  return useQuery({
    queryKey: HELP_KEYS.myQuestions,
    queryFn: fetchMyQuestions,
    staleTime: 30_000,
  })
}

export function useAllQuestions() {
  return useQuery({
    queryKey: HELP_KEYS.allQuestions,
    queryFn: fetchAllQuestions,
    staleTime: 30_000,
  })
}

export function useQuestion(id) {
  return useQuery({
    queryKey: HELP_KEYS.question(id),
    queryFn: () => fetchQuestion(id),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateQuestion(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createQuestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HELP_KEYS.myQuestions }),
    ...options,
  })
}

export function usePostAnswer(questionId, options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => postAnswer(questionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.question(questionId) })
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.allQuestions })
    },
    ...options,
  })
}

export function useDeleteQuestion(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteQuestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HELP_KEYS.allQuestions }),
    ...options,
  })
}

export function useEditQuestion(questionId, options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => editQuestion(questionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.question(questionId) })
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.myQuestions })
    },
    ...options,
  })
}

export function useEditAnswer(questionId, answerId, options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => editAnswer(questionId, answerId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HELP_KEYS.question(questionId) }),
    ...options,
  })
}
