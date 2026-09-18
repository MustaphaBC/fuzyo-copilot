import { SDLC_PHASES, useApp } from '../context/AppContext'

export default function Header() {
  const { activeWorkspace, sdlcPhase, skillsMode } = useApp()
  const phase = SDLC_PHASES.find((item) => item.id === sdlcPhase)

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--panel)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-sm font-medium text-[var(--app-fg)]">
          {activeWorkspace?.name || 'No project'}
        </span>
        <span className="hidden truncate rounded-md border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-xs text-[var(--muted)] sm:inline">
          Phase {sdlcPhase} — {phase?.label ?? 'Unknown'}
        </span>
        {skillsMode ? (
          <span className="hidden rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] md:inline">
            /{skillsMode}
          </span>
        ) : null}
      </div>
    </header>
  )
}
