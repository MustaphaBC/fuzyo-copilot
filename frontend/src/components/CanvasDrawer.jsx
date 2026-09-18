import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import MermaidDiagram from './Chat/MermaidDiagram'

const HTML_LANGS = new Set(['html', 'htm', 'jsx', 'tsx', 'react'])

export function detectArtifacts(content) {
  const source = content || ''
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  const mermaidBlocks = []
  const htmlBlocks = []
  const codeBlocks = []
  let lastIndex = 0
  const proseParts = []
  let match

  while ((match = fence.exec(source)) !== null) {
    if (match.index > lastIndex) {
      proseParts.push(source.slice(lastIndex, match.index))
    }
    const language = (match[1] || '').trim().toLowerCase() || 'text'
    const body = match[2] || ''
    if (language === 'mermaid') {
      mermaidBlocks.push(body.trim())
    } else if (HTML_LANGS.has(language)) {
      htmlBlocks.push({ language, value: body })
    } else {
      codeBlocks.push({ language, value: body })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < source.length) {
    proseParts.push(source.slice(lastIndex))
  }

  const prose = proseParts.join('\n').trim()
  return {
    mermaid: mermaidBlocks,
    html: htmlBlocks,
    code: codeBlocks,
    prose,
    hasArtifacts:
      mermaidBlocks.length > 0 ||
      htmlBlocks.length > 0 ||
      codeBlocks.length > 0 ||
      prose.length > 0,
  }
}

function simpleDocPreview(text) {
  if (!text.trim()) {
    return <p className="text-sm text-[var(--muted)]">No document content.</p>
  }
  return (
    <div className="space-y-2 text-sm text-[var(--app-fg)] whitespace-pre-wrap leading-relaxed">
      {text}
    </div>
  )
}

export default function CanvasDrawer({ open, onClose, content }) {
  const artifacts = useMemo(() => detectArtifacts(content), [content])
  const tabs = useMemo(() => {
    const list = []
    if (artifacts.mermaid.length) list.push({ id: 'diagram', label: 'Diagram' })
    if (artifacts.html.length) list.push({ id: 'preview', label: 'Preview' })
    if (artifacts.code.length) list.push({ id: 'code', label: 'Code' })
    if (artifacts.prose) list.push({ id: 'doc', label: 'Doc' })
    return list
  }, [artifacts])

  const [activeTab, setActiveTab] = useState('diagram')

  useEffect(() => {
    if (!tabs.length) return
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id)
    }
  }, [tabs, activeTab])

  useEffect(() => {
    if (artifacts.mermaid.length) {
      setActiveTab('diagram')
    } else if (tabs[0]) {
      setActiveTab(tabs[0].id)
    }
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps -- reset on new content

  if (!open) return null

  return (
    <div className="absolute inset-y-0 right-0 z-30 w-full max-w-xl border-l border-[var(--border)] bg-[var(--panel)] shadow-xl flex flex-col">
      <div className="h-14 shrink-0 px-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--app-fg)]">Canvas</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          aria-label="Close canvas"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!tabs.length ? (
        <div className="p-4 text-sm text-[var(--muted)]">No artifacts to preview yet.</div>
      ) : (
        <>
          <div className="shrink-0 px-3 pt-3 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--app-fg)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'diagram'
              ? artifacts.mermaid.map((chart, index) => (
                  <MermaidDiagram key={`m-${index}`} chart={chart} />
                ))
              : null}

            {activeTab === 'preview'
              ? artifacts.html.map((block, index) => (
                  <iframe
                    key={`h-${index}`}
                    title={`html-preview-${index}`}
                    sandbox=""
                    srcDoc={block.value}
                    className="w-full min-h-[240px] rounded-md border border-[var(--border)] bg-white"
                  />
                ))
              : null}

            {activeTab === 'code'
              ? artifacts.code.map((block, index) => (
                  <div
                    key={`c-${index}`}
                    className="rounded-md border border-[var(--border)] overflow-hidden"
                  >
                    <div className="px-3 py-1.5 text-xs text-[var(--muted)] border-b border-[var(--border)]">
                      {block.language}
                    </div>
                    <pre className="overflow-x-auto p-3 text-sm text-[var(--app-fg)] bg-[var(--code-bg)]">
                      <code>{block.value}</code>
                    </pre>
                  </div>
                ))
              : null}

            {activeTab === 'doc' ? simpleDocPreview(artifacts.prose) : null}
          </div>
        </>
      )}
    </div>
  )
}
