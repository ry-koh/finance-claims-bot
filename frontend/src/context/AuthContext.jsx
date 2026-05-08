import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { getMe } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still loading

  const retryAuth = useCallback(() => {
    setUser(undefined)
    getMe()
      .then(setUser)
      .catch((err) => {
        if (err?.response?.status === 401 && err?.response?.data?.detail === 'unregistered') {
          setUser({ status: 'unregistered' })
        } else {
          setUser({ status: 'error' })
        }
      })
  }, [])

  useEffect(() => {
    retryAuth()
  }, [retryAuth])

  return <AuthContext.Provider value={{ user, setUser, retryAuth }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useIsDirector() {
  const { user } = useAuth()
  return user?.role === 'director'
}

export function useIsFinanceTeam() {
  const { user } = useAuth()
  return user?.role === 'director' || user?.role === 'member'
}

export function useIsTreasurer() {
  const { user } = useAuth()
  return user?.role === 'treasurer'
}
