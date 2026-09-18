const STATUS_STYLES = {
  completed: 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200',
  in_progress: 'border-amber-800/70 bg-amber-950/30 text-amber-100',
  pending: 'border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)]',
}

export default function SDLCWorkflowGraph({ phases = [], onPhaseClick }) {
  return (
    <section className="space-y-3" data-testid="sdlc-workflow-graph">
      <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">SDLC workflow</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {phases.map((phase) => {
          const status = phase.status || 'pending'
          return (
            <button
              key={phase.id}
              type="button"
              data-testid={`sdlc-phase-node-${phase.id}`}
              onClick={() => onPhaseClick?.(phase)}
              className={`rounded-lg border px-3 py-3 text-left transition hover:opacity-90 ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide opacity-80">
                  Phase {phase.id}
                </span>
                <span className="text-[11px]">{Number(phase.pct || 0).toFixed(0)}%</span>
              </div>
              <p className="mt-1 text-sm font-medium text-[var(--app-fg)]">
                {phase.name || `Phase ${phase.id}`}
              </p>
              <p className="mt-1 text-[11px] capitalize opacity-80">{status.replace('_', ' ')}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
