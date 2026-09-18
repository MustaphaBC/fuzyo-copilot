import { X } from 'lucide-react'

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[var(--border)] text-sm">
      <span className="text-[var(--muted)] shrink-0">{label}</span>
      <span className="text-[var(--app-fg)] text-right break-all">{value ?? '—'}</span>
    </div>
  )
}

export default function InspectorDrawer({ open, onClose, meta }) {
  if (!open) return null

  const routing = meta?.routing
  const rag = meta?.rag
  const quality = meta?.quality
  const skill = meta?.skill
  const retry = meta?.retry
  const hasMetrics = Boolean(routing || rag || quality || skill || retry)

  return (
    <div className="absolute inset-y-0 right-0 z-20 w-full max-w-sm border-l border-[var(--border)] bg-[var(--panel)] shadow-xl flex flex-col">
      <div className="h-14 shrink-0 px-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--app-fg)]">Inspector</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!hasMetrics ? (
          <p className="text-sm text-[var(--muted)]">No request metrics yet. Send a message to populate.</p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">Routing</p>
            <Row label="Client" value={routing?.target_client} />
            <Row label="Provider" value={routing?.selected_provider} />
            <Row label="Model" value={routing?.selected_model} />
            <Row
              label="Sensitivity"
              value={
                typeof routing?.sensitivity_score === 'number'
                  ? routing.sensitivity_score.toFixed(2)
                  : undefined
              }
            />
            <Row
              label="Secrets"
              value={
                routing?.detected_secrets?.length
                  ? routing.detected_secrets.join(', ')
                  : 'none'
              }
            />

            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mt-4 mb-2">Skill</p>
            <Row label="Mode" value={skill?.mode || 'none'} />

            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mt-4 mb-2">RAG</p>
            <Row label="Status" value={rag?.status} />
            <Row label="Hits" value={rag?.hit_count} />
            <Row label="Query" value={rag?.query || undefined} />

            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mt-4 mb-2">Quality</p>
            <Row label="Valid" value={quality ? String(quality.is_valid) : undefined} />
            <Row label="Tier 1" value={quality ? String(quality.tier1_schema_pass) : undefined} />
            <Row label="Tier 2" value={quality ? String(quality.tier2_heuristic_pass) : undefined} />
            <Row label="Tier 3" value={quality?.tier3_score} />
            <Row label="Feedback" value={quality?.feedback || undefined} />

            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mt-4 mb-2">Retry</p>
            <Row label="Attempt" value={retry?.attempt} />
            <Row label="Score" value={retry?.attempt_score} />
            <Row label="Reason" value={retry?.reason || undefined} />

            <p className="text-xs uppercase tracking-wide text-[var(--muted)] mt-4 mb-2">Stream</p>
            <Row label="Tokens" value={meta?.tokenCount} />
            <Row
              label="Latency"
              value={typeof meta?.latencyMs === 'number' ? `${meta.latencyMs} ms` : undefined}
            />
          </>
        )}
      </div>
    </div>
  )
}
