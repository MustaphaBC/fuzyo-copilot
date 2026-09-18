import { supabase } from './supabaseClient'

/** Optional token override updated by AuthContext (and E2E bypass). */
let _accessToken = null
/** @type {null | ((info: { detail: string, status: number }) => void | Promise<void>)} */
let _onUnauthorized = null

export function setAccessToken(token) {
  _accessToken = token || null
}

export function setUnauthorizedHandler(handler) {
  _onUnauthorized = typeof handler === 'function' ? handler : null
}

async function resolveAccessToken() {
  if (_accessToken) return _accessToken
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

async function readUnauthorizedDetail(response) {
  try {
    const cloned = response.clone()
    const body = await cloned.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail)) {
      return body.detail.map((d) => d?.msg || String(d)).join('; ')
    }
  } catch {
    /* ignore */
  }
  return 'API returned 401 Unauthorized'
}

async function tryRefreshAccessToken() {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data?.session?.access_token) return null
    _accessToken = data.session.access_token
    return data.session.access_token
  } catch {
    return null
  }
}

/**
 * fetch wrapper that injects Authorization: Bearer from the current session.
 * On 401: refresh once + retry; notify handler without forcing a silent loop.
 */
export async function apiFetch(input, init = {}, { _retried = false } = {}) {
  const headers = new Headers(init.headers || {})
  const token = await resolveAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status !== 401) {
    return response
  }

  if (!_retried) {
    const refreshed = await tryRefreshAccessToken()
    if (refreshed) {
      const retryHeaders = new Headers(init.headers || {})
      retryHeaders.set('Authorization', `Bearer ${refreshed}`)
      return apiFetch(input, { ...init, headers: retryHeaders }, { _retried: true })
    }
  }

  const detail = await readUnauthorizedDetail(response)
  if (_onUnauthorized) {
    try {
      await _onUnauthorized({ detail, status: 401 })
    } catch {
      // soft-fail: avoid secondary errors looping
    }
  }

  return response
}
