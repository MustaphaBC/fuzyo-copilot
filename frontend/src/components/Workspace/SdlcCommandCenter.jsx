import { CheckCircle2, Circle, CircleDot, Play, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SDLC_PHASES, useApp } from '../../context/AppContext'
import { useWorkspaceAnalytics } from '../../hooks/useWorkspaceAnalytics'
import ErrorState from '../UI/ErrorState'
import DeliverableDownloadButton, { defaultFormatForPhase } from './DeliverableDownloadButton'
import ExecutePhaseModal from './ExecutePhaseModal'

function normalizePhases(report) {
  const byId = new Map((report?.phases || []).map((phase) => [Number(phase.id), phase]))
  return SDLC_PHASES.map((base) => {
    const found = byId.get(base.id)
    const pct = Math.max(0, Math.min(100, Number(found?.pct) || 0))
    return {
      id: base.id,
      name: found?.name || base.label,
      pct,
      status: found?.status || (pct >= 100 ? 'done' : pct > 0 ? 'in_progress' : 'todo'),
      deliverables: found?.deliverables || [],
    }
  })
}

function statusKind(phase) {
  if (phase.pct >= 100 || phase.status === 'done' || phase.status === 'complete') return 'done'
  if (phase.pct > 0) return 'in_progress'
  return 'todo'
}

function StatusIcon({ kind }) {
  switch (kind) {
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
    case 'in_progress':
      return <CircleDot className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
    case 'todo':
      return <Circle className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
    default: {
      const exhaustive = kind
      throw new Error(`Unknown phase status: ${exhaustive}`)
    }
  }
}

function PhaseCard({ phase, active, selected, onSelect }) {
  const kind = statusKind(phase)
  return (
    <button
      type="button"
      onClick={() => onSelect(phase)}
      data-testid={`sdlc-card-${phase.id}`}
      className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition hover:bg-[var(--hover)] ${
        selected ? 'border-[var(--accent)] bg-[var(--panel-elevated)]' : 'border-[var(--border)] bg-[var(--panel)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Phase {String(phase.id).padStart(2, '0')}
          {active ? ' · active' : ''}
        </span>
        <StatusIcon kind={kind} />
      </div>
      <span className="text-sm font-medium text-[var(--app-fg)]">{phase.name}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--chip)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${phase.pct}%` }} />
      </div>
      <span className="text-xs text-[var(--muted)]">
        {phase.pct.toFixed(0)}% · {phase.deliverables.length} deliverables detected
      </span>
    </button>
  )
}

export default function SdlcCommandCenter() {
  const { activeWorkspace, sdlcPhase } = useApp()
  const { data, loading, error, reload, rescan } = useWorkspaceAnalytics(activeWorkspace?.id)
  const [selectedId, setSelectedId] = useState(null)
  const [executeOpen, setExecuteOpen] = useState(false)

  const phases = useMemo(() => normalizePhases(data?.sdlc_audit_report), [data])
  const selected = phases.find((phase) => phase.id === (selectedId ?? sdlcPhase)) || phases[0]
  const overall = Number(data?.sdlc_completion_pct) || 0

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <ErrorState title="SDLC status unavailable" description={error} onRetry={reload} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row" data-testid="sdlc-command-center">
      <div className="min-w-0 flex-1 space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-[var(--app-fg)]">SDLC Command Center</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Overall progress {overall.toFixed(0)}% · active phase {sdlcPhase}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={rescan}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-50"
              data-testid="sdlc-scan-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {loading ? 'Scanning…' : 'Scan'}
            </button>
            <button
              type="button"
              onClick={() => setExecuteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90"
              data-testid="sdlc-execute-button"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Execute phase {selected.id}
            </button>
          </div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-[var(--chip)]" aria-label={`Overall ${overall.toFixed(0)}%`}>
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, overall)}%` }} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {phases.map((phase) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              active={phase.id === sdlcPhase}
              selected={phase.id === selected.id}
              onSelect={(item) => setSelectedId(item.id)}
            />
          ))}
        </div>
      </div>

      <aside
        className="shrink-0 space-y-4 border-t border-[var(--border)] bg-[var(--panel)] p-5 lg:w-80 lg:border-l lg:border-t-0"
        data-testid="sdlc-phase-detail"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Phase {String(selected.id).padStart(2, '0')}
          </p>
          <h3 className="text-sm font-semibold text-[var(--app-fg)]">{selected.name}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {selected.pct.toFixed(0)}% · {statusKind(selected).replace('_', ' ')}
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">Detected deliverables</p>
          {selected.deliverables.length ? (
            <ul className="space-y-1">
              {selected.deliverables.map((item) => (
                <li
                  key={item}
                  className="truncate rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5 text-xs text-[var(--app-fg)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">None yet — execute the phase to generate them.</p>
          )}
        </div>
        <div className="space-y-2">
          <DeliverableDownloadButton
            workspaceId={activeWorkspace?.id}
            phase={selected.id}
            format={defaultFormatForPhase(selected.id)}
          />
          <button
            type="button"
            onClick={() => setExecuteOpen(true)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
          >
            Review prompt &amp; execute
          </button>
        </div>
      </aside>

      <ExecutePhaseModal open={executeOpen} phase={selected} onClose={() => setExecuteOpen(false)} />
    </div>
  )
}
