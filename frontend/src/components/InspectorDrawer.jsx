import { X } from 'lucide-react'

const MAX_ATTEMPTS = 3

const ROUTE_REASON_LABELS = {
  force_confidential: 'Force confidential',
  secrets_detected: 'Secrets detected',
  classifier_unavailable: 'Classifier unavailable (fail-closed)',
  sensitivity_threshold: 'Above sensitivity threshold',
  cloud_allowed: 'Cloud allowed',
}

const RAG_SOURCE_LABELS = {
  hybrid_supabase: 'Hybrid (pgvector + FTS, RRF)',
  fallback_bm25: 'BM25 fallback (local files)',
  none: 'None',
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[var(--border)] text-sm">
      <span className="text-[var(--muted)] shrink-0">{label}</span>
      <span className="text-[var(--app-fg)] text-right break-all">{value ?? '—'}</span>
    </div>
  )
}

function SectionTitle({ children, first = false }) {
  return (
    <p
      className={`text-xs uppercase tracking-wide text-[var(--muted)] mb-2 ${first ? '' : 'mt-4'}`}
    >
      {children}
    </p>
  )
}

function passLabel(value) {
  if (value === true) return 'pass'
  if (value === false) return 'fail'
  return undefined
}

function streamState(meta, streaming) {
  if (!meta) return undefined
  if (streaming) {
    if (!meta.routing) return 'routing'
    if (!meta.rag) return 'retrieving'
    if (!meta.quality) return 'generating'
    return 'validating'
  }
  if (meta.stopped) return 'stopped'
  if (meta.error) return 'error'
  return 'completed'
}

export default function InspectorDrawer({ open, onClose, meta, streaming = false, docked = false }) {
  if (!open) return null

  const routing = meta?.routing
  const rag = meta?.rag
  const quality = meta?.quality
  const skill = meta?.skill
  const retry = meta?.retry
  const fallback = meta?.fallback
  const hasMetrics = Boolean(routing || rag || quality || skill || retry)

  const layout = docked
    ? 'absolute inset-y-0 right-0 z-20 w-full max-w-sm shadow-xl xl:static xl:z-auto xl:w-80 xl:max-w-none xl:shrink-0 xl:shadow-none'
    : 'absolute inset-y-0 right-0 z-20 w-full max-w-sm shadow-xl'

  const reranker =
    rag?.reranker === 'flashrank'
      ? 'FlashRank'
      : rag?.source === 'hybrid_supabase' && rag?.hit_count > 0
        ? 'FlashRank'
        : rag
          ? 'none'
          : undefined

  return (
    <aside
      className={`${layout} border-l border-[var(--border)] bg-[var(--panel)] flex flex-col`}
      data-testid="inspector-panel"
      aria-label="Inspector"
    >
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
            <SectionTitle first>Routing</SectionTitle>
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
            <Row
              label="Reason"
              value={
                routing?.route_reason
                  ? ROUTE_REASON_LABELS[routing.route_reason] ?? routing.route_reason
                  : undefined
              }
            />
            <Row
              label="Requires RAG"
              value={typeof routing?.requires_rag === 'boolean' ? String(routing.requires_rag) : undefined}
            />
            {fallback ? (
              <Row
                label="Fallback"
                value={`${fallback.from_provider} → ${fallback.to_provider} (${fallback.reason})`}
              />
            ) : null}

            <SectionTitle>Skill</SectionTitle>
            <Row label="Mode" value={skill?.mode || 'none'} />

            <SectionTitle>RAG</SectionTitle>
            <Row label="Status" value={rag?.status} />
            <Row
              label="Source"
              value={rag?.source ? RAG_SOURCE_LABELS[rag.source] ?? rag.source : undefined}
            />
            <Row label="Reranker" value={reranker} />
            <Row label="Hits" value={rag?.hit_count} />
            <Row label="Files" value={rag?.files?.length ? rag.files.join(', ') : undefined} />
            <Row label="Query" value={rag?.query || undefined} />

            <SectionTitle>Quality</SectionTitle>
            <Row label="Valid" value={quality ? String(quality.is_valid) : undefined} />
            <Row label="Tier 1" value={passLabel(quality?.tier1_schema_pass)} />
            <Row label="Tier 2" value={passLabel(quality?.tier2_heuristic_pass)} />
            <Row label="Tier 3" value={quality?.tier3_score} />
            <Row label="Feedback" value={quality?.feedback || undefined} />

            <SectionTitle>Retry</SectionTitle>
            <Row label="Attempt" value={retry?.attempt} />
            <Row label="Max attempts" value={MAX_ATTEMPTS} />
            <Row label="Score" value={retry?.attempt_score} />
            <Row label="Reason" value={retry?.reason || undefined} />

            <SectionTitle>Stream</SectionTitle>
            <Row label="State" value={streamState(meta, streaming)} />
            <Row label="Tokens" value={meta?.tokenCount} />
            <Row
              label="Latency"
              value={typeof meta?.latencyMs === 'number' ? `${meta.latencyMs} ms` : undefined}
            />
          </>
        )}
      </div>
    </aside>
  )
}
