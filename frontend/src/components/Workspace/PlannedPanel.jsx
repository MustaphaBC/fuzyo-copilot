import EmptyState from '../UI/EmptyState'

const PLANNED_COPY = {
  agent: 'Autonomous multi-step agent runs are on the roadmap. Use Cowork mode with skills in chat meanwhile.',
  git: 'Branch, commit and history management requires sandboxed git execution on the server and is not available yet.',
  cicd: 'Pipeline status and deployment triggers will appear here once the CI/CD connector ships. The GitHub Actions workflow runs in the repository today.',
  execute: 'Running commands and test suites from the browser requires a sandboxed executor and is not available yet.',
}

export default function PlannedPanel({ tab, label }) {
  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid={`planned-panel-${tab}`}>
      <EmptyState
        title={`${label} — Planned`}
        description={PLANNED_COPY[tab] || 'This workspace panel is on the roadmap.'}
        action={
          <span className="rounded-md border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Planned
          </span>
        }
      />
    </div>
  )
}
