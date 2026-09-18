import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import ChatContainer from '../ChatContainer'
import DiffReviewPanel from './DiffReviewPanel'
import EditorTabBar from './EditorTabBar'
import FileEditor from './FileEditor'
import FileExplorer from './FileExplorer'

export default function IdeWorkspace() {
  const { activeWorkspace, pendingDiff } = useApp()
  const {
    ideExplorerCollapsed,
    ideAgentCollapsed,
    toggleIdeExplorerCollapsed,
    toggleIdeAgentCollapsed,
  } = useUI()

  if (!activeWorkspace) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted)]"
        data-testid="ide-workspace-empty"
      >
        Select a project to open the IDE workspace.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1" data-testid="ide-workspace">
      {ideExplorerCollapsed ? (
        <aside
          className="flex w-10 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--panel)] py-2"
          data-testid="explorer-rail"
        >
          <button
            type="button"
            data-testid="expand-explorer"
            aria-label="Expand explorer"
            title="Expand explorer"
            onClick={toggleIdeExplorerCollapsed}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </aside>
      ) : (
        <FileExplorer />
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--panel)]">
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--panel-elevated)] px-1.5 py-0.5">
          {ideExplorerCollapsed ? (
            <button
              type="button"
              data-testid="expand-explorer-chrome"
              aria-label="Expand explorer"
              title="Expand explorer"
              onClick={toggleIdeExplorerCollapsed}
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="collapse-explorer-chrome"
              aria-label="Collapse explorer"
              title="Collapse explorer"
              onClick={toggleIdeExplorerCollapsed}
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <EditorTabBar />
          </div>
          {ideAgentCollapsed ? (
            <button
              type="button"
              data-testid="expand-agent-chrome"
              aria-label="Expand agent"
              title="Expand agent"
              onClick={toggleIdeAgentCollapsed}
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="collapse-agent-chrome"
              aria-label="Collapse agent"
              title="Collapse agent"
              onClick={toggleIdeAgentCollapsed}
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {pendingDiff ? <DiffReviewPanel /> : <FileEditor />}
        </div>
      </section>

      {ideAgentCollapsed ? (
        <aside
          className="flex w-10 shrink-0 flex-col items-center border-l border-[var(--border)] bg-[var(--panel)] py-2"
          data-testid="agent-rail"
        >
          <button
            type="button"
            data-testid="expand-agent"
            aria-label="Expand agent"
            title="Expand agent"
            onClick={toggleIdeAgentCollapsed}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </aside>
      ) : (
        <aside
          className="flex h-full min-h-0 w-[min(380px,38vw)] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]"
          data-testid="ide-chat-panel"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Agent
            </p>
            <button
              type="button"
              data-testid="collapse-agent"
              aria-label="Collapse agent"
              title="Collapse agent"
              onClick={toggleIdeAgentCollapsed}
              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatContainer />
          </div>
        </aside>
      )}
    </div>
  )
}
