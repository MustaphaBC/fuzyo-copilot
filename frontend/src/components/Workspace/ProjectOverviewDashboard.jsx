import { X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import DeliverableDownloadButton, {
  defaultFormatForPhase,
} from './DeliverableDownloadButton'
import SDLCWorkflowGraph from './SDLCWorkflowGraph'
import TechStackBar from './TechStackBar'

function ScoreGrid({ scores = {} }) {
  const entries = [
    ['Code quality', scores.code_quality],
    ['RAG readiness', scores.rag_readiness],
    ['Security', scores.security],
    ['Test completeness', scores.test_completeness],
  ]
  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Audit scores</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map(([label, value]) => {
          const pct = Math.max(0, Math.min(100, Number(value) || 0))
          return (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] p-3">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-[var(--app-fg)]">{label}</span>
                <span className="text-[var(--muted)]">{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--panel)]">
                <div
                  className="h-full rounded-full bg-[var(--muted)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function ProjectOverviewDashboard({ report, fallbackTechStack = [] }) {
  const { activeWorkspace, setSdlcPhase, setViewMode, seedComposer } = useApp()
  const [selected, setSelected] = useState(null)

  const languages = report?.languages || []
  const frameworks = report?.frameworks?.length
    ? report.frameworks
    : fallbackTechStack
  const phases = report?.phases || []
  const scores = report?.scores || {}

  const executePhase = () => {
    if (!selected) return
    const phaseId = Number(selected.id) || 1
    setSdlcPhase(phaseId)
    setViewMode('chat')
    seedComposer(
      `Assist with SDLC phase ${phaseId} (${selected.name}). Current progress ~${Number(selected.pct || 0).toFixed(0)}%. Deliverables detected: ${(selected.deliverables || []).slice(0, 5).join(', ') || 'none yet'}. Propose next concrete steps.`,
    )
    setSelected(null)
  }

  return (
    <div className="space-y-8" data-testid="project-overview-dashboard">
      <div className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
        <span>{report?.file_count ?? 0} files analyzed</span>
        <span>
          {report?.size_bytes
            ? `${(Number(report.size_bytes) / 1024).toFixed(1)} KB estimated`
            : 'Size n/a'}
        </span>
      </div>

      <TechStackBar languages={languages} frameworks={frameworks} />
      <SDLCWorkflowGraph phases={phases} onPhaseClick={setSelected} />
      <ScoreGrid scores={scores} />

      {selected ? (
        <div
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-2xl"
          data-testid="phase-drawer"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Phase {selected.id}
              </p>
              <h3 className="text-sm font-medium text-[var(--app-fg)]">{selected.name}</h3>
            </div>
            <button
              type="button"
              aria-label="Close phase drawer"
              className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"
              onClick={() => setSelected(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            <p className="text-[var(--muted)]">
              Status: <span className="text-[var(--app-fg)] capitalize">{selected.status}</span> ·{' '}
              {Number(selected.pct || 0).toFixed(0)}%
            </p>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
                Deliverables
              </p>
              {selected.deliverables?.length ? (
                <ul className="space-y-1 text-[var(--app-fg)]">
                  {selected.deliverables.map((item) => (
                    <li
                      key={item}
                      className="truncate rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5 text-xs"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">No deliverables detected yet.</p>
              )}
            </div>
          </div>
          <div className="border-t border-[var(--border)] space-y-2 p-4">
            <DeliverableDownloadButton
              workspaceId={activeWorkspace?.id}
              phase={selected.id}
              format={defaultFormatForPhase(selected.id)}
            />
            {Number(selected.id) !== 5 && Number(selected.id) !== 6 ? (
              <DeliverableDownloadButton
                workspaceId={activeWorkspace?.id}
                phase={selected.id}
                format="pdf"
                label="Download (.pdf)"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
              />
            ) : null}
            {Number(selected.id) === 3 ? (
              <DeliverableDownloadButton
                workspaceId={activeWorkspace?.id}
                phase={3}
                format="raw"
                label="Download architecture (.mermaid/raw)"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
              />
            ) : null}
            <button
              type="button"
              data-testid="execute-phase-assistant"
              onClick={executePhase}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
            >
              Execute Phase Assistant
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
