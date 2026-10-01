import { NavLink, Navigate, useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { WORKSPACE_TABS, projectPath } from '../../lib/routes'
import AnalyticsDashboard from '../AnalyticsDashboard'
import IdeWorkspace from '../Ide/IdeWorkspace'
import ChangesTab from './ChangesTab'
import InstructionsPanel from './InstructionsPanel'
import KnowledgeTab from './KnowledgeTab'
import PlannedPanel from './PlannedPanel'
import SdlcCommandCenter from './SdlcCommandCenter'

function TabPanel({ tab }) {
  switch (tab.id) {
    case 'overview':
      return <AnalyticsDashboard />
    case 'instructions':
      return <InstructionsPanel />
    case 'sdlc':
      return <SdlcCommandCenter />
    case 'files':
      return <IdeWorkspace />
    case 'knowledge':
      return <KnowledgeTab />
    case 'changes':
      return <ChangesTab />
    case 'agent':
    case 'git':
    case 'cicd':
    case 'execute':
      return <PlannedPanel tab={tab.id} label={tab.label} />
    default:
      return null
  }
}

export default function ProjectWorkspace() {
  const { workspaceId, tab: tabParam } = useParams()
  const { activeWorkspace, pendingDiff } = useApp()
  const tab = WORKSPACE_TABS.find((t) => t.id === tabParam)

  if (!tab) return <Navigate to={projectPath(workspaceId, 'overview')} replace />

  const ready = activeWorkspace && String(activeWorkspace.id) === workspaceId

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="project-workspace">
      <nav
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-2"
        aria-label="Workspace sections"
      >
        {WORKSPACE_TABS.map((item) => (
          <NavLink
            key={item.id}
            to={projectPath(workspaceId, item.id)}
            data-testid={`workspace-tab-${item.id}`}
            className={({ isActive }) =>
              `relative whitespace-nowrap px-3 py-2 text-xs font-medium transition ${
                isActive
                  ? 'text-[var(--app-fg)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
              }`
            }
          >
            {item.label}
            {item.id === 'changes' && pendingDiff ? (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">1</span>
            ) : null}
            {item.status === 'planned' ? (
              <span className="ml-1 text-[9px] uppercase text-[var(--muted)]">soon</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1">
        {ready ? (
          <TabPanel tab={tab} />
        ) : (
          <p className="p-6 text-sm text-[var(--muted)]">Loading project…</p>
        )}
      </div>
    </div>
  )
}
