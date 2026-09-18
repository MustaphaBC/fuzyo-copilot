import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { apiFetch } from '../lib/api'

export const SDLC_PHASES = [
  { id: 1, label: 'Expression du besoin' },
  { id: 2, label: 'Analyse fonctionnelle' },
  { id: 3, label: 'Architecture' },
  { id: 4, label: 'Gestion de projet / PO' },
  { id: 5, label: 'Développement' },
  { id: 6, label: 'Tests & QA' },
  { id: 7, label: 'Recette' },
  { id: 8, label: 'DevOps / CI-CD' },
  { id: 9, label: 'Mise en production' },
]

export const MODEL_OPTIONS = [
  { id: 'auto', label: 'Auto', value: null },
  { id: 'groq', label: 'Groq', value: 'openai/gpt-oss-120b' },
  { id: 'gemini', label: 'Gemini', value: 'gemini-3.6-flash' },
]

/** @deprecated Prefer selectedModelKey; kept for one-release compatibility. */
export function modelOverrideFromKey(selectedModelKey) {
  if (!selectedModelKey || selectedModelKey === 'auto') return null
  const colon = selectedModelKey.indexOf(':')
  if (colon <= 0) return selectedModelKey
  return selectedModelKey.slice(colon + 1)
}

export function parseSelectedModelKey(selectedModelKey) {
  if (!selectedModelKey || selectedModelKey === 'auto') {
    return { provider: null, model: null }
  }
  const colon = selectedModelKey.indexOf(':')
  if (colon <= 0) {
    return { provider: null, model: selectedModelKey }
  }
  return {
    provider: selectedModelKey.slice(0, colon),
    model: selectedModelKey.slice(colon + 1),
  }
}

const APPEARANCE_KEY = 'fuzyo:appearance'

const AppContext = createContext(null)

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

function threadsKey(workspaceId) {
  return `fuzyo:threads:${workspaceId || 'none'}`
}

function messagesKey(threadId) {
  return `fuzyo:messages:${threadId}`
}

function artifactsKey(workspaceId) {
  return `fuzyo:artifacts:${workspaceId || 'none'}`
}

function readAppearance() {
  try {
    const value = localStorage.getItem(APPEARANCE_KEY)
    return value === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyAppearanceClass(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light'
}

function createLocalThread(workspaceId) {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    workspaceId: workspaceId || null,
    updatedAt: Date.now(),
    preview: '',
    isPinned: false,
  }
}

function mapServerThread(row, workspaceId) {
  return {
    id: row.id,
    title: row.title || 'New chat',
    workspaceId: row.workspace_id || workspaceId || null,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).getTime()
      : Date.now(),
    preview: '',
    isPinned: Boolean(row.is_pinned),
  }
}

function mapServerMessages(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content || '',
    routingBadge: row.routing_badge ?? null,
    isStreaming: false,
  }))
}

function toServerPayload(messages) {
  return {
    messages: messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg, index) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content || '',
        routing_badge: msg.routingBadge ?? null,
        sort_index: index,
      })),
  }
}

