import { useUI } from '../../context/UIContext'

const TOOL_LABELS = {
  deploy_to_production: 'Deploy to Production',
  purge_workspace_rag: 'Purge Workspace RAG',
}

export default function AdminLockCard({ tool, message }) {
  const { pushToast } = useUI()
  const label = TOOL_LABELS[tool] || tool || 'Admin tool'

  return (
    <div
      data-testid="admin-lock-card"
      className="mt-3 rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-[var(--app-fg)]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden>
          🔒
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-100">Admin approval required</p>
          <p className="mt-1 text-[var(--muted)]">
            {message ||
              `“${label}” is restricted to Admin users. Your role cannot run this action.`}
          </p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-amber-700/70 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-900/70"
            onClick={() =>
              pushToast({
                type: 'info',
                message: 'Request sent — an admin will be notified (demo).',
              })
            }
          >
            Request Admin Approval
          </button>
        </div>
      </div>
    </div>
  )
}
