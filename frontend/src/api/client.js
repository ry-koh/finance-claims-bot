import axios from 'axios'
import WebApp from '@twa-dev/sdk'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 300000,
})

const TRANSIENT_STATUSES = new Set([502, 503, 504])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Attach signed Telegram Mini App initData to every authenticated request.
api.interceptors.request.use(config => {
  if (WebApp.initData) config.headers['X-Telegram-Init-Data'] = WebApp.initData
  return config
})

api.interceptors.response.use(
  response => response,
  async error => {
    const config = error.config
    const method = config?.method?.toLowerCase()
    const status = error.response?.status

    if (config && method === 'get' && TRANSIENT_STATUSES.has(status) && !config.__retried) {
      config.__retried = true
      await sleep(800)
      return api(config)
    }

    return Promise.reject(error)
  }
)

export default api
