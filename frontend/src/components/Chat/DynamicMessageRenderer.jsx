import AdminLockCard from './AdminLockCard'
import CodeDiffViewer from './CodeDiffViewer'
import MarkdownContent from './MarkdownContent'
import MermaidDiagram from './MermaidDiagram'
import ReasoningAccordion from './ReasoningAccordion'
import SaveLocalButton from './SaveLocalButton'

export function splitMessageParts(content) {
  const parts = []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match
  while ((match = fence.exec(content || '')) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    const language = (match[1] || '').trim().toLowerCase() || 'text'
    parts.push({
      type: language === 'mermaid' ? 'mermaid' : 'code',
      language,
      value: match[2],
    })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < (content || '').length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return parts.length ? parts : [{ type: 'text', value: content || '' }]
}

export default function DynamicMessageRenderer({
  content,
  previousCodeByLang = {},
  adminLock,
  meta,
  showReasoning = false,
}) {
  const parts = splitMessageParts(content)

  return (
    <div className="text-sm leading-relaxed" data-testid="dynamic-message-renderer">
      {parts.map((part, index) => {
        if (part.type === 'mermaid') {
          return (
            <div
              key={index}
              className="my-2 space-y-1 rounded-lg border border-[var(--border)]/60 bg-[var(--panel-elevated)]/40 p-2"
              data-testid="inline-artifact-card"
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  Visual artifact · Mermaid
                </p>
                <SaveLocalButton
                  content={part.value}
                  fileName="architecture_diagram.mermaid"
                  language="mermaid"
                />
              </div>
              <MermaidDiagram chart={part.value} title="Architecture flowchart" />
            </div>
          )
        }
        if (part.type === 'code') {
          const prev = previousCodeByLang[part.language] || ''
          return (
            <CodeDiffViewer
              key={index}
              language={part.language}
              value={part.value}
              previousValue={prev}
            />
          )
        }
        return (
          <div key={index} className="space-y-1">
            {part.value?.trim() ? (
              <div className="flex justify-end">
                <SaveLocalButton
                  content={part.value}
                  fileName="notes.md"
                  language="markdown"
                />
              </div>
            ) : null}
            <MarkdownContent content={part.value} />
          </div>
        )
      })}
      {adminLock ? <AdminLockCard tool={adminLock.tool} message={adminLock.message} /> : null}
      {showReasoning ? <ReasoningAccordion meta={meta} /> : null}
    </div>
  )
}
