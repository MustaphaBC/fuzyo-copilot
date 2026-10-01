import { FileMinus, FilePen, FilePlus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import DiffReviewPanel from '../Ide/DiffReviewPanel'
import EmptyState from '../UI/EmptyState'

function classify(diff) {
  if (!diff) return null
  if (!diff.original) return 'added'
  if (!diff.proposed) return 'deleted'
  return 'modified'
}

const GROUPS = [
  { id: 'modified', label: 'Modified', icon: FilePen },
  { id: 'added', label: 'Added', icon: FilePlus },
  { id: 'deleted', label: 'Deleted', icon: FileMinus },
]

export default function ChangesTab() {
  const { pendingDiff, openProject, activeWorkspace } = useApp()
  const kind = classify(pendingDiff)

  return (
    <div className="flex min-h-0 flex-1" data-testid="changes-tab">
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--panel)] p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Changes
        </p>
        {GROUPS.map((group) => {
          const Icon = group.icon
          return (
            <div key={group.id} className="mb-3">
              <p className="mb-1 text-xs text-[var(--muted)]">{group.label}</p>
              {kind === group.id ? (
                <p className="flex items-center gap-1.5 truncate rounded-md bg-[var(--panel-elevated)] px-2 py-1 text-xs text-[var(--app-fg)]">
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{pendingDiff.path}</span>
                </p>
              ) : (
                <p className="px-2 text-[11px] text-[var(--muted)]">None</p>
              )}
            </div>
          )
        })}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {pendingDiff ? (
          <DiffReviewPanel />
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <EmptyState
              title="No pending changes"
              description="Use “Apply & Sync to Host” on an assistant code block in the Files tab to queue a change for review here."
              action={
                <button
                  type="button"
                  onClick={() => openProject(activeWorkspace, 'files')}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
                >
                  Open Files
                </button>
              }
            />
          </div>
        )}
      </section>
    </div>
  )
}
