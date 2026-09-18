import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'

function optionKey(item) {
  if (!item) return 'auto'
  if (item.provider === 'auto' || item.id === 'auto') return 'auto'
  return `${item.provider}:${item.id}`
}

const AUTO_ONLY = [{ provider: 'auto', id: 'auto', label: 'Auto (SDLC routi)' }]

export default function ModelSelector() {
  const { selectedModelKey, setSelectedModelKey } = useApp()
  const { session, loading: authLoading } = useAuth()
  const [options, setOptions] = useState(AUTO_ONLY)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    if (authLoading || !session?.access_token) {
      return undefined
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/api/v1/models/available')
        if (cancelled) return
        if (res.status === 401) {
          setLoadError(null)
          return
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return
        if (Array.isArray(data) && data.length) {
          setOptions(data)
          setLoadError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load models')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, session?.access_token])

  useEffect(() => {
    if (!options.length || !selectedModelKey || selectedModelKey === 'auto') return
    const keys = new Set(options.map(optionKey))
    if (!keys.has(selectedModelKey)) {
      setSelectedModelKey('auto')
    }
  }, [options, selectedModelKey, setSelectedModelKey])

  return (
    <>
      <label className="sr-only" htmlFor="model-override-select">
        Model
      </label>
      <select
        id="model-override-select"
        value={selectedModelKey || 'auto'}
        onChange={(event) => setSelectedModelKey(event.target.value)}
        title={loadError || undefined}
        className="max-w-[11rem] truncate rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
        data-testid="model-selector"
      >
        {options.map((opt) => {
          const key = optionKey(opt)
          return (
            <option key={key} value={key}>
              {opt.label}
            </option>
          )
        })}
      </select>
    </>
  )
}