export function AppProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspace, setActiveWorkspace] = useState(null)
  const [sdlcPhase, setSdlcPhase] = useState(1)
  const [forceConfidential, setForceConfidential] = useState(false)
  const [skillsMode, setSkillsModeState] = useState(null)
  const [viewMode, setViewModeRaw] = useState('chat')
  const [workspaceModal, setWorkspaceModal] = useState({ open: false, mode: 'create' })
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [openFiles, setOpenFiles] = useState([])
  const [activeFilePath, setActiveFilePath] = useState(null)
  const [pendingDiff, setPendingDiffState] = useState(null)
  const [ideTreeCache, setIdeTreeCache] = useState([])

  const [messages, setMessages] = useState([])
  const [threads, setThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [artifactLibrary, setArtifactLibrary] = useState([])
  const [inputMode, setInputModeState] = useState('chat')
  const [selectedModelKey, setSelectedModelKey] = useState('auto')
  const [apiHealthy, setApiHealthy] = useState(false)
  const [appearance, setAppearanceState] = useState(() => readAppearance())
  const [composerSeed, setComposerSeed] = useState(null)
  const titlePatchedRef = useRef(new Set())

  const seedComposer = useCallback((text) => {
    setComposerSeed({ text: String(text || ''), nonce: Date.now() })
  }, [])

  const setViewMode = useCallback((mode) => {
    const next = mode === 'analytics' ? 'dashboard' : mode
    setViewModeRaw(next)
  }, [])

  const languageFromPath = useCallback((path) => {
    const name = String(path || '').split('/').pop() || ''
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
    const map = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      go: 'go',
      json: 'json',
      md: 'markdown',
      markdown: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
      toml: 'toml',
      sql: 'sql',
      css: 'css',
      html: 'html',
      txt: 'plaintext',
      mermaid: 'plaintext',
    }
    return map[ext] || 'plaintext'
  }, [])

  const openIdeFile = useCallback(
    (file) => {
      const path = String(file?.path || '').replace(/\\/g, '/')
      if (!path) return
      setOpenFiles((prev) => {
        const existing = prev.find((f) => f.path === path)
        if (existing) return prev
        return [
          ...prev,
          {
            path,
            content: file?.content ?? '',
            dirty: false,
            language: file?.language || languageFromPath(path),
          },
        ]
      })
      setActiveFilePath(path)
    },
    [languageFromPath],
  )

  const closeIdeFile = useCallback((path) => {
    const target = String(path || '').replace(/\\/g, '/')
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== target)
      setActiveFilePath((current) => {
        if (current !== target) return current
        return next.length ? next[next.length - 1].path : null
      })
      return next
    })
  }, [])

  const setActiveFile = useCallback((path) => {
    setActiveFilePath(path ? String(path).replace(/\\/g, '/') : null)
  }, [])

  const updateIdeFileContent = useCallback((path, content, { dirty = true } = {}) => {
    const target = String(path || '').replace(/\\/g, '/')
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === target
          ? { ...f, content: content ?? '', dirty: Boolean(dirty) }
          : f,
      ),
    )
  }, [])

  const markDirty = useCallback((path, dirty = true) => {
    const target = String(path || '').replace(/\\/g, '/')
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === target ? { ...f, dirty: Boolean(dirty) } : f)),
    )
  }, [])

  const setPendingDiff = useCallback((diff) => {
    if (!diff) {
      setPendingDiffState(null)
      return
    }
    setPendingDiffState({
      path: String(diff.path || '').replace(/\\/g, '/'),
      proposed: diff.proposed ?? '',
      original: diff.original ?? '',
      phase: diff.phase ?? 5,
    })
  }, [])

  const clearPendingDiff = useCallback(() => {
    setPendingDiffState(null)
  }, [])

  const openWorkspaceInIde = useCallback(
    (workspace) => {
      if (workspace) setActiveWorkspace(workspace)
      setViewModeRaw('ide')
    },
    [],
  )

  const setSkillsMode = useCallback((skill) => {
    setSkillsModeState((current) => (current === skill ? null : skill))
  }, [])

  const setInputMode = useCallback((mode) => {
    setInputModeState(mode)
    if (mode === 'chat') {
      setSkillsModeState(null)
    }
  }, [])

  const setAppearance = useCallback((mode) => {
    const next = mode === 'light' ? 'light' : 'dark'
    setAppearanceState(next)
  }, [])

  const toggleAppearance = useCallback(() => {
    setAppearanceState((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const openWorkspaceModal = useCallback((mode = 'create') => {
    setWorkspaceModal({ open: true, mode })
  }, [])

  const closeWorkspaceModal = useCallback(() => {
    setWorkspaceModal((current) => ({ ...current, open: false }))
    setViewModeRaw((current) => (current === 'customize' ? 'chat' : current))
  }, [])

  const persistThreadMessagesToServer = useCallback(
    async (threadId, nextMessages, workspaceId = activeWorkspace?.id) => {
      if (!threadId || !workspaceId) return { ok: false, skipped: true }
      try {
        const response = await apiFetch(
          `/api/v1/workspaces/${workspaceId}/threads/${threadId}/messages`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toServerPayload(nextMessages || [])),
          },
        )
        if (!response.ok) {
          return { ok: false, status: response.status }
        }
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
    [activeWorkspace?.id],
  )

  const syncThreadMessagesFromServer = useCallback(
    async (threadId, workspaceId = activeWorkspace?.id) => {
      if (!threadId || !workspaceId) return { ok: false, skipped: true }
      try {
        const response = await apiFetch(
          `/api/v1/workspaces/${workspaceId}/threads/${threadId}/messages`,
        )
        if (response.status === 404) {
          // Workspace/thread removed (e.g. concurrent delete) — ignore quietly.
          return { ok: false, status: 404, missing: true }
        }
        if (!response.ok) {
          return { ok: false, status: response.status }
        }
        const rows = await response.json()
        const mapped = mapServerMessages(rows)
        if (mapped.length > 0) {
          setMessages(mapped)
          writeJson(messagesKey(threadId), mapped)
        }
        return { ok: true, count: mapped.length }
      } catch {
        return { ok: false }
      }
    },
    [activeWorkspace?.id],
  )

  const patchThreadTitle = useCallback(async (threadId, title) => {
    if (!threadId || !title) return
    try {
      const response = await apiFetch(`/api/v1/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (response.status === 404) return
    } catch {
      /* soft fail */
    }
  }, [])

  const refreshThreads = useCallback(async (workspaceId) => {
    if (!workspaceId) {
      const local = createLocalThread(null)
      setThreads([local])
      setActiveThreadId(local.id)
      setMessages([])
      writeJson(messagesKey(local.id), [])
      return [local]
    }

    const arts = readJson(artifactsKey(workspaceId), [])
    setArtifactLibrary(Array.isArray(arts) ? arts : [])

    try {
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/threads`)
      if (response.status === 404) {
        // Workspace gone — leave empty local state; caller will switch workspace.
        setThreads([])
        setActiveThreadId(null)
        setMessages([])
        return []
      }
      if (!response.ok) {
        throw new Error(`threads ${response.status}`)
      }
      let rows = await response.json()
      if (!Array.isArray(rows)) rows = []

      // One-time migrate: local threads when server empty.
      if (rows.length === 0) {
        const legacy = readJson(threadsKey(workspaceId), [])
        if (Array.isArray(legacy) && legacy.length > 0) {
          for (const item of legacy) {
            await apiFetch(`/api/v1/workspaces/${workspaceId}/threads`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.id,
                title: item.title || 'New chat',
              }),
            }).catch(() => null)
          }
          localStorage.removeItem(threadsKey(workspaceId))
          const again = await apiFetch(`/api/v1/workspaces/${workspaceId}/threads`)
          if (again.ok) {
            rows = await again.json()
            if (!Array.isArray(rows)) rows = []
          }
        }
      }

      if (rows.length === 0) {
        const createRes = await apiFetch(`/api/v1/workspaces/${workspaceId}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New chat' }),
        })
        if (createRes.ok) {
          const created = await createRes.json()
          rows = [created]
        }
      }

      const mapped = rows.map((row) => mapServerThread(row, workspaceId))
      setThreads(mapped)
      const firstId = mapped[0]?.id || null
      setActiveThreadId(firstId)
      if (firstId) {
        const msgs = readJson(messagesKey(firstId), [])
        setMessages(Array.isArray(msgs) ? msgs : [])
      } else {
        setMessages([])
      }
      return mapped
    } catch {
      // Offline / table missing: ephemeral local thread.
      const local = createLocalThread(workspaceId)
      setThreads([local])
      setActiveThreadId(local.id)
      setMessages([])
      writeJson(messagesKey(local.id), [])
      return [local]
    }
  }, [])

  const refreshWorkspaces = useCallback(async (preferId = null) => {
    setWorkspacesLoading(true)
    try {
      const response = await apiFetch('/api/v1/workspaces')
      if (!response.ok) {
        throw new Error(`Failed to load workspaces (${response.status})`)
      }
      const list = await response.json()
      const rows = Array.isArray(list) ? list : []
      setWorkspaces(rows)

      setActiveWorkspace((current) => {
        const preferred =
          (preferId && rows.find((ws) => ws.id === preferId)) ||
          (current?.id && rows.find((ws) => ws.id === current.id)) ||
          rows[0] ||
          null
        return preferred
      })
      return rows
    } catch {
      setWorkspaces([])
      setActiveWorkspace(null)
      return []
    } finally {
      setWorkspacesLoading(false)
    }
  }, [])

  const deleteWorkspace = useCallback(
    async (workspaceId) => {
      if (!workspaceId) {
        return { ok: false, error: 'No workspace id' }
      }
      try {
        // Optimistic clear so in-flight thread/analytics effects stop using the deleted id.
        setWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId))
        setActiveWorkspace((current) => (current?.id === workspaceId ? null : current))
        setThreads([])
        setActiveThreadId(null)
        setMessages([])
        setArtifactLibrary([])
        localStorage.removeItem(threadsKey(workspaceId))
        localStorage.removeItem(artifactsKey(workspaceId))

        const response = await apiFetch(`/api/v1/workspaces/${workspaceId}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          const detail = await response.text()
          // Reload authoritative list if delete failed after optimistic clear.
          await refreshWorkspaces(workspaceId)
          return {
            ok: false,
            error: detail || `Delete failed (${response.status})`,
          }
        }
        const result = await response.json().catch(() => null)
        await refreshWorkspaces()
        setWorkspaceModal((current) =>
          current.open ? { ...current, open: false } : current,
        )
        return { ok: true, result }
      } catch (err) {
        await refreshWorkspaces()
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Delete failed',
        }
      }
    },
    [refreshWorkspaces],
  )

  const deleteThread = useCallback(
    async (threadId) => {
      if (!threadId) return { ok: false }
      const wsId = activeWorkspace?.id
      try {
        if (wsId) {
          const response = await apiFetch(`/api/v1/threads/${threadId}`, {
            method: 'DELETE',
          })
          if (!response.ok && response.status !== 404) {
            return { ok: false, status: response.status }
          }
        }
        localStorage.removeItem(messagesKey(threadId))
        setThreads((prev) => prev.filter((t) => t.id !== threadId))
        if (activeThreadId === threadId) {
          const remaining = threads.filter((t) => t.id !== threadId)
          if (remaining[0]) {
            setActiveThreadId(remaining[0].id)
            const msgs = readJson(messagesKey(remaining[0].id), [])
            setMessages(Array.isArray(msgs) ? msgs : [])
          } else if (wsId) {
            await refreshThreads(wsId)
          } else {
            const local = createLocalThread(null)
            setThreads([local])
            setActiveThreadId(local.id)
            setMessages([])
          }
        }
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
    [activeThreadId, activeWorkspace?.id, refreshThreads, threads],
  )

  const toggleThreadPin = useCallback(
    async (threadId, isPinned) => {
      if (!threadId) return { ok: false }
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, isPinned: Boolean(isPinned) } : t)),
      )
      try {
        const response = await apiFetch(`/api/v1/threads/${threadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_pinned: Boolean(isPinned) }),
        })
        if (!response.ok) {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId ? { ...t, isPinned: !isPinned } : t,
            ),
          )
          return { ok: false }
        }
        const row = await response.json()
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? mapServerThread(row, t.workspaceId) : t,
          ),
        )
        return { ok: true }
      } catch {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, isPinned: !isPinned } : t,
          ),
        )
        return { ok: false }
      }
    },
    [],
  )

  const selectThread = useCallback(
    (threadId) => {
      setActiveThreadId(threadId)
      const msgs = readJson(messagesKey(threadId), [])
      setMessages(Array.isArray(msgs) ? msgs : [])
      setViewModeRaw((current) => (current === 'ide' ? 'ide' : 'chat'))
      if (activeWorkspace?.id) {
        syncThreadMessagesFromServer(threadId, activeWorkspace.id)
      }
    },
    [activeWorkspace?.id, syncThreadMessagesFromServer],
  )

  const resetChat = useCallback(async () => {
    const wsId = activeWorkspace?.id || null
    setViewModeRaw((current) => (current === 'ide' ? 'ide' : 'chat'))

    if (!wsId) {
      const thread = createLocalThread(null)
      setThreads((prev) => [thread, ...prev])
      setActiveThreadId(thread.id)
      setMessages([])
      writeJson(messagesKey(thread.id), [])
      return
    }

    const clientId = crypto.randomUUID()
    const optimistic = {
      id: clientId,
      title: 'New chat',
      workspaceId: wsId,
      updatedAt: Date.now(),
      preview: '',
      isPinned: false,
    }
    setThreads((prev) => [optimistic, ...prev])
    setActiveThreadId(clientId)
    setMessages([])
    writeJson(messagesKey(clientId), [])

    try {
      const response = await apiFetch(`/api/v1/workspaces/${wsId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, title: 'New chat' }),
      })
      if (!response.ok) return
      const created = await response.json()
      const mapped = mapServerThread(created, wsId)
      setThreads((prev) => {
        const without = prev.filter((t) => t.id !== clientId && t.id !== mapped.id)
        return [mapped, ...without]
      })
      setActiveThreadId(mapped.id)
    } catch {
      /* keep optimistic local thread */
    }
  }, [activeWorkspace?.id, setViewMode])

  const saveMessages = useCallback(
    (threadId, nextMessages, workspaceId) => {
      if (!threadId) return
      writeJson(messagesKey(threadId), nextMessages)
      const preview =
        nextMessages.find((m) => m.role === 'user')?.content?.slice(0, 80) ||
        'New chat'
      const title = preview.slice(0, 48) || 'New chat'

      setThreads((prev) => {
        const next = prev.map((t) => {
          if (t.id !== threadId) return t
          if (t.title === title && t.preview === preview) return t
          return {
            ...t,
            title,
            preview,
            updatedAt: Date.now(),
          }
        })
        if (next === prev || next.every((t, i) => t === prev[i])) return prev
        return next
      })

      if (
        workspaceId &&
        title !== 'New chat' &&
        !titlePatchedRef.current.has(threadId)
      ) {
        titlePatchedRef.current.add(threadId)
        void patchThreadTitle(threadId, title)
      }
    },
    [patchThreadTitle],
  )

  const appendArtifact = useCallback(
    (content) => {
      if (!content?.trim()) return
      const entry = {
        id: crypto.randomUUID(),
        content,
        createdAt: Date.now(),
        workspaceId: activeWorkspace?.id || null,
      }
      setArtifactLibrary((prev) => {
        const next = [entry, ...prev].slice(0, 50)
        writeJson(artifactsKey(activeWorkspace?.id || null), next)
        return next
      })
    },
    [activeWorkspace?.id],
  )

  useEffect(() => {
    refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await refreshThreads(activeWorkspace?.id || null)
      if (cancelled) return
      const firstId = list[0]?.id
      if (activeWorkspace?.id && firstId) {
        await syncThreadMessagesFromServer(firstId, activeWorkspace.id)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspace?.id, refreshThreads, syncThreadMessagesFromServer])

  useEffect(() => {
    if (!activeThreadId) return
    saveMessages(activeThreadId, messages, activeWorkspace?.id)
  }, [messages, activeThreadId, activeWorkspace?.id, saveMessages])

  useEffect(() => {
    applyAppearanceClass(appearance)
    try {
      localStorage.setItem(APPEARANCE_KEY, appearance)
    } catch {
      /* ignore */
    }
  }, [appearance])

  useEffect(() => {
    let cancelled = false
    async function ping() {
      try {
        const response = await fetch('/health')
        if (!cancelled) setApiHealthy(response.ok)
      } catch {
        if (!cancelled) setApiHealthy(false)
      }
    }
    ping()
    const id = setInterval(ping, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const value = useMemo(
    () => ({
      workspaces,
      setWorkspaces,
      workspacesLoading,
      refreshWorkspaces,
      deleteWorkspace,
      activeWorkspace,
      setActiveWorkspace,
      sdlcPhase,
      setSdlcPhase,
      forceConfidential,
      setForceConfidential,
      skillsMode,
      setSkillsMode,
      viewMode,
      setViewMode,
      workspaceModal,
      openWorkspaceModal,
      closeWorkspaceModal,
      messages,
      setMessages,
      threads,
      activeThreadId,
      selectThread,
      resetChat,
      deleteThread,
      toggleThreadPin,
      artifactLibrary,
      appendArtifact,
      inputMode,
      setInputMode,
      selectedModelKey,
      setSelectedModelKey,
      /** @deprecated use selectedModelKey */
      modelOverride: modelOverrideFromKey(selectedModelKey),
      /** @deprecated use setSelectedModelKey */
      setModelOverride: (value) => {
        if (value == null || value === '') {
          setSelectedModelKey('auto')
          return
        }
        const match = MODEL_OPTIONS.find((o) => o.value === value)
        if (match) {
          setSelectedModelKey(
            match.id === 'auto' ? 'auto' : `${match.id}:${match.value}`,
          )
          return
        }
        setSelectedModelKey(String(value))
      },
      apiHealthy,
      appearance,
      setAppearance,
      toggleAppearance,
      composerSeed,
      seedComposer,
      persistThreadMessagesToServer,
      syncThreadMessagesFromServer,
      refreshThreads,
      openFiles,
      activeFilePath,
      pendingDiff,
      ideTreeCache,
      setIdeTreeCache,
      openIdeFile,
      closeIdeFile,
      setActiveFile,
      updateIdeFileContent,
      markDirty,
      setPendingDiff,
      clearPendingDiff,
      openWorkspaceInIde,
      languageFromPath,
    }),
    [
      workspaces,
      workspacesLoading,
      refreshWorkspaces,
      deleteWorkspace,
      activeWorkspace,
      sdlcPhase,
      forceConfidential,
      skillsMode,
      setSkillsMode,
      viewMode,
      setViewMode,
      workspaceModal,
      openWorkspaceModal,
      closeWorkspaceModal,
      messages,
      threads,
      activeThreadId,
      selectThread,
      resetChat,
      deleteThread,
      toggleThreadPin,
      artifactLibrary,
      appendArtifact,
      inputMode,
      setInputMode,
      selectedModelKey,
      apiHealthy,
      appearance,
      setAppearance,
      toggleAppearance,
      composerSeed,
      seedComposer,
      persistThreadMessagesToServer,
      syncThreadMessagesFromServer,
      refreshThreads,
      openFiles,
      activeFilePath,
      pendingDiff,
      ideTreeCache,
      openIdeFile,
      closeIdeFile,
      setActiveFile,
      updateIdeFileContent,
      markDirty,
      setPendingDiff,
      clearPendingDiff,
      openWorkspaceInIde,
      languageFromPath,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useApp must be used within AppProvider')
  }
  return ctx
}
