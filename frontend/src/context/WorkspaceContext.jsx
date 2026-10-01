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
import { artifactsKey, threadsKey } from '../lib/appStorage'
import { parseProjectRoute, pathForView, projectPath, viewModeFromPath } from '../lib/routes'

const WorkspaceContext = createContext(null)

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspace, setActiveWorkspace] = useState(null)
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [workspaceModal, setWorkspaceModal] = useState({ open: false, mode: 'create' })
  const [ideTreeCache, setIdeTreeCache] = useState([])
  const location = useLocation()
  const navigate = useNavigate()
  const viewMode = viewModeFromPath(location.pathname)
  const projectRoute = parseProjectRoute(location.pathname)
  const routeWorkspaceId = projectRoute?.workspaceId || null
  const routeTab = projectRoute?.tab || 'overview'
  const navRef = useRef({ navigate, workspaceId: null })
  navRef.current = { navigate, workspaceId: activeWorkspace?.id || null }
  const appliedRouteWorkspaceRef = useRef(null)

  const setViewMode = useCallback((mode, { workspaceId } = {}) => {
    const ref = navRef.current
    ref.navigate(pathForView(mode, workspaceId ?? ref.workspaceId))
  }, [])

  const openProject = useCallback((workspace, tab = 'overview') => {
    if (!workspace?.id) return
    setActiveWorkspace(workspace)
    appliedRouteWorkspaceRef.current = workspace.id
    navRef.current.navigate(projectPath(workspace.id, tab))
  }, [])

  const openWorkspaceInIde = useCallback(
    (workspace) => {
      const target = workspace || null
      if (target) {
        openProject(target, 'files')
        return
      }
      const ref = navRef.current
      ref.navigate(projectPath(ref.workspaceId, 'files'))
    },
    [openProject],
  )

  const openWorkspaceModal = useCallback((mode = 'create') => {
    setWorkspaceModal({ open: true, mode })
  }, [])

  const closeWorkspaceModal = useCallback(() => {
    setWorkspaceModal((current) => ({ ...current, open: false }))
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
        // Optimistic clear so in-flight thread/analytics effects stop using the deleted id;
        // ChatProvider resets its thread state when the active workspace id changes.
        setWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId))
        setActiveWorkspace((current) => (current?.id === workspaceId ? null : current))
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

  useEffect(() => {
    refreshWorkspaces()
  }, [refreshWorkspaces])

  // URL -> state: /projects/:id selects that workspace once the list is loaded.
  useEffect(() => {
    if (!routeWorkspaceId || routeWorkspaceId === appliedRouteWorkspaceRef.current) return
    if (workspacesLoading) return
    const match = workspaces.find((ws) => String(ws.id) === routeWorkspaceId)
    if (!match) {
      appliedRouteWorkspaceRef.current = null
      navigate('/projects', { replace: true })
      return
    }
    appliedRouteWorkspaceRef.current = routeWorkspaceId
    if (activeWorkspace?.id !== match.id) setActiveWorkspace(match)
  }, [routeWorkspaceId, workspaces, workspacesLoading, activeWorkspace?.id, navigate])

  // State -> URL: switching workspace elsewhere keeps the current project tab in sync.
  useEffect(() => {
    if (!routeWorkspaceId || !activeWorkspace?.id) return
    if (routeWorkspaceId !== appliedRouteWorkspaceRef.current) return
    if (String(activeWorkspace.id) === routeWorkspaceId) return
    appliedRouteWorkspaceRef.current = String(activeWorkspace.id)
    navigate(projectPath(activeWorkspace.id, routeTab), { replace: true })
  }, [activeWorkspace?.id, routeTab, routeWorkspaceId, navigate])

  const value = useMemo(
    () => ({
      workspaces,
      setWorkspaces,
      workspacesLoading,
      refreshWorkspaces,
      deleteWorkspace,
      activeWorkspace,
      setActiveWorkspace,
      workspaceModal,
      openWorkspaceModal,
      closeWorkspaceModal,
      viewMode,
      setViewMode,
      routeTab,
      openProject,
      openWorkspaceInIde,
      ideTreeCache,
      setIdeTreeCache,
    }),
    [
      workspaces,
      workspacesLoading,
      refreshWorkspaces,
      deleteWorkspace,
      activeWorkspace,
      workspaceModal,
      openWorkspaceModal,
      closeWorkspaceModal,
      viewMode,
      setViewMode,
      routeTab,
      openProject,
      openWorkspaceInIde,
      ideTreeCache,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return ctx
}
