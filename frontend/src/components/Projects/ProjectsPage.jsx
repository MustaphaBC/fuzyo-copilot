import { LayoutGrid, List, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { fetchWorkspaceAnalytics } from '../../hooks/useWorkspaceAnalytics'
import DeleteConfirmModal from '../UI/DeleteConfirmModal'
import EmptyState from '../UI/EmptyState'
import SkeletonLoader from '../UI/SkeletonLoader'

const SORTS = [
  { id: 'recent', label: 'Most recent' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'progress', label: 'SDLC progress' },
]

function formatRelative(value) {
  if (!value) return 'No activity yet'
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return 'No activity yet'
  const min = Math.floor(Math.max(0, Date.now() - ts) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return day === 1 ? 'yesterday' : `${day}d ago`
}

function ProgressBar({ pct }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--chip)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] text-[var(--muted)]">{value.toFixed(0)}%</span>
    </div>
  )
}

function ProjectMenu({ onOpenIde, onInstructions, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]'
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 shadow-xl"
        >
          <button type="button" role="menuitem" className={`${item} text-[var(--app-fg)]`} onClick={onOpenIde}>
            Open files
          </button>
          <button type="button" role="menuitem" className={`${item} text-[var(--app-fg)]`} onClick={onInstructions}>
            Edit instructions
          </button>
          <button type="button" role="menuitem" className={`${item} text-red-600 dark:text-red-300`} onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function ProjectsPage() {
  const { workspaces, workspacesLoading, openProject, openWorkspaceModal, deleteWorkspace } = useApp()
  const [query, setQuery] = useState('')
  const [stackFilter, setStackFilter] = useState('all')
  const [sort, setSort] = useState('recent')
  const [layout, setLayout] = useState('grid')
  const [progress, setProgress] = useState({})
  const [confirmId, setConfirmId] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    let cancelled = false
    const pending = workspaces.filter((ws) => progress[ws.id] === undefined)
    if (pending.length === 0) return undefined
    Promise.all(
      pending.map((ws) =>
        fetchWorkspaceAnalytics(ws.id)
          .then((data) => [ws.id, data ? Number(data.sdlc_completion_pct) || 0 : 0])
          .catch(() => [ws.id, null]),
      ),
    ).then((entries) => {
      if (cancelled) return
      setProgress((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
    })
    return () => {
      cancelled = true
    }
  }, [workspaces, progress])

  const stackOptions = useMemo(() => {
    const all = new Set()
    for (const ws of workspaces) for (const tag of ws.tech_stack || []) all.add(tag)
    return [...all].sort()
  }, [workspaces])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = workspaces.filter((ws) => {
      if (stackFilter !== 'all' && !(ws.tech_stack || []).includes(stackFilter)) return false
      if (!q) return true
      return `${ws.name} ${ws.description || ''}`.toLowerCase().includes(q)
    })
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'progress') sorted.sort((a, b) => (progress[b.id] || 0) - (progress[a.id] || 0))
    else sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return sorted
  }, [workspaces, query, stackFilter, sort, progress])

  async function confirmDelete() {
    if (!confirmId) return
    setDeleteBusy(true)
    setDeleteError('')
    const result = await deleteWorkspace(confirmId)
    setDeleteBusy(false)
    if (!result.ok) {
      setDeleteError(result.error || 'Delete failed')
      return
    }
    setConfirmId(null)
  }

  const control =
    'rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-1.5 text-sm text-[var(--app-fg)] outline-none'

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="projects-page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--app-fg)]">Projects</h1>
        <button
          type="button"
          onClick={() => openWorkspaceModal('create')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90"
          data-testid="projects-page-new"
        >
          <Plus className="h-4 w-4" /> New Project
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-[var(--muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className={`${control} w-full pl-8`}
          />
        </label>
        <select
          value={stackFilter}
          onChange={(e) => setStackFilter(e.target.value)}
          aria-label="Filter by stack"
          className={control}
        >
          <option value="all">All stacks</option>
          {stackOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort projects" className={control}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-[var(--border)]" role="group" aria-label="Layout">
          {[
            { id: 'grid', icon: LayoutGrid, label: 'Grid view' },
            { id: 'list', icon: List, label: 'List view' },
          ].map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                aria-pressed={layout === option.id}
                onClick={() => setLayout(option.id)}
                className={`p-2 ${layout === option.id ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]' : 'text-[var(--muted)] hover:bg-[var(--hover)]'}`}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      </div>

      {workspacesLoading ? <SkeletonLoader rows={4} /> : null}

      {!workspacesLoading && workspaces.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a workspace to index documentation or a codebase and start the SDLC workflow."
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
      ) : null}

      {!workspacesLoading && workspaces.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No projects match the current filters.</p>
      ) : null}

      <div className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
        {visible.map((ws) => (
          <article
            key={ws.id}
            data-testid={`project-card-${ws.id}`}
            className={`rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-4 ${
              layout === 'list' ? 'flex flex-wrap items-center gap-4' : 'space-y-3'
            }`}
          >
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-[var(--app-fg)]">{ws.name}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-current" /> Active
              </p>
              {ws.description ? (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{ws.description}</p>
              ) : null}
            </div>
            <div className={layout === 'list' ? 'w-48' : ''}>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">SDLC</p>
              {progress[ws.id] === undefined ? (
                <p className="text-[11px] text-[var(--muted)]">Loading…</p>
              ) : progress[ws.id] === null ? (
                <p className="text-[11px] text-[var(--muted)]">Unavailable</p>
              ) : (
                <ProgressBar pct={progress[ws.id]} />
              )}
            </div>
            <p className="truncate text-xs text-[var(--muted)]">
              {(ws.tech_stack || []).join(' · ') || 'No stack declared'}
            </p>
            <p className="text-[11px] text-[var(--muted)]">Created {formatRelative(ws.created_at)}</p>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openProject(ws, 'overview')}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
              >
                Open
              </button>
              <ProjectMenu
                onOpenIde={() => openProject(ws, 'files')}
                onInstructions={() => openProject(ws, 'instructions')}
                onDelete={() => {
                  setDeleteError('')
                  setConfirmId(ws.id)
                }}
              />
            </div>
          </article>
        ))}
      </div>

      <DeleteConfirmModal
        open={Boolean(confirmId)}
        title="Delete Workspace"
        description={`Delete "${workspaces.find((w) => w.id === confirmId)?.name || ''}"? This removes the workspace and linked data.`}
        error={deleteError}
        busy={deleteBusy}
        onCancel={() => setConfirmId(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
