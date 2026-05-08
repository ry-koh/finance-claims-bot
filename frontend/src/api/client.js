import axios from 'axios'
import WebApp from '@twa-dev/sdk'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 300000,
})

// Attach signed Telegram Mini App initData to every authenticated request.
api.interceptors.request.use(config => {
  if (WebApp.initData) config.headers['X-Telegram-Init-Data'] = WebApp.initData
  return config
})

export default api
