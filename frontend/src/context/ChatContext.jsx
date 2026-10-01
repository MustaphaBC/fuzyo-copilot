import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import {
  aiBehaviorKey,
  artifactsKey,
  messagesKey,
  readJson,
  threadsKey,
  writeJson,
} from '../lib/appStorage'
import { DEFAULT_AI_BEHAVIOR } from '../lib/chatConfig'
import { parseChatThreadId } from '../lib/routes'
import { useWorkspace } from './WorkspaceContext'

const ChatControlsContext = createContext(null)
const ChatContext = createContext(null)

function readAiBehavior(workspaceId) {
  const stored = readJson(aiBehaviorKey(workspaceId), null)
  return { ...DEFAULT_AI_BEHAVIOR, ...(stored && typeof stored === 'object' ? stored : {}) }
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

async function patchThreadTitle(threadId, title) {
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
}

export function ChatProvider({ children }) {
  const { activeWorkspace, viewMode } = useWorkspace()
  const activeWorkspaceId = activeWorkspace?.id || null
  const location = useLocation()
  const navigate = useNavigate()
  const routeThreadId = parseChatThreadId(location.pathname)

  const [sdlcPhase, setSdlcPhase] = useState(1)
  const [forceConfidential, setForceConfidential] = useState(false)
  const [skillsMode, setSkillsModeState] = useState(null)
  const [inputMode, setInputModeState] = useState('chat')
  const [selectedModelKey, setSelectedModelKey] = useState('auto')
  const [composerSeed, setComposerSeed] = useState(null)
  const [aiBehavior, setAiBehaviorState] = useState(DEFAULT_AI_BEHAVIOR)

  const [messages, setMessages] = useState([])
  const [threads, setThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [artifactLibrary, setArtifactLibrary] = useState([])

  const titlePatchedRef = useRef(new Set())
  const navRef = useRef({ navigate, viewMode, pathname: '/' })
  navRef.current = { navigate, viewMode, pathname: location.pathname }
  const appliedRouteThreadRef = useRef(null)

  const seedComposer = useCallback((text, { autoSend = false } = {}) => {
    setComposerSeed({ text: String(text || ''), nonce: Date.now(), autoSend })
  }, [])

  const setAiBehavior = useCallback(
    (patch) => {
      setAiBehaviorState((current) => {
        const next = { ...current, ...patch }
        writeJson(aiBehaviorKey(activeWorkspaceId), next)
        return next
      })
    },
    [activeWorkspaceId],
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

  const persistThreadMessagesToServer = useCallback(
    async (threadId, nextMessages, workspaceId = activeWorkspaceId) => {
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
    [activeWorkspaceId],
  )

  const syncThreadMessagesFromServer = useCallback(
    async (threadId, workspaceId = activeWorkspaceId) => {
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
    [activeWorkspaceId],
  )

  const refreshThreads = useCallback(async (workspaceId) => {
    if (!workspaceId) {
      const local = createLocalThread(null)
      setThreads([local])
      setActiveThreadId(local.id)
      setMessages([])
      setArtifactLibrary([])
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

  const deleteThread = useCallback(
    async (threadId) => {
      if (!threadId) return { ok: false }
      const wsId = activeWorkspaceId
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
    [activeThreadId, activeWorkspaceId, refreshThreads, threads],
  )

  const toggleThreadPin = useCallback(async (threadId, isPinned) => {
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
  }, [])

  const selectThread = useCallback(
    (threadId) => {
      setActiveThreadId(threadId)
      const msgs = readJson(messagesKey(threadId), [])
      setMessages(Array.isArray(msgs) ? msgs : [])
      const nav = navRef.current
      const target = `/chat/${encodeURIComponent(threadId)}`
      if (nav.viewMode !== 'ide' && nav.pathname !== target) {
        appliedRouteThreadRef.current = threadId
        nav.navigate(target)
      }
      if (activeWorkspaceId) {
        syncThreadMessagesFromServer(threadId, activeWorkspaceId)
      }
    },
    [activeWorkspaceId, syncThreadMessagesFromServer],
  )

  const resetChat = useCallback(async () => {
    const wsId = activeWorkspaceId
    if (navRef.current.viewMode !== 'ide') {
      appliedRouteThreadRef.current = null
      navRef.current.navigate('/chat')
    }

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
  }, [activeWorkspaceId])

  const saveMessages = useCallback((threadId, nextMessages, workspaceId) => {
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
  }, [])

  const appendArtifact = useCallback(
    (content) => {
      if (!content?.trim()) return
      const entry = {
        id: crypto.randomUUID(),
        content,
        createdAt: Date.now(),
        workspaceId: activeWorkspaceId,
      }
      setArtifactLibrary((prev) => {
        const next = [entry, ...prev].slice(0, 50)
        writeJson(artifactsKey(activeWorkspaceId), next)
        return next
      })
    },
    [activeWorkspaceId],
  )

  useEffect(() => {
    setAiBehaviorState(readAiBehavior(activeWorkspaceId))
  }, [activeWorkspaceId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await refreshThreads(activeWorkspaceId)
      if (cancelled) return
      const firstId = list[0]?.id
      if (activeWorkspaceId && firstId) {
        await syncThreadMessagesFromServer(firstId, activeWorkspaceId)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, refreshThreads, syncThreadMessagesFromServer])

  useEffect(() => {
    if (!activeThreadId) return
    saveMessages(activeThreadId, messages, activeWorkspaceId)
  }, [messages, activeThreadId, activeWorkspaceId, saveMessages])

  // URL -> state: /chat/:threadId selects that thread when it belongs to the loaded list.
  useEffect(() => {
    if (!routeThreadId || routeThreadId === appliedRouteThreadRef.current) return
    if (threads.length === 0) return
    appliedRouteThreadRef.current = routeThreadId
    if (routeThreadId !== activeThreadId && threads.some((t) => t.id === routeThreadId)) {
      selectThread(routeThreadId)
    }
  }, [routeThreadId, threads, activeThreadId, selectThread])

  // State -> URL: reflect the active thread in /chat/:threadId.
  useEffect(() => {
    if (viewMode !== 'chat' || !activeThreadId) return
    if (routeThreadId && routeThreadId !== appliedRouteThreadRef.current) return
    if (routeThreadId === activeThreadId) return
    appliedRouteThreadRef.current = activeThreadId
    navigate(`/chat/${encodeURIComponent(activeThreadId)}`, { replace: true })
  }, [viewMode, activeThreadId, routeThreadId, navigate])

  const controls = useMemo(
    () => ({
      sdlcPhase,
      setSdlcPhase,
      forceConfidential,
      setForceConfidential,
      skillsMode,
      setSkillsMode,
      inputMode,
      setInputMode,
      selectedModelKey,
      setSelectedModelKey,
      composerSeed,
      seedComposer,
      aiBehavior,
      setAiBehavior,
      setMessages,
      selectThread,
      resetChat,
      deleteThread,
      toggleThreadPin,
      appendArtifact,
      persistThreadMessagesToServer,
      syncThreadMessagesFromServer,
      refreshThreads,
    }),
    [
      sdlcPhase,
      forceConfidential,
      skillsMode,
      setSkillsMode,
      inputMode,
      setInputMode,
      selectedModelKey,
      composerSeed,
      seedComposer,
      aiBehavior,
      setAiBehavior,
      selectThread,
      resetChat,
      deleteThread,
      toggleThreadPin,
      appendArtifact,
      persistThreadMessagesToServer,
      syncThreadMessagesFromServer,
      refreshThreads,
    ],
  )

  const value = useMemo(
    () => ({
      ...controls,
      messages,
      threads,
      activeThreadId,
      artifactLibrary,
    }),
    [controls, messages, threads, activeThreadId, artifactLibrary],
  )

  return (
    <ChatControlsContext.Provider value={controls}>
      <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    </ChatControlsContext.Provider>
  )
}

/** Full chat state, including the streamed message list (re-renders on every token). */
export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider')
  }
  return ctx
}

/**
 * Chat settings (phase, privacy, skills, model, aiBehavior, composer seed) and thread actions,
 * without messages/threads — stays referentially stable while a response streams.
 */
export function useChatControls() {
  const ctx = useContext(ChatControlsContext)
  if (!ctx) {
    throw new Error('useChatControls must be used within ChatProvider')
  }
  return ctx
}
