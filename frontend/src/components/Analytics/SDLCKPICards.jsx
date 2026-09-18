import { SDLC_PHASES, useApp } from '../../context/AppContext'

function clampPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function Card({ label, children }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-4">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      {children}
    </div>
  )
}

export default function SDLCKPICards({ data }) {
  const { sdlcPhase } = useApp()
  const scores = data?.sdlc_audit_report?.scores || {}
  const codeHealth = clampPct(scores.code_quality)
  const readiness = clampPct(
    (
      clampPct(scores.rag_readiness) +
      clampPct(scores.security) +
      clampPct(scores.test_completeness)
    ) / 3,
  )
  const phaseId = Number(data?.active_sdlc_phase) || sdlcPhase || 1
  const phaseMeta = SDLC_PHASES.find((p) => p.id === phaseId)
  const sdlcPct = clampPct(data?.sdlc_completion_pct)

  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="sdlc-kpi-cards"
    >
      <Card label="Overall code health">
        <p className="text-2xl font-semibold text-[var(--app-fg)]">{codeHealth.toFixed(0)}%</p>
        <p className="mt-1 text-xs text-[var(--muted)]">From audit code quality score</p>
      </Card>

      <Card label="Active SDLC phase">
        <p className="text-sm font-medium text-[var(--app-fg)]">
          Phase {phaseId}
          {phaseMeta ? ` — ${phaseMeta.label}` : ''}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--panel)]">
          <div
            className="h-full rounded-full bg-[var(--muted)]"
            style={{ width: `${sdlcPct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">{sdlcPct.toFixed(0)}% phase coverage</p>
      </Card>

      <Card label="RAG knowledge base">
        <p className="text-2xl font-semibold text-[var(--app-fg)]">
          {data?.document_count ?? 0}
          <span className="ml-1 text-sm font-normal text-[var(--muted)]">docs</span>
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {data?.chunk_count ?? 0} vectors · {data?.thread_count ?? 0} threads ·{' '}
          {data?.prompt_count ?? 0} prompts
        </p>
      </Card>

      <Card label="Audit readiness">
        <p className="text-2xl font-semibold text-[var(--app-fg)]">{readiness.toFixed(0)}%</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          RAG {clampPct(scores.rag_readiness).toFixed(0)}% · Sec{' '}
          {clampPct(scores.security).toFixed(0)}% · Tests{' '}
          {clampPct(scores.test_completeness).toFixed(0)}%
        </p>
      </Card>
    </section>
  )
}
