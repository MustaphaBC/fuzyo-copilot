import { useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { useUI } from '../context/UIContext'

function isEditableTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function useKeyboardShortcuts() {
  const {
    setCommandPaletteOpen,
    toggleSidebarCollapsed,
    setShortcutGuideOpen,
    setMobileSidebarOpen,
  } = useUI()
  const { resetChat, toggleAppearance } = useApp()

  useEffect(() => {
    function onKeyDown(event) {
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (meta && key === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }

      if (meta && event.key === '\\') {
        event.preventDefault()
        if (window.matchMedia('(max-width: 767px)').matches) {
          setMobileSidebarOpen((open) => !open)
        } else {
          toggleSidebarCollapsed()
        }
        return
      }

      if (meta && event.shiftKey && key === 'o') {
        event.preventDefault()
        void resetChat()
        return
      }

      if (meta && key === '/') {
        event.preventDefault()
        setShortcutGuideOpen((open) => !open)
        return
      }

      if (meta && key === 'd' && !isEditableTarget(event.target)) {
        event.preventDefault()
        toggleAppearance()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    resetChat,
    setCommandPaletteOpen,
    setMobileSidebarOpen,
    setShortcutGuideOpen,
    toggleAppearance,
    toggleSidebarCollapsed,
  ])
}
