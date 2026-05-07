import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

const SETTINGS_KEY = ['settings']

export const fetchSettings = () =>
  api.get('/settings').then((r) => r.data)

export const updateSettings = (data) =>
  api.patch('/settings', data).then((r) => r.data)

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function useUpdateSettings(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
    ...options,
  })
}
