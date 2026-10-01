import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { useWorkspaceAnalytics } from '../hooks/useWorkspaceAnalytics'
import CodeQualityDonut from './Analytics/CodeQualityDonut'
import DeliverablesMilestones from './Analytics/DeliverablesMilestones'
import SDLCKPICards from './Analytics/SDLCKPICards'
import DeleteConfirmModal from './UI/DeleteConfirmModal'
import EmptyState from './UI/EmptyState'
import ErrorState from './UI/ErrorState'
import ProjectOverviewDashboard from './Workspace/ProjectOverviewDashboard'

function DeleteWorkspaceButton() {
  const { activeWorkspace, deleteWorkspace } = useApp()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!activeWorkspace) return null

  async function onConfirm() {
    setBusy(true)
    setError('')
    const result = await deleteWorkspace(activeWorkspace.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error || 'Delete failed')
      return
    }
    setConfirmOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirmOpen(true)
          setError('')
        }}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
      >
        Delete workspace
      </button>
      <DeleteConfirmModal
        open={confirmOpen}
        title="Delete this project?"
        description={`Permanently removes "${activeWorkspace.name}" and all uploaded documents.`}
        error={error}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  )
}

function ScanButton({ onScan, busy }) {
  return (
    <button
      type="button"
      onClick={onScan}
      disabled={busy}
      data-testid="scan-project-button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      {busy ? 'Scanning…' : 'Scan'}
    </button>
  )
}

export default function AnalyticsDashboard() {
  const { activeWorkspace, openWorkspaceModal, openProject } = useApp()
  const { data, loading, error, reload, rescan } = useWorkspaceAnalytics(activeWorkspace?.id)

  if (!activeWorkspace) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <EmptyState
          title="No project selected"
          description="Select or create a workspace to open the SDLC command center."
          action={
            <button
              type="button"
              onClick={() => openWorkspaceModal('create')}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
            >
              Create project
            </button>
          }
        />
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-sm text-[var(--muted)]">Loading analytics…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <ErrorState title="Analytics unavailable" description={error} onRetry={reload} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-sm text-[var(--muted)]">No analytics data.</p>
      </div>
    )
  }

  const report = data.sdlc_audit_report || null
  const fileCount = Number(report?.file_count) || 0
  const isEmptyProject = (data.document_count ?? 0) === 0 && fileCount === 0

  if (isEmptyProject) {
    return (
      <div className="relative flex-1 space-y-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-[var(--app-fg)]">{data.name}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Project workspace overview</p>
          </div>
          <div className="flex gap-2">
            <ScanButton onScan={rescan} busy={loading} />
            <DeleteWorkspaceButton />
          </div>
        </div>
        <EmptyState
          title="No codebase indexed yet"
          description="Upload a zip or documents to scan the project and populate phase readiness, quality scores, and RAG metrics."
          action={
            <button
              type="button"
              onClick={() => openProject(activeWorkspace, 'knowledge')}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
              data-testid="scan-project-cta"
            >
              Upload documents
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="relative flex-1 space-y-8 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-[var(--app-fg)]">{data.name}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Project workspace overview · {data.document_count} docs · {data.chunk_count} chunks
          </p>
        </div>
        <div className="flex gap-2">
          <ScanButton onScan={rescan} busy={loading} />
          <DeleteWorkspaceButton />
        </div>
      </div>

      <SDLCKPICards data={data} />

      <ProjectOverviewDashboard report={report} fallbackTechStack={data.tech_stack || []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CodeQualityDonut
          scores={report?.scores || {}}
          testabilityScore={data.testability_score}
        />
        <DeliverablesMilestones phases={report?.phases || []} />
      </div>
    </div>
  )
}
