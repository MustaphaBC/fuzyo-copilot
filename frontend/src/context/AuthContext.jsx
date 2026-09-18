import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setAccessToken, setUnauthorizedHandler } from '../lib/api'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

const E2E_BYPASS = import.meta.env.VITE_E2E_AUTH_BYPASS === 'true'

const E2E_SESSION = {
  access_token: 'e2e',
  user: {
    id: 'e2e-user',
    email: 'e2e@local.test',
    user_metadata: {
      full_name: 'E2E Developer',
      role: 'developer',
      organization: 'Fuzyo QA',
    },
  },
}

function applySession(next, setSession) {
  setSession(next)
  setAccessToken(next?.access_token || null)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [apiAuthError, setApiAuthError] = useState(null)

  useEffect(() => {
    if (E2E_BYPASS) {
      applySession(E2E_SESSION, setSession)
      setLoading(false)
      return undefined
    }

    if (!supabase) {
      applySession(null, setSession)
      setLoading(false)
      return undefined
    }

    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      applySession(data?.session || null, setSession)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession, setSession)
      setLoading(false)
      if (nextSession) {
        setApiAuthError(null)
      }
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  const signOut = useCallback(async () => {
    if (E2E_BYPASS) {
      applySession(null, setSession)
      setApiAuthError(null)
      return
    }
    setAccessToken(null)
    if (supabase) {
      await supabase.auth.signOut()
    }
    setSession(null)
    setApiAuthError(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(async (info = {}) => {
      const detail = String(info.detail || '')
      const expired = /token expired/i.test(detail)

      // Only tear down a valid Supabase login when the JWT is actually expired.
      // Misconfigured SUPABASE_JWT_SECRET / Invalid token must NOT bounce to AuthScreen.
      if (expired) {
        await signOut()
        return
      }

      let message = detail || 'API rejected the request (401).'
      if (/not a JWT|not enough segments|E2E_AUTH_BYPASS/i.test(detail)) {
        message =
          `${detail} Sign out (or clear site data for this origin), then sign in with email/password. ` +
          'Do not enable VITE_E2E_AUTH_BYPASS except for Playwright.'
      } else if (/jwt_secret|not configured/i.test(detail)) {
        message =
          `${detail} — set SUPABASE_JWT_SECRET in backend/.env to the JWT Secret ` +
          'from Supabase → Project Settings → API (Legacy JWT Secret), then restart uvicorn.'
      } else if (/invalid token/i.test(detail)) {
        message =
          `${detail} — check SUPABASE_URL / JWKS and, for HS256 tokens, SUPABASE_JWT_SECRET ` +
          '(JWT Secret, not the project id), then restart uvicorn.'
      }
      setApiAuthError(message)
    })
    return () => setUnauthorizedHandler(null)
  }, [signOut])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured') }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data?.session) {
      applySession(data.session, setSession)
      setApiAuthError(null)
      setLoading(false)
    }
    return { data, error }
  }, [])

  const signUp = useCallback(async (email, password, profile = {}) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured') }
    }
    const fullName = String(profile.fullName || '').trim()
    const role = String(profile.role || 'developer').trim().toLowerCase()
    const organization = String(profile.organization || '').trim()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || null,
          role: role || 'developer',
          organization: organization || null,
        },
      },
    })
    if (!error && data?.session) {
      applySession(data.session, setSession)
      setApiAuthError(null)
      setLoading(false)
    }
    return { data, error }
  }, [])

  const clearApiAuthError = useCallback(() => setApiAuthError(null), [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      signIn,
      signUp,
      signOut,
      apiAuthError,
      clearApiAuthError,
      configured: E2E_BYPASS || Boolean(supabase),
    }),
    [session, loading, signIn, signUp, signOut, apiAuthError, clearApiAuthError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
