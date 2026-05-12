import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/admin': 'http://127.0.0.1:8000',
      '/bank-transactions': 'http://127.0.0.1:8000',
      '/bot': 'http://127.0.0.1:8000',
      '/claims': 'http://127.0.0.1:8000',
      '/documents': 'http://127.0.0.1:8000',
      '/email': 'http://127.0.0.1:8000',
      '/help': 'http://127.0.0.1:8000',
      '/images': 'http://127.0.0.1:8000',
      '/me': 'http://127.0.0.1:8000',
      '/messages': 'http://127.0.0.1:8000',
      '/payers': 'http://127.0.0.1:8000',
      '/portfolios': 'http://127.0.0.1:8000',
      '/receipts': 'http://127.0.0.1:8000',
      '/register': 'http://127.0.0.1:8000',
      '/settings': 'http://127.0.0.1:8000',
    },
  },
})
