import { ChevronDown, LogOut, Settings, Shield, ShieldCheck, ShieldHalf, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useChatControls } from '../context/ChatContext'
import { usePreferences } from '../context/PreferencesContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { SDLC_PHASES } from '../lib/chatConfig'
import { isAdminUser, userRole } from '../lib/roles'

function PrivacyBadge({ forceConfidential }) {
  if (forceConfidential) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
        data-testid="privacy-badge"
        title="Force confidential: every request stays on the local path"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confidential · Local
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-xs text-[var(--muted)]"
      data-testid="privacy-badge"
      title="Privacy router decides local vs cloud per request"
    >
      <ShieldHalf className="h-3.5 w-3.5" aria-hidden="true" /> Privacy · Auto
    </span>
  )
}

function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const role = userRole(user)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const email = user?.email || 'Fuzyo user'
  const initial = email.slice(0, 1).toUpperCase()
  const go = (path) => {
    setOpen(false)
    navigate(path)
  }
  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu-button"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--hover)]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-fg)]">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm text-[var(--app-fg)] lg:inline">{email}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 shadow-xl"
        >
          <div className="border-b border-[var(--border)] px-3 py-2">
            <p className="truncate text-sm text-[var(--app-fg)]">{email}</p>
            <p className="text-xs text-[var(--muted)]">Role: {role}</p>
          </div>
          <button type="button" role="menuitem" className={item} onClick={() => go('/settings')}>
            <Settings className="h-4 w-4" aria-hidden="true" /> Settings
          </button>
          {isAdminUser(user) ? (
            <button type="button" role="menuitem" className={item} onClick={() => go('/admin')}>
              <Shield className="h-4 w-4" aria-hidden="true" /> Admin
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function Header() {
  const { activeWorkspace } = useWorkspace()
  const { sdlcPhase, skillsMode, forceConfidential } = useChatControls()
  const { apiHealthy } = usePreferences()
  const phase = SDLC_PHASES.find((item) => item.id === sdlcPhase)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--panel)] pl-14 pr-4 md:pl-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden text-xs font-semibold tracking-[0.18em] text-[var(--muted)] xl:inline">
          FUZYO COPILOT
        </span>
        <span className="truncate text-sm font-medium text-[var(--app-fg)]">
          {activeWorkspace?.name || 'No project'}
        </span>
        <span className="hidden truncate rounded-md border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-xs text-[var(--muted)] sm:inline">
          Phase {sdlcPhase} — {phase?.label ?? 'Unknown'}
        </span>
        {skillsMode ? (
          <span className="hidden rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] md:inline">
            /{skillsMode}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!apiHealthy ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            data-testid="offline-badge"
            role="status"
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> API offline
          </span>
        ) : null}
        <PrivacyBadge forceConfidential={forceConfidential} />
        <UserMenu />
      </div>
    </header>
  )
}
