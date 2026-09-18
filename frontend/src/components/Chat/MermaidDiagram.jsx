import { Maximize2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'
import { useApp } from '../../context/AppContext'
import { useArtifact } from '../../context/ArtifactContext'
import { renderMermaidSafe } from '../../utils/sanitizeMermaid'

export default function MermaidDiagram({ chart, title = 'Architecture diagram' }) {
  const { appearance } = useApp()
  const { openArtifact } = useArtifact()
  const reactId = useId().replace(/:/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const [fallbackSource, setFallbackSource] = useState('')
  const theme = appearance === 'dark' ? 'dark' : 'default'

  useEffect(() => {
    let cancelled = false
    async function renderChart() {
      setError(null)
      setSvg('')
      setFallbackSource('')
      const renderId = `mmd-${reactId}-${Date.now()}`
      const result = await renderMermaidSafe(mermaid, renderId, chart, theme)
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setFallbackSource(result.source || chart || '')
        return
      }
      setSvg(result.svg)
    }
    renderChart()
    return () => {
      cancelled = true
    }
  }, [chart, reactId, theme])

  const openCanvas = () => {
    openArtifact({
      type: 'mermaid',
      title,
      content: chart || '',
    })
  }

  if (error) {
    return (
      <pre
        className="my-2 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--code-bg)] p-3 text-xs text-[var(--app-fg)]"
        data-testid="mermaid-fallback"
      >
        <code>{`\`\`\`mermaid\n${fallbackSource || chart || ''}\n\`\`\``}</code>
      </pre>
    )
  }

  return (
    <div
      className="group relative my-2 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--code-bg)]"
      data-testid="mermaid-diagram"
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-90 transition group-hover:opacity-100">
        <button
          type="button"
          data-testid="expand-canvas"
          aria-label="Expand Canvas"
          title="Expand Canvas"
          onClick={openCanvas}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)]/90 px-2 py-1 text-[11px] text-[var(--muted)] shadow-sm backdrop-blur hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Expand Canvas
        </button>
      </div>
      <button
        type="button"
        aria-label="Open diagram in canvas"
        onClick={openCanvas}
        className="block w-full cursor-zoom-in p-3 text-left"
      >
        <div
          className="[&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </button>
    </div>
  )
}
