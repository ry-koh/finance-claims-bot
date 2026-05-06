import { createContext, useContext, useEffect, useState } from 'react'
import { getMe } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still loading

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser({ status: 'unregistered' }))
  }, [])

  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
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
