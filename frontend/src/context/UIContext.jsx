import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const UIContext = createContext(null)
const SIDEBAR_KEY = 'fuzyo:sidebar-collapsed'
const IDE_EXPLORER_KEY = 'fuzyo:ide-explorer-collapsed'
const IDE_AGENT_KEY = 'fuzyo:ide-agent-collapsed'

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function UIProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readFlag(SIDEBAR_KEY))
  const [ideExplorerCollapsed, setIdeExplorerCollapsed] = useState(() =>
    readFlag(IDE_EXPLORER_KEY),
  )
  const [ideAgentCollapsed, setIdeAgentCollapsed] = useState(() => readFlag(IDE_AGENT_KEY))
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false)
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    writeFlag(SIDEBAR_KEY, sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    writeFlag(IDE_EXPLORER_KEY, ideExplorerCollapsed)
  }, [ideExplorerCollapsed])

  useEffect(() => {
    writeFlag(IDE_AGENT_KEY, ideAgentCollapsed)
  }, [ideAgentCollapsed])

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((v) => !v)
  }, [])

  const toggleIdeExplorerCollapsed = useCallback(() => {
    setIdeExplorerCollapsed((v) => !v)
  }, [])

  const toggleIdeAgentCollapsed = useCallback(() => {
    setIdeAgentCollapsed((v) => !v)
  }, [])

  const pushToast = useCallback((toast) => {
    const id = crypto.randomUUID()
    const entry = {
      id,
      type: toast.type || 'info',
      message: toast.message || '',
      duration: toast.duration ?? 3500,
    }
    setToasts((prev) => [...prev, entry])
    return id
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value = useMemo(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebarCollapsed,
      ideExplorerCollapsed,
      setIdeExplorerCollapsed,
      toggleIdeExplorerCollapsed,
      ideAgentCollapsed,
      setIdeAgentCollapsed,
      toggleIdeAgentCollapsed,
      mobileSidebarOpen,
      setMobileSidebarOpen,
      commandPaletteOpen,
      setCommandPaletteOpen,
      shortcutGuideOpen,
      setShortcutGuideOpen,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      sidebarCollapsed,
      toggleSidebarCollapsed,
      ideExplorerCollapsed,
      toggleIdeExplorerCollapsed,
      ideAgentCollapsed,
      toggleIdeAgentCollapsed,
      mobileSidebarOpen,
      commandPaletteOpen,
      shortcutGuideOpen,
      toasts,
      pushToast,
      dismissToast,
    ],
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
