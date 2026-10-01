export const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview', status: 'current' },
  { id: 'instructions', label: 'Instructions', status: 'current' },
  { id: 'sdlc', label: 'SDLC', status: 'current' },
  { id: 'files', label: 'Files', status: 'current' },
  { id: 'knowledge', label: 'Knowledge', status: 'current' },
  { id: 'agent', label: 'Agent', status: 'planned' },
  { id: 'changes', label: 'Changes', status: 'current' },
  { id: 'git', label: 'Git', status: 'planned' },
  { id: 'cicd', label: 'CI/CD', status: 'planned' },
  { id: 'execute', label: 'Execute', status: 'planned' },
]

const PROJECT_ROUTE = /^\/projects\/([^/]+)(?:\/([^/]+))?/
const CHAT_ROUTE = /^\/chat\/([^/]+)/

export function parseProjectRoute(pathname) {
  const match = PROJECT_ROUTE.exec(pathname || '')
  if (!match) return null
  return { workspaceId: decodeURIComponent(match[1]), tab: match[2] || 'overview' }
}

export function parseChatThreadId(pathname) {
  const match = CHAT_ROUTE.exec(pathname || '')
  return match ? decodeURIComponent(match[1]) : null
}

/** Derives the legacy view-mode name from the URL so existing callers keep working. */
export function viewModeFromPath(pathname) {
  const path = pathname || '/'
  const project = parseProjectRoute(path)
  if (project) return project.tab === 'files' ? 'ide' : 'dashboard'
  if (path.startsWith('/projects')) return 'projects'
  if (path.startsWith('/artifacts')) return 'artifacts'
  if (path.startsWith('/settings')) return 'settings'
  if (path.startsWith('/admin')) return 'admin'
  return 'chat'
}

export function projectPath(workspaceId, tab = 'overview') {
  if (!workspaceId) return '/projects'
  return `/projects/${encodeURIComponent(workspaceId)}/${tab}`
}

export function pathForView(mode, workspaceId) {
  switch (mode) {
    case 'analytics':
    case 'dashboard':
      return projectPath(workspaceId, 'overview')
    case 'ide':
      return projectPath(workspaceId, 'files')
    case 'projects':
      return '/projects'
    case 'artifacts':
      return '/artifacts'
    case 'customize':
    case 'settings':
      return '/settings'
    case 'admin':
      return '/admin'
    default:
      return '/chat'
  }
}
