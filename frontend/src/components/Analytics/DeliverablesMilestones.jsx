import { useApp } from '../../context/AppContext'
import DeliverableDownloadButton, {
  defaultFormatForPhase,
} from '../Workspace/DeliverableDownloadButton'

const STATUS_STYLES = {
  completed: 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300',
  in_progress: 'border-amber-800/50 bg-amber-950/30 text-amber-200',
  pending: 'border-[var(--border)] bg-[var(--chip)] text-[var(--muted)]',
}

function statusLabel(status) {
  const s = String(status || 'pending').toLowerCase()
  if (s === 'completed' || s === 'done') return 'completed'
  if (s === 'in_progress' || s === 'active' || s === 'partial') return 'in_progress'
  return 'pending'
}

export default function DeliverablesMilestones({ phases = [] }) {
  const { activeWorkspace } = useApp()
  const items = []
  for (const phase of phases) {
    const status = statusLabel(phase.status)
    const deliverables = Array.isArray(phase.deliverables) ? phase.deliverables : []
    if (!deliverables.length) {
      items.push({
        id: `phase-${phase.id}`,
        title: phase.name || `Phase ${phase.id}`,
        detail: 'No deliverables detected yet',
        status,
        phaseId: phase.id,
      })
      continue
    }
    for (const deliverable of deliverables.slice(0, 4)) {
      items.push({
        id: `${phase.id}-${deliverable}`,
        title: String(deliverable),
        detail: `Phase ${phase.id} · ${phase.name || ''}`,
        status,
        phaseId: phase.id,
      })
    }
  }

  const uniquePhases = []
  const seen = new Set()
  for (const phase of phases) {
    const id = Number(phase.id)
    if (!seen.has(id)) {
      seen.add(id)
      uniquePhases.push(phase)
    }
  }

  if (!items.length) {
    return (
      <section
        className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-4"
        data-testid="deliverables-milestones"
      >
        <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
          Deliverables & milestones
        </h3>
        <p className="text-sm text-[var(--muted)]">No phase deliverables in the audit report yet.</p>
      </section>
    )
  }

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-4"
      data-testid="deliverables-milestones"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Deliverables & milestones
        </h3>
        <div className="flex flex-wrap gap-2">
          {uniquePhases.slice(0, 3).map((phase) => (
            <DeliverableDownloadButton
              key={`dl-${phase.id}`}
              workspaceId={activeWorkspace?.id}
              phase={phase.id}
              format={defaultFormatForPhase(phase.id)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
            />
          ))}
        </div>
      </div>
      <ol className="relative space-y-0 border-l border-[var(--border)] pl-4">
        {items.map((item) => (
          <li key={item.id} className="relative pb-4 last:pb-0">
            <span className="absolute -left-[1.28rem] top-1.5 h-2.5 w-2.5 rounded-full border border-[var(--border)] bg-[var(--panel)]" />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--app-fg)]" title={item.title}>
                  {item.title}
                </p>
                <p className="text-xs text-[var(--muted)]">{item.detail}</p>
              </div>
              <span
                className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  STATUS_STYLES[item.status] || STATUS_STYLES.pending
                }`}
              >
                {item.status.replace('_', ' ')}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
