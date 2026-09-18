import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useUI } from '../context/UIContext'
import SidebarSearch from './Sidebar/SidebarSearch'
import DeleteConfirmModal from './UI/DeleteConfirmModal'
import ExportModal from './UI/ExportModal'
import SkeletonLoader from './UI/SkeletonLoader'
import Tooltip from './UI/Tooltip'

function IconPlus({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

function IconFolder({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  )
}

function IconBlocks({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function IconSliders({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" strokeLinecap="round" />
    </svg>
  )
}

function IconTrash({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPin({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 17v5M9 3l1 7H7l5 8 5-8h-3l1-7H9z" strokeLinejoin="round" />
    </svg>
  )
}

function IconExport({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3v12M8 11l4 4 4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMenu({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 6h16M4 12h10M4 18h13" strokeLinecap="round" />
    </svg>
  )
}

function formatRelative(ts) {
  if (!ts) return ''
  const diff = Math.max(0, Date.now() - Number(ts))
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export default function Sidebar() {
  const {
    workspaces,
    workspacesLoading,
    activeWorkspace,
    setActiveWorkspace,
    openWorkspaceInIde,
    viewMode,
    setViewMode,
    openWorkspaceModal,
    deleteWorkspace,
    resetChat,
    threads,
    activeThreadId,
    selectThread,
    apiHealthy,
    appearance,
    toggleAppearance,
    deleteThread,
    toggleThreadPin,
    messages,
  } = useApp()
  const { user, signOut } = useAuth()
  const {
    sidebarCollapsed,
    toggleSidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    setCommandPaletteOpen,
  } = useUI()

  const [threadQuery, setThreadQuery] = useState('')
  const [confirmWorkspaceId, setConfirmWorkspaceId] = useState(null)
  const [confirmThreadId, setConfirmThreadId] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false)
  const projectsMenuRef = useRef(null)

  useEffect(() => {
    if (!projectsMenuOpen) return undefined
    function onDocClick(event) {
      if (!projectsMenuRef.current?.contains(event.target)) {
        setProjectsMenuOpen(false)
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') setProjectsMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [projectsMenuOpen])

  const openProjectAnalytics = (ws) => {
    setActiveWorkspace(ws)
    setViewMode('dashboard')
    setProjectsMenuOpen(false)
    setMobileSidebarOpen(false)
  }

  const navBtn = (active) =>
    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
      active
        ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
        : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]'
    }`

  const filteredThreads = useMemo(() => {
    const q = threadQuery.trim().toLowerCase()
    const list = Array.isArray(threads) ? threads : []
    if (!q) return list
    return list.filter((t) => (t.title || '').toLowerCase().includes(q))
  }, [threads, threadQuery])

  const pinned = filteredThreads.filter((t) => t.isPinned)
  const recent = filteredThreads.filter((t) => !t.isPinned)

  async function confirmWorkspaceDelete() {
    if (!confirmWorkspaceId) return
    setDeleteBusy(true)
    setDeleteError('')
    const result = await deleteWorkspace(confirmWorkspaceId)
    setDeleteBusy(false)
    if (!result.ok) {
      setDeleteError(result.error || 'Delete failed')
      return
    }
    setConfirmWorkspaceId(null)
  }

  async function confirmThreadDelete() {
    if (!confirmThreadId) return
    setDeleteBusy(true)
    setDeleteError('')
    const result = await deleteThread(confirmThreadId)
    setDeleteBusy(false)
    if (!result?.ok) {
      setDeleteError('Delete failed')
      return
    }
    setConfirmThreadId(null)
  }

  const activeExportThread = threads.find((t) => t.id === activeThreadId)

  function renderThreadRow(thread, collapsed) {
    const active = thread.id === activeThreadId && viewMode === 'chat'
    return (
      <div
        key={thread.id}
        className={`group flex items-center gap-1 rounded-lg ${
          active ? 'bg-[var(--panel-elevated)]' : 'hover:bg-[var(--hover)]'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            selectThread(thread.id)
            setMobileSidebarOpen(false)
          }}
          className={`min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm transition ${
            active ? 'text-[var(--app-fg)]' : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
          }`}
          title={thread.title}
        >
          <span className="block truncate">{thread.title || 'New chat'}</span>
          <span className="block text-[10px] text-[var(--muted)]">
            {formatRelative(thread.updatedAt)}
          </span>
        </button>
        {!collapsed && (
          <div className="mr-1 flex opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={() => toggleThreadPin?.(thread.id, !thread.isPinned)}
              className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
              title={thread.isPinned ? 'Unpin' : 'Pin'}
              aria-label={thread.isPinned ? 'Unpin chat' : 'Pin chat'}
            >
              <IconPin />
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmThreadId(thread.id)
                setDeleteError('')
              }}
              className="rounded p-1.5 text-[var(--muted)] hover:bg-red-950/60 hover:text-red-300"
              title="Delete chat"
              aria-label={`Delete ${thread.title || 'chat'}`}
            >
              <IconTrash />
            </button>
          </div>
        )}
      </div>
    )
  }

  function renderPanel({ collapsed, forceWidthClass = null }) {
    const asideClasses =
      forceWidthClass ||
      (collapsed
        ? 'relative z-40 flex w-16 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]'
        : 'relative z-40 flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]')

    return (
    <aside className={asideClasses} data-testid="app-sidebar" data-collapsed={collapsed ? '1' : '0'}>
      <div className="flex items-center gap-1 border-b border-[var(--border)] p-2">
        <Tooltip label="Toggle sidebar (Ctrl+\\)">
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            data-testid="sidebar-collapse-toggle"
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
        </Tooltip>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] px-2 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
            data-testid="open-command-palette"
          >
            Search… ⌘K
          </button>
        )}
      </div>

      <div className="border-b border-[var(--border)] p-2">
        <Tooltip label="New chat">
          <button
            type="button"
            onClick={() => {
              void resetChat()
              setMobileSidebarOpen(false)
            }}
            className={`flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--chip)] px-3 py-2.5 text-sm font-medium text-[var(--app-fg)] transition hover:bg-[var(--hover)] ${
              collapsed ? 'w-full justify-center px-2' : 'w-full'
            }`}
            data-testid="new-chat-button"
          >
            <IconPlus />
            {!collapsed && 'New chat'}
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        <section>
          {!collapsed && (
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Global
            </p>
          )}
          <div className="space-y-0.5">
            <div className="relative" ref={projectsMenuRef}>
              <Tooltip label="Projects">
                <button
                  type="button"
                  data-testid="global-projects-button"
                  aria-expanded={projectsMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => setProjectsMenuOpen((open) => !open)}
                  className={navBtn(projectsMenuOpen || viewMode === 'dashboard')}
                >
                  <IconFolder />
                  {!collapsed && 'Projects'}
                </button>
              </Tooltip>
              {projectsMenuOpen ? (
                <div
                  role="listbox"
                  aria-label="All projects"
                  data-testid="projects-picker-menu"
                  className={`absolute z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 shadow-xl ${
                    collapsed
                      ? 'left-full top-0 ml-2 w-56'
                      : 'left-0 right-0 w-full min-w-[12rem]'
                  }`}
                >
                  {workspacesLoading ? (
                    <p className="px-3 py-2 text-xs text-[var(--muted)]">Loading…</p>
                  ) : null}
                  {!workspacesLoading && workspaces.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-[var(--muted)]">No projects yet</p>
                  ) : null}
                  {workspaces.map((ws) => {
                    const active = activeWorkspace?.id === ws.id
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-testid={`projects-picker-item-${ws.id}`}
                        onClick={() => openProjectAnalytics(ws)}
                        className={`flex w-full truncate px-3 py-2 text-left text-sm hover:bg-[var(--hover)] ${
                          active
                            ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                            : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
                        }`}
                        title={ws.name}
                      >
                        {ws.name}
                      </button>
                    )
                  })}
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    type="button"
                    data-testid="projects-picker-new"
                    onClick={() => {
                      setProjectsMenuOpen(false)
                      openWorkspaceModal('create')
                      setMobileSidebarOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    New project
                  </button>
                </div>
              ) : null}
            </div>
            <Tooltip label="Artifacts">
              <button
                type="button"
                onClick={() => {
                  setViewMode('artifacts')
                  setMobileSidebarOpen(false)
                }}
                className={navBtn(viewMode === 'artifacts')}
              >
                <IconBlocks />
                {!collapsed && 'Artifacts'}
              </button>
            </Tooltip>
            <Tooltip label="Customize">
              <button
                type="button"
                onClick={() => {
                  if (!activeWorkspace) return
                  setViewMode('customize')
                  openWorkspaceModal('edit')
                  setMobileSidebarOpen(false)
                }}
                disabled={!activeWorkspace}
                className={`${navBtn(viewMode === 'customize')} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <IconSliders />
                {!collapsed && 'Customize'}
              </button>
            </Tooltip>
          </div>
        </section>

        {!collapsed && (
          <section>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Projects
              </p>
              <button
                type="button"
                onClick={() => openWorkspaceModal('create')}
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
                title="New project"
                aria-label="New project"
                data-testid="new-project-button"
              >
                <IconPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {workspacesLoading && <SkeletonLoader className="px-2" rows={2} />}
              {!workspacesLoading && workspaces.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-[var(--muted)]">No projects yet</p>
              )}
              {workspaces.map((ws) => {
                const active = activeWorkspace?.id === ws.id
                return (
                  <div
                    key={ws.id}
                    className={`group flex items-center gap-1 rounded-lg ${
                      active ? 'bg-[var(--panel-elevated)]' : 'hover:bg-[var(--hover)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        openWorkspaceInIde(ws)
                        setMobileSidebarOpen(false)
                      }}
                      className={`min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm ${
                        active ? 'text-[var(--app-fg)]' : 'text-[var(--muted)]'
                      }`}
                      title={ws.name}
                    >
                      {ws.name}
                    </button>
                    {active && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmWorkspaceId(ws.id)
                          setDeleteError('')
                        }}
                        className="mr-1 rounded p-1.5 text-[var(--muted)] opacity-0 transition hover:bg-red-950/60 hover:text-red-300 group-hover:opacity-100"
                        title="Delete project"
                        aria-label={`Delete ${ws.name}`}
                      >
                        <IconTrash />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {!collapsed && (
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Chats
              </p>
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
                title="Export active chat"
                aria-label="Export active chat"
                data-testid="open-export-modal"
              >
                <IconExport />
              </button>
            </div>
            <div className="mb-2 px-1">
              <SidebarSearch value={threadQuery} onChange={setThreadQuery} />
            </div>
            {pinned.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Pinned
                </p>
                <div className="space-y-0.5">
                  {pinned.map((thread) => renderThreadRow(thread, collapsed))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Recent
              </p>
              <div className="space-y-0.5">
                {recent.length === 0 && (
                  <p className="px-2.5 py-2 text-xs text-[var(--muted)]">No chats yet</p>
                )}
                {recent.map((thread) => renderThreadRow(thread, collapsed))}
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-2 py-3">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  apiHealthy ? 'bg-emerald-400' : 'bg-red-500'
                }`}
                title={apiHealthy ? 'API healthy' : 'API unreachable'}
              />
              <span className="truncate text-sm font-medium text-[var(--app-fg)]" title={user?.email || 'Fuzyo'}>
                {user?.email
                  ? user.email.length > 18
                    ? `${user.email.slice(0, 15)}…`
                    : user.email
                  : 'Fuzyo'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)]"
              >
                Out
              </button>
              <button
                type="button"
                onClick={toggleAppearance}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)]"
                aria-label={`Switch to ${appearance === 'dark' ? 'light' : 'dark'} theme`}
              >
                {appearance === 'dark' ? 'Dark' : 'Light'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${apiHealthy ? 'bg-emerald-400' : 'bg-red-500'}`}
            />
            <button
              type="button"
              onClick={toggleAppearance}
              className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--muted)]"
            >
              {appearance === 'dark' ? 'D' : 'L'}
            </button>
          </div>
        )}
      </div>
    </aside>
    )
  }

  return (
    <>
      <button
        type="button"
        className="fixed left-3 top-3 z-30 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2 text-[var(--muted)] shadow md:hidden"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Open sidebar"
        data-testid="mobile-sidebar-open"
      >
        <IconMenu />
      </button>

      <div className="hidden md:flex">
        {renderPanel({ collapsed: sidebarCollapsed })}
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" data-testid="mobile-sidebar-drawer">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--overlay)]"
            aria-label="Close sidebar"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw]">
            {renderPanel({
              collapsed: false,
              forceWidthClass:
                'relative z-40 flex h-full w-full flex-col border-r border-[var(--border)] bg-[var(--panel)]',
            })}
          </div>
        </div>
      ) : null}

      <DeleteConfirmModal
        open={Boolean(confirmWorkspaceId)}
        title="Delete this project?"
        description="This permanently removes the workspace and all uploaded documents."
        error={deleteError}
        busy={deleteBusy}
        onCancel={() => setConfirmWorkspaceId(null)}
        onConfirm={confirmWorkspaceDelete}
      />
      <DeleteConfirmModal
        open={Boolean(confirmThreadId)}
        title="Delete this chat?"
        description="This permanently removes the thread and its messages."
        error={deleteError}
        busy={deleteBusy}
        onCancel={() => setConfirmThreadId(null)}
        onConfirm={confirmThreadDelete}
      />
      <ExportModal
        open={exportOpen}
        threadTitle={activeExportThread?.title}
        messages={messages}
        onClose={() => setExportOpen(false)}
      />
    </>
  )
}
