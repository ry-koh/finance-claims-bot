import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

const SETTINGS_KEY = ['settings']
const TESTING_MODE_KEY = ['settings', 'testing-mode']

export const fetchSettings = () =>
  api.get('/settings').then((r) => r.data)

export const updateSettings = (data) =>
  api.patch('/settings', data).then((r) => r.data)

export const fetchTestingMode = () =>
  api.get('/settings/testing-mode').then((r) => r.data)

export const updateTestingMode = (data) =>
  api.patch('/settings/testing-mode', data).then((r) => r.data)

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function useUpdateSettings(options = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...mutationOptions } = options
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
      queryClient.invalidateQueries({ queryKey: TESTING_MODE_KEY })
      onSuccess?.(...args)
    },
    ...mutationOptions,
  })
}

export function useTestingMode() {
  return useQuery({
    queryKey: TESTING_MODE_KEY,
    queryFn: fetchTestingMode,
    refetchInterval: 30_000,
  })
}

export function useUpdateTestingMode(options = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...mutationOptions } = options
  return useMutation({
    mutationFn: updateTestingMode,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
      queryClient.invalidateQueries({ queryKey: TESTING_MODE_KEY })
      onSuccess?.(...args)
    },
    ...mutationOptions,
  })
}
