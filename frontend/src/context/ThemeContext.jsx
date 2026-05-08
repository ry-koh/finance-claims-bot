import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'finance_claims_theme'
const THEME_OPTIONS = ['system', 'light', 'dark']

const ThemeContext = createContext(null)

function getTelegramScheme() {
  return window?.Telegram?.WebApp?.colorScheme === 'dark' ? 'dark' : null
}

function getSystemScheme() {
  if (window?.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode
  return getTelegramScheme() || getSystemScheme()
}

function initialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return THEME_OPTIONS.includes(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode)
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(initialMode()))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {}

    const apply = () => {
      const next = resolveTheme(mode)
      setResolvedTheme(next)
      document.documentElement.dataset.theme = next
      document.documentElement.style.colorScheme = next
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', next === 'dark' ? '#0b1120' : '#f6f8fb')
    }

    apply()

    const media = window?.matchMedia?.('(prefers-color-scheme: dark)')
    const telegram = window?.Telegram?.WebApp

    media?.addEventListener?.('change', apply)
    telegram?.onEvent?.('themeChanged', apply)

    return () => {
      media?.removeEventListener?.('change', apply)
      telegram?.offEvent?.('themeChanged', apply)
    }
  }, [mode])

  const value = useMemo(() => ({
    mode,
    resolvedTheme,
    setMode: (nextMode) => {
      if (THEME_OPTIONS.includes(nextMode)) setMode(nextMode)
    },
  }), [mode, resolvedTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export { THEME_OPTIONS }
