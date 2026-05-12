import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { getMe } from '../api/auth'
import { fetchTestingMode } from '../api/settings'
import { friendlyError } from '../utils/errors'

const AuthContext = createContext(null)
const PREVIEW_ROLE_KEY = 'finance_claims_preview_role'
const VALID_PREVIEW_ROLES = new Set(['director', 'member', 'treasurer'])
const DEFAULT_TESTING_MODE = {
  enabled: false,
  message: 'The finance claims app is temporarily down for testing. Please check back later.',
}

function isActiveUser(member) {
  return member &&
    member.status !== 'unregistered' &&
    member.status !== 'pending' &&
    member.status !== 'error'
}

function initialPreviewRole() {
  try {
    const stored = localStorage.getItem(PREVIEW_ROLE_KEY)
    return VALID_PREVIEW_ROLES.has(stored) ? stored : 'director'
  } catch {
    return 'director'
  }
}

export function AuthProvider({ children }) {
  const [actualUser, setActualUser] = useState(undefined) // undefined = still loading
  const [testingMode, setTestingMode] = useState(DEFAULT_TESTING_MODE)
  const [testingModeLoading, setTestingModeLoading] = useState(false)
  const [previewRole, setPreviewRoleState] = useState(initialPreviewRole)

  const setPreviewRole = useCallback((role) => {
    if (!VALID_PREVIEW_ROLES.has(role)) return
    setPreviewRoleState(role)
    try {
      localStorage.setItem(PREVIEW_ROLE_KEY, role)
    } catch {}
  }, [])

  const refreshTestingMode = useCallback(async () => {
    setTestingModeLoading(true)
    try {
      const mode = await fetchTestingMode()
      const normalised = {
        enabled: Boolean(mode?.enabled),
        message: mode?.message || DEFAULT_TESTING_MODE.message,
      }
      setTestingMode(normalised)
      return normalised
    } catch {
      setTestingMode((current) => current || DEFAULT_TESTING_MODE)
      return null
    } finally {
      setTestingModeLoading(false)
    }
  }, [])

  const retryAuth = useCallback(() => {
    setActualUser(undefined)
    getMe()
      .then(async (member) => {
        if (isActiveUser(member)) await refreshTestingMode()
        else setTestingMode(DEFAULT_TESTING_MODE)
        setActualUser(member)
      })
      .catch((err) => {
        if (err?.response?.status === 401 && err?.response?.data?.detail === 'unregistered') {
          setActualUser({ status: 'unregistered' })
        } else {
          setActualUser({ status: 'error', message: friendlyError(err, 'Could not load your account.') })
        }
      })
  }, [refreshTestingMode])

  useEffect(() => {
    retryAuth()
  }, [retryAuth])

  useEffect(() => {
    if (!isActiveUser(actualUser)) return undefined
    const timer = window.setInterval(refreshTestingMode, 30_000)
    return () => window.clearInterval(timer)
  }, [actualUser, refreshTestingMode])

  const user = useMemo(() => {
    if (!isActiveUser(actualUser)) return actualUser
    if (actualUser.role === 'director' && testingMode.enabled && previewRole !== 'director') {
      return {
        ...actualUser,
        role: previewRole,
        actual_role: actualUser.role,
        preview_role: previewRole,
        is_role_preview: true,
      }
    }
    return actualUser
  }, [actualUser, previewRole, testingMode.enabled])

  const contextValue = useMemo(() => ({
    user,
    actualUser,
    setUser: setActualUser,
    retryAuth,
    testingMode,
    testingModeLoading,
    refreshTestingMode,
    previewRole,
    setPreviewRole,
  }), [actualUser, previewRole, refreshTestingMode, retryAuth, setPreviewRole, testingMode, testingModeLoading, user])

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
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

export function useIsActualDirector() {
  const { actualUser } = useAuth()
  return actualUser?.role === 'director'
}

export function useIsFinanceTeam() {
  const { user } = useAuth()
  return user?.role === 'director' || user?.role === 'member'
}

export function useIsTreasurer() {
  const { user } = useAuth()
  return user?.role === 'treasurer'
}
