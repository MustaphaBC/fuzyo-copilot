import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiFetch } from '../lib/api'
import CodeQualityDonut from './Analytics/CodeQualityDonut'
import DeliverablesMilestones from './Analytics/DeliverablesMilestones'
import SDLCKPICards from './Analytics/SDLCKPICards'
import EmptyState from './UI/EmptyState'
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
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--overlay)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dash-delete-title"
            className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
          >
            <h2 id="dash-delete-title" className="text-base font-semibold text-[var(--app-fg)]">
              Delete this project?
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Permanently removes <span className="text-[var(--app-fg)]">{activeWorkspace.name}</span>{' '}
              and all uploaded documents.
            </p>
            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function AnalyticsDashboard() {
  const { activeWorkspace, openWorkspaceModal } = useApp()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch(
          `/api/v1/workspaces/${activeWorkspace.id}/analytics`,
        )
        if (response.status === 404) {
          if (!cancelled) {
            setData(null)
            setError(null)
          }
          return
        }
        if (response.status === 503) {
          throw new Error('Supabase unreachable. Check network and retry.')
        }
        if (!response.ok) {
          throw new Error(`Analytics failed (${response.status})`)
        }
        const json = await response.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setData(null)
          setError(err instanceof Error ? err.message : 'Failed to load analytics')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspace?.id, reloadKey])

  useEffect(() => {
    const onFsUpdated = (event) => {
      const id = event?.detail?.workspaceId
      if (!id || !activeWorkspace?.id) return
      if (String(id) !== String(activeWorkspace.id)) return
      setReloadKey((k) => k + 1)
    }
    window.addEventListener('fuzyo:workspace-fs-updated', onFsUpdated)
    return () => window.removeEventListener('fuzyo:workspace-fs-updated', onFsUpdated)
  }, [activeWorkspace?.id])

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

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-sm text-[var(--muted)]">Loading analytics…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
        >
          Retry
        </button>
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
            <p className="mt-1 text-sm text-[var(--muted)]">SDLC command center</p>
          </div>
          <DeleteWorkspaceButton />
        </div>
        <EmptyState
          title="No codebase indexed yet"
          description="Upload a zip or documents to scan the project and populate phase readiness, quality scores, and RAG metrics."
          action={
            <button
              type="button"
              onClick={() => openWorkspaceModal('create')}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
              data-testid="scan-project-cta"
            >
              Scan project
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
            SDLC command center · {data.document_count} docs · {data.chunk_count} chunks
          </p>
        </div>
        <DeleteWorkspaceButton />
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
