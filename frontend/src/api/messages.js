import { useQuery, useMutation } from '@tanstack/react-query'
import api from './api'

export const useTreasurers = () =>
  useQuery({
    queryKey: ['messages', 'treasurers'],
    queryFn: () => api.get('/messages/treasurers').then((r) => r.data),
  })

export const sendMessage = ({ telegram_id, message }) =>
  api.post('/messages/send', { telegram_id, message }).then((r) => r.data)

export function useSendMessage(options = {}) {
  return useMutation({ mutationFn: sendMessage, ...options })
}
