import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useApp } from '../context/AppContext'
import { renderMermaidSafe } from '../utils/sanitizeMermaid'

export default function MermaidRenderer({ chart }) {
  const { appearance } = useApp()
  const hostRef = useRef(null)
  const reactId = useId().replace(/:/g, '')
  const [error, setError] = useState(null)
  const [fallbackSource, setFallbackSource] = useState('')
  const theme = appearance === 'dark' ? 'dark' : 'default'

  useEffect(() => {
    let cancelled = false

    async function renderChart() {
      if (!hostRef.current) return
      hostRef.current.innerHTML = ''
      setError(null)
      setFallbackSource('')

      const renderId = `mermaid-${reactId}-${Date.now()}`
      const result = await renderMermaidSafe(mermaid, renderId, chart, theme)
      if (cancelled) return

      if (result.error) {
        setError(result.error)
        setFallbackSource(result.source || chart || '')
        return
      }

      if (hostRef.current) {
        hostRef.current.innerHTML = result.svg
      }
    }

    renderChart()
    return () => {
      cancelled = true
    }
  }, [chart, reactId, theme])

  if (error) {
    return (
      <div
        className="rounded-md border border-[var(--border)] bg-[var(--code-bg)] p-3"
        data-testid="mermaid-fallback"
      >
        <p className="mb-2 text-xs text-[var(--muted)]">
          Diagram could not be rendered — showing Mermaid source.
        </p>
        <pre className="overflow-x-auto text-xs text-[var(--app-fg)]">
          <code>{fallbackSource || chart || ''}</code>
        </pre>
        <p className="mt-2 text-[10px] text-[var(--muted)]">{error}</p>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className="overflow-auto rounded-md border border-[var(--border)] bg-[var(--code-bg)] p-3 [&_svg]:max-w-full"
    />
  )
}
