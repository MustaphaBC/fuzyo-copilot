import { useMemo } from 'react'
import { ChatProvider, useChat } from './ChatContext'
import { EditorProvider, useEditor } from './EditorContext'
import { PreferencesProvider, usePreferences } from './PreferencesContext'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'

export { DEFAULT_AI_BEHAVIOR, parseSelectedModelKey, SDLC_PHASES } from '../lib/chatConfig'

/** Provider order encodes dependencies: Editor and Chat consume `useWorkspace()`. */
export function AppProvider({ children }) {
  return (
    <PreferencesProvider>
      <WorkspaceProvider>
        <EditorProvider>
          <ChatProvider>{children}</ChatProvider>
        </EditorProvider>
      </WorkspaceProvider>
    </PreferencesProvider>
  )
}

/**
 * Aggregates every domain context into the legacy monolithic shape.
 *
 * @deprecated Subscribes to all domains, so the caller re-renders on every streamed token.
 * Use `usePreferences`, `useWorkspace`, `useEditor`, `useChatControls` or `useChat` instead.
 */
export function useApp() {
  const preferences = usePreferences()
  const workspace = useWorkspace()
  const editor = useEditor()
  const chat = useChat()
  return useMemo(
    () => ({ ...preferences, ...workspace, ...editor, ...chat }),
    [preferences, workspace, editor, chat],
  )
}
