import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider, useApp } from '../../src/context/AppContext'
import { useChat, useChatControls } from '../../src/context/ChatContext'
import { useEditor } from '../../src/context/EditorContext'
import { usePreferences } from '../../src/context/PreferencesContext'
import { useWorkspace } from '../../src/context/WorkspaceContext'

const PROBE_TIMEOUT_MS = 10_000

function typeMap(value) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry]))
}

function Probe({ onReport }) {
  const snapshot = {
    preferences: usePreferences(),
    workspace: useWorkspace(),
    editor: useEditor(),
    controls: useChatControls(),
    chat: useChat(),
    app: useApp(),
  }
  useEffect(() => {
    onReport(snapshot)
  })
  return null
}

/**
 * Mounts the real AppProvider in isolation (MemoryRouter), reports each hook's key surface and
 * simulates a streamed token to check which context values change identity.
 */
export function probeContexts() {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div')
    host.hidden = true
    document.body.appendChild(host)
    const root = createRoot(host)
    let stage = 'boot'
    let beforeToken = null
    let settled = false

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      queueMicrotask(() => {
        root.unmount()
        host.remove()
        if (error) reject(error)
        else resolve(result)
      })
    }
    const timer = setTimeout(() => finish(new Error(`probe timed out at stage "${stage}"`)), PROBE_TIMEOUT_MS)

    const onReport = (snap) => {
      switch (stage) {
        case 'boot': {
          if (snap.workspace.workspacesLoading || !snap.chat.activeThreadId) return
          stage = 'seeded'
          snap.controls.setMessages([
            { id: 'probe-user', role: 'user', content: 'probe question' },
            { id: 'probe-assistant', role: 'assistant', content: 'partial', isStreaming: true },
          ])
          return
        }
        case 'seeded': {
          if (snap.chat.messages.length !== 2) return
          if (snap.chat.threads[0]?.title !== 'probe question') return
          stage = 'token'
          beforeToken = snap
          snap.controls.setMessages((prev) =>
            prev.map((msg) =>
              msg.id === 'probe-assistant' ? { ...msg, content: 'partial token' } : msg,
            ),
          )
          return
        }
        case 'token': {
          if (snap.chat.messages[1]?.content !== 'partial token') return
          stage = 'done'
          finish(null, {
            types: {
              preferences: typeMap(snap.preferences),
              workspace: typeMap(snap.workspace),
              editor: typeMap(snap.editor),
              controls: typeMap(snap.controls),
              chat: typeMap(snap.chat),
              app: typeMap(snap.app),
            },
            stableAcrossToken: {
              preferences: beforeToken.preferences === snap.preferences,
              workspace: beforeToken.workspace === snap.workspace,
              editor: beforeToken.editor === snap.editor,
              controls: beforeToken.controls === snap.controls,
              chat: beforeToken.chat === snap.chat,
              app: beforeToken.app === snap.app,
            },
            appSeesToken: snap.app.messages[1]?.content === 'partial token',
          })
          return
        }
        case 'done':
          return
        default: {
          const exhaustive = stage
          throw new Error(`Unknown probe stage: ${exhaustive}`)
        }
      }
    }

    root.render(
      <MemoryRouter initialEntries={['/chat']}>
        <AppProvider>
          <Probe onReport={onReport} />
        </AppProvider>
      </MemoryRouter>,
    )
  })
}
