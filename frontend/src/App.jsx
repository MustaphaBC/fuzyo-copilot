import { AppProvider, useApp } from './context/AppContext'
import { ArtifactProvider } from './context/ArtifactContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { UIProvider } from './context/UIContext'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import ArtifactCanvasModal from './components/Artifacts/ArtifactCanvasModal'
import ArtifactsBrowser from './components/ArtifactsBrowser'
import AuthScreen from './components/AuthScreen'
import ChatContainer from './components/ChatContainer'
import Header from './components/Header'
import IdeWorkspace from './components/Ide/IdeWorkspace'
import Sidebar from './components/Sidebar'
import CommandPalette from './components/UI/CommandPalette'
import ShortcutGuide from './components/UI/ShortcutGuide'
import ToastContainer from './components/UI/ToastContainer'
import WorkspaceModal from './components/WorkspaceModal'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

function AppShell() {
  const { viewMode } = useApp()
  const showChat = viewMode === 'chat' || viewMode === 'customize'
  useKeyboardShortcuts()

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <Header />
        <main className="relative flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
          {viewMode === 'dashboard' && <AnalyticsDashboard />}
          {viewMode === 'artifacts' && <ArtifactsBrowser />}
          {viewMode === 'ide' && <IdeWorkspace />}
          {showChat && <ChatContainer />}
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
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-800/50 bg-amber-950/90 px-4 py-2 text-sm text-amber-100">
                <p className="min-w-0 flex-1">{apiAuthError}</p>
                <button
                  type="button"
                  onClick={clearApiAuthError}
                  className="shrink-0 rounded px-2 py-0.5 text-amber-200/80 hover:bg-amber-900/50 hover:text-amber-50"
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
