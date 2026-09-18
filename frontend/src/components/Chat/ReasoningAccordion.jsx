import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export default function ReasoningAccordion({ meta }) {
  const [open, setOpen] = useState(false)
  const rag = meta?.rag
  const routing = meta?.routing
  const retry = meta?.retry
  if (!rag && !routing && !retry) return null

  return (
    <div
      className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)]"
      data-testid="reasoning-accordion"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] hover:text-[var(--app-fg)]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Reasoning & Executed Tools
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[var(--border)] px-3 py-3 text-xs text-[var(--app-fg)]">
          {routing ? (
            <div>
              <p className="mb-1 uppercase tracking-wide text-[var(--muted)]">Routing</p>
              <p>
                {routing.target_client || 'unknown'}
                {routing.selected_provider ? ` · ${routing.selected_provider}` : ''}
                {routing.selected_model ? ` · ${routing.selected_model}` : ''}
              </p>
            </div>
          ) : null}
          {rag ? (
            <div>
              <p className="mb-1 uppercase tracking-wide text-[var(--muted)]">
                RAG ({rag.status || 'n/a'} · {rag.hit_count ?? 0} hits)
              </p>
              {rag.query ? (
                <p className="mb-1 text-[var(--muted)]">Query: {rag.query}</p>
              ) : null}
              {rag.snippets?.length ? (
                <ul className="space-y-1">
                  {rag.snippets.map((snippet, index) => (
                    <li
                      key={index}
                      className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[var(--muted)]"
                    >
                      {snippet}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[var(--muted)]">No snippets for this turn.</p>
              )}
            </div>
          ) : null}
          {retry ? (
            <div>
              <p className="mb-1 uppercase tracking-wide text-[var(--muted)]">
                Retry (attempt {retry.attempt})
              </p>
              <p className="text-amber-300">Score was {retry.attempt_score}/10</p>
              <p className="text-[var(--muted)]">{retry.reason}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
