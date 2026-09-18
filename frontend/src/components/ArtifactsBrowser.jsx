import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import CanvasDrawer, { detectArtifacts } from './CanvasDrawer'

function previewLabel(content) {
  const artifacts = detectArtifacts(content)
  if (artifacts.mermaid.length) return 'Mermaid diagram'
  if (artifacts.html.length) return 'HTML preview'
  if (artifacts.code.length) {
    const lang = artifacts.code[0]?.language || 'code'
    return `${lang} snippet`
  }
  return 'Document'
}

export default function ArtifactsBrowser() {
  const { artifactLibrary } = useApp()
  const [selectedId, setSelectedId] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const selected = useMemo(
    () => artifactLibrary.find((item) => item.id === selectedId) || null,
    [artifactLibrary, selectedId],
  )

  if (!artifactLibrary.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-medium text-[var(--app-fg)]">Artifacts</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Completed assistant replies with code fences, Mermaid, or HTML will
            appear here for this project.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--border)] px-6 py-4">
        <h2 className="text-lg font-medium text-[var(--app-fg)]">Artifacts</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {artifactLibrary.length} saved from chat in this workspace
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ul className="mx-auto max-w-3xl space-y-2">
          {artifactLibrary.map((item) => {
            const active = item.id === selectedId
            const label = previewLabel(item.content)
            const snippet = (item.content || '').trim().slice(0, 120)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id)
                    setDrawerOpen(true)
                  }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-[var(--border)] bg-[var(--panel-elevated)]'
                      : 'border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-[var(--app-fg)]">
                      {label}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
                    {snippet}
                    {(item.content || '').length > 120 ? '…' : ''}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <CanvasDrawer
        open={drawerOpen && Boolean(selected)}
        onClose={() => setDrawerOpen(false)}
        content={selected?.content || ''}
      />
    </div>
  )
}
