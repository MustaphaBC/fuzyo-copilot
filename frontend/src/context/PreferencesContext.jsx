import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const PreferencesContext = createContext(null)

const APPEARANCE_KEY = 'fuzyo:appearance'
const DENSITY_KEY = 'fuzyo:density'
const APPEARANCES = ['dark', 'light', 'system']

function readAppearance() {
  try {
    const value = localStorage.getItem(APPEARANCE_KEY)
    return APPEARANCES.includes(value) ? value : 'dark'
  } catch {
    return 'dark'
  }
}

function readDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function applyAppearanceClass(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light'
}

export function PreferencesProvider({ children }) {
  const [appearance, setAppearanceState] = useState(() => readAppearance())
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())
  const [density, setDensityState] = useState(() => readDensity())
  const [apiHealthy, setApiHealthy] = useState(false)
  const resolvedAppearance = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance

  const setAppearance = useCallback((mode) => {
    setAppearanceState(APPEARANCES.includes(mode) ? mode : 'dark')
  }, [])

  const toggleAppearance = useCallback(() => {
    setAppearanceState((current) => {
      const resolved = current === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : current
      return resolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const setDensity = useCallback((mode) => {
    setDensityState(mode === 'compact' ? 'compact' : 'comfortable')
  }, [])

  useEffect(() => {
    applyAppearanceClass(resolvedAppearance)
    try {
      localStorage.setItem(APPEARANCE_KEY, appearance)
    } catch {
      /* ignore */
    }
  }, [appearance, resolvedAppearance])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const onChange = (event) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('density-compact', density === 'compact')
    try {
      localStorage.setItem(DENSITY_KEY, density)
    } catch {
      /* ignore */
    }
  }, [density])

  useEffect(() => {
    let cancelled = false
    async function ping() {
      try {
        const response = await fetch('/health')
        if (!cancelled) setApiHealthy(response.ok)
      } catch {
        if (!cancelled) setApiHealthy(false)
      }
    }
    ping()
    const id = setInterval(ping, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const value = useMemo(
    () => ({
      appearance,
      resolvedAppearance,
      setAppearance,
      toggleAppearance,
      density,
      setDensity,
      apiHealthy,
    }),
    [appearance, resolvedAppearance, setAppearance, toggleAppearance, density, setDensity, apiHealthy],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider')
  }
  return ctx
}
