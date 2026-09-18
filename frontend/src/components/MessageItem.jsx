import { Copy, Pencil, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import DynamicMessageRenderer, { splitMessageParts } from './Chat/DynamicMessageRenderer'

function collectPreviousCode(messages, beforeId) {
  const map = {}
  for (const msg of messages || []) {
    if (msg.id === beforeId) break
    if (msg.role !== 'assistant') continue
    for (const part of splitMessageParts(msg.content || '')) {
      if (part.type === 'code' && part.language) {
        map[part.language] = part.value
      }
    }
  }
  return map
}

export default function MessageItem({
  id,
  role,
  content,
  routingBadge,
  adminLock,
  isStreaming,
  isRetrying = false,
  retryScore,
  onEditUser,
  onRegenerate,
  messages = [],
  meta = null,
  isLatestAssistant = false,
}) {
  const isUser = role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content || '')
  const [copiedMsg, setCopiedMsg] = useState(false)

  const previousCodeByLang = useMemo(
    () => (isUser ? {} : collectPreviousCode(messages, id)),
    [isUser, messages, id],
  )

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content || '')
      setCopiedMsg(true)
      setTimeout(() => setCopiedMsg(false), 1500)
    } catch {
      setCopiedMsg(false)
    }
  }

  return (
    <div className={`group flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`min-w-0 max-w-[85%] overflow-x-auto rounded-lg border px-3 py-2 ${
          isUser
            ? 'border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--app-fg)]'
            : 'border-[var(--border)] bg-[var(--panel)] text-[var(--app-fg)]'
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">
          <span>{isUser ? 'You' : 'Assistant'}</span>
          {!isUser && routingBadge ? (
            <span
              className={`rounded border px-1.5 py-0.5 normal-case tracking-normal ${
                routingBadge === 'LOCAL_STUB'
                  ? 'border-emerald-800 text-emerald-400'
                  : 'border-sky-900 text-sky-400'
              }`}
            >
              {routingBadge === 'LOCAL_STUB' ? '[LOCAL STUB]' : '[CLOUD]'}
            </span>
          ) : null}
          {isStreaming ? <span className="normal-case text-[var(--muted)]">streaming…</span> : null}
          {isRetrying && !isUser ? (
            <span
              data-testid="retry-badge"
              className="inline-flex items-center gap-1 rounded border border-amber-700/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber-300"
            >
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
              Retrying ({retryScore}/10)…
            </span>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--chip)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none"
              data-testid="message-edit-input"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
                onClick={() => {
                  setEditing(false)
                  setDraft(content || '')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-[var(--panel-elevated)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
                data-testid="message-edit-submit"
                onClick={() => {
                  const next = draft.trim()
                  if (!next) return
                  setEditing(false)
                  onEditUser?.(id, next)
                }}
              >
                Save & regenerate
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{content}</div>
        ) : (
          <DynamicMessageRenderer
            content={content}
            previousCodeByLang={previousCodeByLang}
            adminLock={adminLock}
            meta={meta}
            showReasoning={isLatestAssistant && !isStreaming}
          />
        )}

        {!isStreaming && !editing ? (
          <div className="mt-2 flex flex-wrap gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
              data-testid="copy-message"
            >
              <Copy className="h-3 w-3" />
              {copiedMsg ? 'Copied' : 'Copy'}
            </button>
            {isUser ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(content || '')
                  setEditing(true)
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
                data-testid="edit-message"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRegenerate?.(id)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
                data-testid="regenerate-message"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
