import { ChevronDown, ChevronRight, FileCode, Folder, PanelLeftClose } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'

function TreeNode({ node, depth, onOpenFile, expanded, toggle }) {
  const isDir = node.type === 'dir'
  const isOpen = expanded.has(node.path)

  if (isDir) {
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          style={{ paddingLeft: `${4 + depth * 10}px` }}
          onClick={() => toggle(node.path)}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen
          ? (node.children || []).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                expanded={expanded}
                toggle={toggle}
              />
            ))
          : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
      style={{ paddingLeft: `${16 + depth * 10}px` }}
      onClick={() => onOpenFile(node.path)}
      title={node.path}
    >
      <FileCode className="h-3 w-3 shrink-0 text-[var(--muted)]" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export default function FileExplorer() {
  const { activeWorkspace, openIdeFile, setIdeTreeCache } = useApp()
  const { pushToast, toggleIdeExplorerCollapsed } = useUI()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(['src', 'docs', 'tests']))

  const loadTree = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setEntries([])
      setIdeTreeCache([])
      return
    }
    setLoading(true)
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/fs/tree?depth=3`,
      )
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to load tree')
      }
      const json = await response.json()
      const list = Array.isArray(json.entries) ? json.entries : []
      setEntries(list)
      setIdeTreeCache(list)
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Tree load failed',
      })
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace?.id, pushToast, setIdeTreeCache])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  useEffect(() => {
    const onFs = (event) => {
      const id = event?.detail?.workspaceId
      if (!id || id === activeWorkspace?.id) loadTree()
    }
    window.addEventListener('fuzyo:workspace-fs-updated', onFs)
    return () => window.removeEventListener('fuzyo:workspace-fs-updated', onFs)
  }, [activeWorkspace?.id, loadTree])

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const onOpenFile = async (path) => {
    if (!activeWorkspace?.id) return
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/fs/file?path=${encodeURIComponent(path)}`,
      )
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to open file')
      }
      const json = await response.json()
      openIdeFile({ path: json.path || path, content: json.content ?? '' })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Open failed',
      })
    }
  }

  return (
    <aside
      className="flex h-full min-h-0 w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]"
      data-testid="file-explorer"
    >
      <div className="flex items-center justify-between gap-1 border-b border-[var(--border)] px-2 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Explorer
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-[10px] text-[var(--muted)] hover:text-[var(--app-fg)]"
            onClick={loadTree}
          >
            Refresh
          </button>
          <button
            type="button"
            data-testid="collapse-explorer"
            aria-label="Collapse explorer"
            title="Collapse explorer"
            onClick={toggleIdeExplorerCollapsed}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading ? (
          <p className="px-2 py-2 text-xs text-[var(--muted)]">Loading…</p>
        ) : null}
        {!loading && !entries.length ? (
          <p className="px-2 py-2 text-xs text-[var(--muted)]">
            No local files yet. Create or ingest a project.
          </p>
        ) : null}
        {entries.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            onOpenFile={onOpenFile}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
      </div>
    </aside>
  )
}
