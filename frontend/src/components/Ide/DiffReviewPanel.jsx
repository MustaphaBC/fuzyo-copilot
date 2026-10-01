import { useEditor } from '../../context/EditorContext'
import { useUI } from '../../context/UIContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { apiFetch } from '../../lib/api'
import { buildLineDiff } from '../../lib/lineDiff'
import { notifyWorkspaceFsUpdated } from '../../lib/saveLocalArtifact'

export default function DiffReviewPanel() {
  const { activeWorkspace } = useWorkspace()
  const { pendingDiff, clearPendingDiff, openIdeFile, updateIdeFileContent, markDirty } =
    useEditor()
  const { pushToast } = useUI()

  if (!pendingDiff) return null

  const lines = buildLineDiff(pendingDiff.original, pendingDiff.proposed)

  const onReject = () => {
    clearPendingDiff()
    pushToast({ type: 'info', message: 'Changes rejected' })
  }

  const onAccept = async () => {
    if (!activeWorkspace?.id) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/apply-changes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase: pendingDiff.phase || 5,
            files: [
              {
                relative_path: pendingDiff.path,
                content: pendingDiff.proposed || '',
              },
            ],
          }),
        },
      )
      if (!response.ok) {
        throw new Error((await response.text()) || 'Apply failed')
      }
      const written = pendingDiff.path
      openIdeFile({ path: written, content: pendingDiff.proposed || '' })
      updateIdeFileContent(written, pendingDiff.proposed || '', { dirty: false })
      markDirty(written, false)
      notifyWorkspaceFsUpdated(activeWorkspace.id)
      clearPendingDiff()
      pushToast({ type: 'success', message: `Accepted ${written}` })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Accept failed',
      })
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] bg-[var(--code-bg)]"
      data-testid="diff-review-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div>
          <p className="text-xs font-medium text-[var(--app-fg)]">Review changes</p>
          <p className="text-[11px] text-[var(--muted)]">{pendingDiff.path}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="diff-reject"
            onClick={onReject}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          >
            Reject
          </button>
          <button
            type="button"
            data-testid="diff-accept"
            onClick={onAccept}
            className="rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-950/50"
          >
            Accept
          </button>
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-relaxed">
        {lines.map((row, index) => (
          <div
            key={`${row.type}-${index}`}
            className={
              row.type === 'add'
                ? 'bg-emerald-950/40 text-emerald-200'
                : row.type === 'del'
                  ? 'bg-red-950/40 text-red-200'
                  : 'text-[var(--app-fg)]'
            }
          >
            <span className="mr-2 opacity-60">
              {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
            </span>
            {row.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
