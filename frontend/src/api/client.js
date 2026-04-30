import axios from 'axios'
import WebApp from '@twa-dev/sdk'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

// Attach Telegram user ID to every request for auth
api.interceptors.request.use(config => {
  const userId = WebApp.initDataUnsafe?.user?.id
  if (userId) config.headers['X-Telegram-User-Id'] = String(userId)
  return config
})

// Pre-warm: ping health on import (non-blocking)
api.get('/health').catch(() => {})

export default api
