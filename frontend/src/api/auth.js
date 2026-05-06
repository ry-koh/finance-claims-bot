import api from './client'

export const getMe = () => api.get('/me').then((r) => r.data)

export const register = (payload) => api.post('/register', payload).then((r) => r.data)

export const updateRegistration = (payload) => api.put('/register', payload).then((r) => r.data)
