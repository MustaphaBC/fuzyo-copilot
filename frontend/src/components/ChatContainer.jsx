import {
  LayoutTemplate,
  PanelRight,
  Paperclip,
  Send,
  Shield,
  ShieldOff,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseSelectedModelKey, SDLC_PHASES, useApp } from '../context/AppContext'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { apiFetch } from '../lib/api'
import ModelSelector from './Chat/ModelSelector'
import CanvasDrawer, { detectArtifacts } from './CanvasDrawer'
import EmptyState from './UI/EmptyState'
import InspectorDrawer from './InspectorDrawer'
import MessageItem from './MessageItem'

const SKILL_CHIPS = [
  { id: 'plan', label: 'plan' },
  { id: 'analyze', label: 'analyze' },
  { id: 'review', label: 'review' },
  { id: 'debug', label: 'debug' },
]

function hasVisualArtifacts(content) {
  const artifacts = detectArtifacts(content)
  return (
    artifacts.mermaid.length > 0 ||
    artifacts.html.length > 0 ||
    artifacts.code.length > 0
  )
}

function buildPrompt(raw, skillsMode) {
  const text = raw.trim()
  if (!skillsMode) return text
  return `/${skillsMode}\n\n${text}`
}

async function consumeSse(response, handlers, signal) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body stream')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  const onAbort = () => {
    try {
      reader.cancel()
    } catch {
      /* ignore */
    }
  }
  if (signal) {
    if (signal.aborted) {
      onAbort()
      throw new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trimEnd()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let event
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        handlers.onEvent?.(event)
        // Yield to the browser so React can paint (retry badge) between SSE events.
        if (event?.type === 'retry') {
          await new Promise((resolve) => setTimeout(resolve, 280))
        } else {
          await Promise.resolve()
        }
      }
    }

    const trailing = buffer.trim()
    if (trailing.startsWith('data:')) {
      const payload = trailing.slice(5).trim()
      if (payload && payload !== '[DONE]') {
        try {
          handlers.onEvent?.(JSON.parse(payload))
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function Composer({
  input,
  setInput,
  streaming,
  onSend,
  onStop,
  onOpenInspector,
  onOpenCanvas,
  canvasEnabled,
  fileInputRef,
  onAttachClick,
  onFileChange,
  uploadBusy,
  uploadError,
  collapsed = false,
  onExpand,
}) {
  const {
    sdlcPhase,
    setSdlcPhase,
    forceConfidential,
    setForceConfidential,
    skillsMode,
    setSkillsMode,
    inputMode,
    setInputMode,
    activeWorkspace,
  } = useApp()

  const phase = SDLC_PHASES.find((item) => item.id === sdlcPhase)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!collapsed) {
      textareaRef.current?.focus()
    }
  }, [collapsed])

  if (collapsed) {
    const preview = input.trim() || 'Message Fuzyo…'
    return (
      <div className="mx-auto w-full min-w-0 max-w-3xl">
        <button
          type="button"
          onClick={onExpand}
          className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--composer)] px-4 py-3 text-left shadow-lg shadow-black/20 transition hover:border-[var(--muted)] hover:bg-[var(--hover)]"
          data-testid="composer-collapsed"
          aria-label="Expand message bar"
          title="Click to expand"
        >
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              input.trim() ? 'text-[var(--app-fg)]' : 'text-[var(--muted)]'
            }`}
          >
            {preview}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--muted)]">
            Phase {sdlcPhase}
          </span>
          <Send className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-2" data-testid="composer-expanded">
      {inputMode === 'cowork' && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {SKILL_CHIPS.map((skill) => {
            const active = skillsMode === skill.id
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => setSkillsMode(skill.id)}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  active
                    ? 'border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]'
                }`}
              >
                /{skill.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--composer)] shadow-lg shadow-black/20">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          rows={3}
          disabled={streaming}
          placeholder="Message Fuzyo…"
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
        />

        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-t border-[var(--border)] px-3 py-2.5">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".md,.markdown,.pdf,.docx,.xlsx"
            onChange={onFileChange}
          />
          <button
            type="button"
            onClick={onAttachClick}
            disabled={!activeWorkspace || uploadBusy || streaming}
            className="shrink-0 rounded-md border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Attach document"
            title={
              activeWorkspace
                ? 'Upload document to workspace'
                : 'Select a project to upload'
            }
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <div className="inline-flex shrink-0 rounded-lg border border-[var(--border)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setInputMode('chat')}
              className={`rounded-md px-2.5 py-1 transition ${
                inputMode === 'chat'
                  ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                  : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setInputMode('cowork')}
              className={`rounded-md px-2.5 py-1 transition ${
                inputMode === 'cowork'
                  ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                  : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
              }`}
            >
              Cowork
            </button>
          </div>

          <label className="sr-only" htmlFor="sdlc-phase-select">
            SDLC phase
          </label>
          <select
            id="sdlc-phase-select"
            value={sdlcPhase}
            onChange={(event) => setSdlcPhase(Number(event.target.value))}
            className="max-w-[9.5rem] shrink truncate rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
            title={phase ? `${phase.id}. ${phase.label}` : 'SDLC phase'}
          >
            {SDLC_PHASES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}. {item.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            role="switch"
            aria-checked={forceConfidential}
            aria-label={
              forceConfidential ? 'Confidential ON' : 'Confidential OFF'
            }
            onClick={() => setForceConfidential(!forceConfidential)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition ${
              forceConfidential
                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--app-fg)]'
            }`}
          >
            {forceConfidential ? (
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {forceConfidential ? 'Confidential' : 'Open'}
          </button>

          <div className="min-w-0 shrink">
            <ModelSelector />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenInspector}
              className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
              aria-label="Open inspector"
              title="Inspector"
            >
              <PanelRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onOpenCanvas}
              disabled={!canvasEnabled}
              className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-40"
              aria-label="Open canvas"
              title="Canvas"
            >
              <LayoutTemplate className="h-4 w-4" />
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-sm text-red-200 hover:bg-red-950/70"
                data-testid="stop-generating"
              >
                Stop Generating
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!input.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {(uploadBusy || uploadError) && (
        <p
          className={`px-1 text-xs ${
            uploadError ? 'text-red-400' : 'text-[var(--muted)]'
          }`}
        >
          {uploadError || 'Uploading document…'}
        </p>
      )}
    </div>
  )
}

