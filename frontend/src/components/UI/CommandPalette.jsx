import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'

export default function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setShortcutGuideOpen,
    toggleSidebarCollapsed,
    pushToast,
  } = useUI()
  const {
    threads,
    workspaces,
    selectThread,
    setActiveWorkspace,
    setViewMode,
    resetChat,
    toggleAppearance,
    appearance,
    openWorkspaceModal,
    openWorkspaceInIde,
    activeWorkspace,
    ideTreeCache,
    openIdeFile,
    viewMode,
  } = useApp()

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery('')
      setDebounced('')
      return undefined
    }
    const t = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 120)
    return () => window.clearTimeout(t)
  }, [query, commandPaletteOpen])

  useEffect(() => {
    if (!commandPaletteOpen) return undefined
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [commandPaletteOpen, setCommandPaletteOpen])

  const actions = useMemo(() => {
    const items = [
      {
        id: 'new-chat',
        label: 'New chat',
        group: 'Actions',
        run: () => {
          void resetChat()
          pushToast({ type: 'success', message: 'Started a new chat' })
        },
      },
      {
        id: 'toggle-theme',
        label: appearance === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        run: () => toggleAppearance(),
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        group: 'Actions',
        run: () => toggleSidebarCollapsed(),
      },
      {
        id: 'shortcuts',
        label: 'Open keyboard shortcuts',
        group: 'Actions',
        run: () => setShortcutGuideOpen(true),
      },
      {
        id: 'projects',
        label: 'Go to Projects',
        group: 'Navigate',
        run: () => setViewMode('dashboard'),
      },
      {
        id: 'artifacts',
        label: 'Go to Artifacts',
        group: 'Navigate',
        run: () => setViewMode('artifacts'),
      },
      {
        id: 'new-project',
        label: 'Create project',
        group: 'Navigate',
        run: () => openWorkspaceModal('create'),
      },
      {
        id: 'open-ide',
        label: 'Open IDE',
        group: 'Navigate',
        run: () => {
          if (activeWorkspace) openWorkspaceInIde(activeWorkspace)
          else setViewMode('ide')
        },
      },
      {
        id: 'open-chat',
        label: 'Open Chat',
        group: 'Navigate',
        run: () => setViewMode('chat'),
      },
    ]

    for (const ws of workspaces) {
      items.push({
        id: `ws-${ws.id}`,
        label: `Project: ${ws.name}`,
        group: 'Projects',
        run: () => openWorkspaceInIde(ws),
      })
      items.push({
        id: `ws-analytics-${ws.id}`,
        label: `Analytics: ${ws.name}`,
        group: 'Projects',
        run: () => {
          setActiveWorkspace(ws)
          setViewMode('dashboard')
        },
      })
    }

    if (viewMode === 'ide' && Array.isArray(ideTreeCache)) {
      const flatten = (nodes, out = []) => {
        for (const n of nodes || []) {
          if (n.type === 'file') out.push(n)
          if (n.children) flatten(n.children, out)
        }
        return out
      }
      for (const file of flatten(ideTreeCache).slice(0, 40)) {
        items.push({
          id: `file-${file.path}`,
          label: `Open file: ${file.path}`,
          group: 'Files',
          run: async () => {
            if (!activeWorkspace?.id) return
            try {
              const response = await apiFetch(
                `/api/v1/workspaces/${activeWorkspace.id}/fs/file?path=${encodeURIComponent(file.path)}`,
              )
              if (!response.ok) return
              const json = await response.json()
              openIdeFile({ path: json.path || file.path, content: json.content ?? '' })
            } catch {
              /* ignore */
            }
          },
        })
      }
    }

    for (const thread of threads) {
      items.push({
        id: `th-${thread.id}`,
        label: thread.title || 'New chat',
        group: 'Chats',
        run: () => selectThread(thread.id),
      })
    }

    if (!debounced) return items
    return items.filter((item) => item.label.toLowerCase().includes(debounced))
  }, [
    activeWorkspace,
    appearance,
    debounced,
    ideTreeCache,
    openIdeFile,
    openWorkspaceInIde,
    openWorkspaceModal,
    pushToast,
    resetChat,
    selectThread,
    setActiveWorkspace,
    setShortcutGuideOpen,
    setViewMode,
    threads,
    toggleAppearance,
    toggleSidebarCollapsed,
    viewMode,
    workspaces,
  ])

  if (!commandPaletteOpen) return null

  const grouped = actions.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setCommandPaletteOpen(false)
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats, projects, actions…"
          className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--muted)]"
          data-testid="command-palette-input"
        />
        <div className="max-h-80 overflow-y-auto py-2">
          {Object.keys(grouped).length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">No matches</p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  {group}
                </p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full px-4 py-2 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
                    onClick={() => {
                      setCommandPaletteOpen(false)
                      item.run()
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
