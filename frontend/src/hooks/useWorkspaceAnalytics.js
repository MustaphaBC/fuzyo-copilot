import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

export async function fetchWorkspaceAnalytics(workspaceId, { refresh = false } = {}) {
  const query = refresh ? '?refresh=true' : ''
  const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/analytics${query}`)
  if (response.status === 404) return null
  if (response.status === 503) {
    throw new Error('Supabase unreachable. Check network and retry.')
  }
  if (!response.ok) {
    throw new Error(`Analytics failed (${response.status})`)
  }
  return response.json()
}

export function useWorkspaceAnalytics(workspaceId) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(workspaceId))
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshNext, setRefreshNext] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setData(null)
      setError(null)
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWorkspaceAnalytics(workspaceId, { refresh: refreshNext })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => {
        if (cancelled) return
        setData(null)
        setError(err instanceof Error ? err.message : 'Failed to load analytics')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setRefreshNext(false)
      })
    return () => {
      cancelled = true
    }
    // refreshNext is consumed by the reload it triggers; it must not re-trigger on reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, reloadKey])

  useEffect(() => {
    const onFsUpdated = (event) => {
      const id = event?.detail?.workspaceId
      if (!id || !workspaceId || String(id) !== String(workspaceId)) return
      setReloadKey((k) => k + 1)
    }
    window.addEventListener('fuzyo:workspace-fs-updated', onFsUpdated)
    return () => window.removeEventListener('fuzyo:workspace-fs-updated', onFsUpdated)
  }, [workspaceId])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const rescan = useCallback(() => {
    setRefreshNext(true)
    setReloadKey((k) => k + 1)
  }, [])

  return { data, loading, error, reload, rescan }
}
