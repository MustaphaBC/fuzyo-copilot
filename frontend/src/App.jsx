import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { ArtifactProvider } from './context/ArtifactContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { UIProvider } from './context/UIContext'
import AdminPage from './components/Admin/AdminPage'
import ArtifactCanvasModal from './components/Artifacts/ArtifactCanvasModal'
import ArtifactsBrowser from './components/ArtifactsBrowser'
import AuthScreen from './components/AuthScreen'
import ChatContainer from './components/ChatContainer'
import Header from './components/Header'
import ProjectsPage from './components/Projects/ProjectsPage'
import SettingsPage from './components/Settings/SettingsPage'
import Sidebar from './components/Sidebar'
import CommandPalette from './components/UI/CommandPalette'
import ShortcutGuide from './components/UI/ShortcutGuide'
import ToastContainer from './components/UI/ToastContainer'
import ProjectWorkspace from './components/Workspace/ProjectWorkspace'
import WorkspaceModal from './components/WorkspaceModal'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useServerSettingsSync } from './hooks/useServerSettingsSync'

function AppShell() {
  useKeyboardShortcuts()
  useServerSettingsSync()

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <Header />
        <main className="relative flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/login" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<ChatContainer />} />
            <Route path="/chat/:threadId" element={<ChatContainer />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:workspaceId" element={<ProjectWorkspace />} />
            <Route path="/projects/:workspaceId/:tab" element={<ProjectWorkspace />} />
            <Route path="/artifacts" element={<ArtifactsBrowser />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/:section" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
      </div>
      <WorkspaceModal />
      <CommandPalette />
      <ShortcutGuide />
      <ToastContainer />
      <ArtifactCanvasModal />
    </div>
  )
}

function AuthGate() {
  const { session, loading, apiAuthError, clearApiAuthError } = useAuth()
  if (loading) return null
  if (!session) return <AuthScreen />
  return (
    <AppProvider>
      <UIProvider>
        <ArtifactProvider>
          <div className="flex h-screen flex-col bg-[var(--app-bg)] text-[var(--app-fg)]">
            {apiAuthError ? (
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/90 dark:text-amber-100">
                <p className="min-w-0 flex-1">{apiAuthError}</p>
                <button
                  type="button"
                  onClick={clearApiAuthError}
                  className="shrink-0 rounded px-2 py-0.5 hover:bg-amber-100 dark:text-amber-200/80 dark:hover:bg-amber-900/50 dark:hover:text-amber-50"
                  aria-label="Dismiss"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
              <AppShell />
            </div>
          </div>
        </ArtifactProvider>
      </UIProvider>
    </AppProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}