export default function ChatContainer() {
  const {
    sdlcPhase,
    forceConfidential,
    activeWorkspace,
    skillsMode,
    messages,
    setMessages,
    selectedModelKey,
    appendArtifact,
    activeThreadId,
    persistThreadMessagesToServer,
    composerSeed,
  } = useApp()

  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasContent, setCanvasContent] = useState('')
  const [meta, setMeta] = useState(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const fileInputRef = useRef(null)
  const abortRef = useRef(null)
  const savedArtifactIds = useRef(new Set())
  const { containerRef, bottomRef, onScroll, showJump, jumpToBottom } = useAutoScroll([
    messages,
    streaming,
  ])
  const phaseLabel =
    SDLC_PHASES.find((item) => item.id === sdlcPhase)?.label ?? 'SDLC'

  useEffect(() => {
    if (!composerSeed?.text) return
    setInput(composerSeed.text)
  }, [composerSeed])

  useEffect(() => {
    const latestAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant')
    if (!latestAssistant?.content) return
    if (!hasVisualArtifacts(latestAssistant.content)) return
    setCanvasContent(latestAssistant.content)
    if (!latestAssistant.isStreaming) {
      setCanvasOpen(true)
      if (!savedArtifactIds.current.has(latestAssistant.id)) {
        savedArtifactIds.current.add(latestAssistant.id)
        appendArtifact(latestAssistant.content)
      }
    }
  }, [messages, appendArtifact])

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeWorkspace?.id) return

    setUploadBusy(true)
    setUploadError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('sdlc_phase', String(sdlcPhase))
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/documents`,
        { method: 'POST', body: form },
      )
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Upload failed (${response.status})`)
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadBusy(false)
    }
  }

  const runCompletion = useCallback(
    async ({ historyMessages, userRaw }) => {
      const prompt = buildPrompt(userRaw, skillsMode)
      const assistantId = crypto.randomUUID()
      const startedAt = Date.now()
      const controller = new AbortController()
      abortRef.current = controller

      setStreaming(true)
      setInspectorOpen(true)
      setMeta({
        routing: null,
        rag: null,
        quality: null,
        skill: null,
        retry: null,
        tokenCount: 0,
        latencyMs: null,
        startedAt,
      })

      const withAssistant = [
        ...historyMessages,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          routingBadge: null,
          isStreaming: true,
        },
      ]
      setMessages(withAssistant)

      try {
        const body = {
          prompt,
          sdlc_phase: sdlcPhase,
          force_confidential: forceConfidential,
          workspace_id: activeWorkspace?.id ?? null,
          history_window: 6,
        }
        if (activeThreadId) {
          body.thread_id = activeThreadId
        }
        const { provider, model } = parseSelectedModelKey(selectedModelKey)
        if (provider && model) {
          body.provider_override = provider
          body.model_override = model
        }

        const response = await apiFetch('/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!response.ok) {
          const detail = await response.text()
          throw new Error(detail || `HTTP ${response.status}`)
        }

        await consumeSse(
          response,
          {
            onEvent: (event) => {
              if (event.type === 'admin_restricted') {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? {
                          ...msg,
                          adminLock: {
                            tool: event.tool,
                            message: event.message,
                          },
                        }
                      : msg,
                  ),
                )
                return
              }
              if (event.type === 'routing') {
                setMeta((prev) => ({ ...prev, routing: event }))
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, routingBadge: event.target_client }
                      : msg,
                  ),
                )
                return
              }
              if (event.type === 'rag') {
                setMeta((prev) => ({ ...prev, rag: event }))
                return
              }
              if (event.type === 'skill') {
                setMeta((prev) => ({ ...prev, skill: event }))
                return
              }
              if (event.type === 'retry') {
                setMeta((prev) => ({ ...prev, retry: event }))
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, isRetrying: true, retryScore: event.attempt_score }
                      : msg,
                  ),
                )
                return
              }
              if (event.type === 'token') {
                const chunk = event.content ?? ''
                setMeta((prev) => ({
                  ...prev,
                  tokenCount: (prev?.tokenCount ?? 0) + 1,
                }))
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: `${msg.content}${chunk}` }
                      : msg,
                  ),
                )
                return
              }
              if (event.type === 'quality') {
                setMeta((prev) => ({
                  ...prev,
                  quality: event,
                  latencyMs: Date.now() - startedAt,
                }))
                const resolved =
                  event.is_valid === true || Number(event.tier3_score) >= 7
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, isRetrying: resolved ? false : msg.isRetrying }
                      : msg,
                  ),
                )
              }
            },
          },
          controller.signal,
        )
      } catch (error) {
        if (error?.name === 'AbortError') {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    content: msg.content || '[stopped]',
                  }
                : msg,
            ),
          )
        } else {
          const message = error instanceof Error ? error.message : 'Stream failed'
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    content: msg.content || `[error] ${message}`,
                  }
                : msg,
            ),
          )
        }
      } finally {
        setMessages((prev) => {
          const next = prev.map((msg) =>
            msg.id === assistantId ? { ...msg, isStreaming: false } : msg,
          )
          if (activeThreadId && activeWorkspace?.id) {
            void persistThreadMessagesToServer(
              activeThreadId,
              next,
              activeWorkspace.id,
            ).then((result) => {
              if (!result?.ok && !result?.skipped) {
                console.warn('Failed to persist chat history', result)
              }
            })
          }
          return next
        })
        setMeta((prev) =>
          prev
            ? {
                ...prev,
                latencyMs: prev.latencyMs ?? Date.now() - startedAt,
              }
            : prev,
        )
        setStreaming(false)
        abortRef.current = null
      }
    },
    [
      activeThreadId,
      activeWorkspace?.id,
      forceConfidential,
      selectedModelKey,
      persistThreadMessagesToServer,
      sdlcPhase,
      setMessages,
      skillsMode,
    ],
  )

  const handleSend = async () => {
    const raw = input.trim()
    if (!raw || streaming) return
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: raw }
    setInput('')
    await runCompletion({
      historyMessages: [...messages, userMessage],
      userRaw: raw,
    })
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleEditUser = async (messageId, nextContent) => {
    if (streaming) return
    const index = messages.findIndex((msg) => msg.id === messageId)
    if (index < 0) return
    const truncated = messages.slice(0, index).concat({
      ...messages[index],
      content: nextContent,
    })
    await runCompletion({ historyMessages: truncated, userRaw: nextContent })
  }

  const handleRegenerate = async (assistantId) => {
    if (streaming) return
    const index = messages.findIndex((msg) => msg.id === assistantId)
    if (index <= 0) return
    let userIndex = index - 1
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex -= 1
    if (userIndex < 0) return
    const truncated = messages.slice(0, userIndex + 1)
    const userRaw = truncated[userIndex].content
    await runCompletion({ historyMessages: truncated, userRaw })
  }

  const isEmpty = messages.length === 0
  const latestAssistantId = [...messages]
    .reverse()
    .find((item) => item.role === 'assistant')?.id

  // Collapse only on user-driven scroll (wheel/touch), not programmatic auto-follow.
  useEffect(() => {
    if (isEmpty) {
      setComposerCollapsed(false)
      return undefined
    }
    const el = containerRef.current
    if (!el) return undefined
    const collapse = () => setComposerCollapsed(true)
    el.addEventListener('wheel', collapse, { passive: true })
    el.addEventListener('touchmove', collapse, { passive: true })
    return () => {
      el.removeEventListener('wheel', collapse)
      el.removeEventListener('touchmove', collapse)
    }
  }, [isEmpty, containerRef, messages.length])

  const expandComposer = useCallback(() => {
    setComposerCollapsed(false)
  }, [])

  const composerProps = {
    input,
    setInput,
    streaming,
    onSend: handleSend,
    onStop: handleStop,
    onOpenInspector: () => setInspectorOpen(true),
    onOpenCanvas: () => setCanvasOpen(true),
    canvasEnabled: Boolean(canvasContent),
    fileInputRef,
    onAttachClick: () => fileInputRef.current?.click(),
    onFileChange: handleFileChange,
    uploadBusy,
    uploadError,
    collapsed: !isEmpty && composerCollapsed,
    onExpand: expandComposer,
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-x-hidden" data-testid="chat-container">
      {isEmpty ? (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6">
            <EmptyState
              title="How can Fuzyo help?"
              description={`Phase ${sdlcPhase} — ${phaseLabel}. Ask for specs, architecture, or code with streaming SSE.`}
            />
          </div>
          <div className="min-w-0 shrink-0 border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3">
            <Composer {...composerProps} />
          </div>
        </>
      ) : (
        <>
          <div
            ref={containerRef}
            onScroll={onScroll}
            className="relative min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 py-4"
          >
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                routingBadge={msg.routingBadge}
                adminLock={msg.adminLock}
                isStreaming={msg.isStreaming}
                isRetrying={msg.isRetrying}
                retryScore={msg.retryScore}
                onEditUser={handleEditUser}
                onRegenerate={handleRegenerate}
                messages={messages}
                meta={meta}
                isLatestAssistant={msg.id === latestAssistantId}
              />
            ))}
            <div ref={bottomRef} />
            {showJump ? (
              <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={jumpToBottom}
                  className="pointer-events-auto rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--app-fg)] shadow-lg"
                  data-testid="scroll-to-bottom"
                >
                  Jump to latest
                </button>
              </div>
            ) : null}
          </div>
          <div
            className={`min-w-0 shrink-0 overflow-x-hidden border-t border-[var(--border)] bg-[var(--panel)] px-4 backdrop-blur transition-[padding] ${
              composerCollapsed ? 'py-2' : 'py-3'
            }`}
          >
            <Composer {...composerProps} />
          </div>
        </>
      )}

      <InspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        meta={meta}
      />
      <CanvasDrawer
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
        content={canvasContent}
      />
    </div>
  )
}

