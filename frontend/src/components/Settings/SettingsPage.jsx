import { Monitor, Moon, Save, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp, SDLC_PHASES } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { useUI } from '../../context/UIContext'
import { userRole } from '../../lib/roles'
import {
  DEFAULT_USER_SETTINGS,
  applyUserSettings,
  fetchUserSettings,
  saveUserSettings,
} from '../../lib/userSettings'
import ForceConfidentialModal from '../UI/ForceConfidentialModal'

const APPEARANCE_OPTIONS = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
]

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-sm font-semibold text-[var(--app-fg)]">{title}</h2>
      {description ? <p className="mt-1 text-xs text-[var(--muted)]">{description}</p> : null}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

function Segmented({ value, options, onChange, testIdPrefix }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-sm" role="radiogroup">
      {options.map((option) => {
        const Icon = option.icon
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            data-testid={`${testIdPrefix}-${option.id}`}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
              active
                ? 'bg-[var(--panel-elevated)] text-[var(--app-fg)]'
                : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
            }`}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ label, description, checked, onChange, testId }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm text-[var(--app-fg)]">{label}</span>
        {description ? <span className="block text-xs text-[var(--muted)]">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
        data-testid={testId}
      />
    </label>
  )
}

export default function SettingsPage() {
  const app = useApp()
  const { user } = useAuth()
  const { pushToast } = useUI()
  const [draft, setDraft] = useState(DEFAULT_USER_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [persisted, setPersisted] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmConfidential, setConfirmConfidential] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchUserSettings()
      .then((result) => {
        if (cancelled) return
        setDraft(result.settings)
        setPersisted(result.persisted)
      })
      .catch(() => {
        if (cancelled) return
        setDraft({
          ...DEFAULT_USER_SETTINGS,
          appearance: app.appearance,
          density: app.density,
          privacy_mode: app.forceConfidential ? 'confidential' : 'auto',
          default_sdlc_phase: app.sdlcPhase,
        })
        setPersisted(false)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // Load once on mount; later edits live in the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }))

  async function save() {
    setSaving(true)
    applyUserSettings(draft, app)
    try {
      const result = await saveUserSettings(draft)
      setPersisted(result.persisted)
      pushToast({ type: 'success', message: 'Settings saved' })
    } catch (err) {
      setPersisted(false)
      pushToast({
        type: 'error',
        message: `Applied locally only — ${err instanceof Error ? err.message : 'save failed'}`,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="settings-page">
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium text-[var(--app-fg)]">Settings</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {user?.email || 'Signed in'} · {userRole(user)}
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!loaded || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
            data-testid="settings-save"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {!persisted ? (
          <p
            className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200"
            role="status"
            data-testid="settings-not-persisted"
          >
            Settings are not stored on the server yet (apply migration 07_user_settings.sql). Changes
            apply to this browser only.
          </p>
        ) : null}

        <Section title="Appearance" description="Theme and information density.">
          <Segmented
            value={draft.appearance}
            options={APPEARANCE_OPTIONS}
            onChange={(appearance) => update({ appearance })}
            testIdPrefix="settings-appearance"
          />
          <Segmented
            value={draft.density}
            options={[
              { id: 'comfortable', label: 'Comfortable' },
              { id: 'compact', label: 'Compact' },
            ]}
            onChange={(density) => update({ density })}
            testIdPrefix="settings-density"
          />
        </Section>

        <Section
          title="Privacy"
          description="Default routing for new requests. Secrets are always routed to the local model."
        >
          <Segmented
            value={draft.privacy_mode}
            options={[
              { id: 'auto', label: 'Auto (privacy router)' },
              { id: 'confidential', label: 'Always confidential' },
            ]}
            onChange={(mode) => {
              if (mode === 'confidential' && draft.privacy_mode !== 'confidential') {
                setConfirmConfidential(true)
              } else {
                update({ privacy_mode: mode })
              }
            }}
            testIdPrefix="settings-privacy"
          />
        </Section>

        <Section title="Chat" description="Defaults for new conversations.">
          <label className="flex items-center justify-between gap-4 text-sm text-[var(--app-fg)]">
            Default SDLC phase
            <select
              value={draft.default_sdlc_phase}
              onChange={(event) => update({ default_sdlc_phase: Number(event.target.value) })}
              className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--app-fg)]"
              data-testid="settings-default-phase"
            >
              {SDLC_PHASES.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.id}. {phase.label}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            label="Open Inspector on send"
            description="Show routing, RAG and quality details while streaming."
            checked={draft.auto_open_inspector}
            onChange={(value) => update({ auto_open_inspector: value })}
            testId="settings-auto-inspector"
          />
          <Toggle
            label="Open Canvas for diagrams and code"
            checked={draft.auto_open_canvas}
            onChange={(value) => update({ auto_open_canvas: value })}
            testId="settings-auto-canvas"
          />
        </Section>
      </div>

      <ForceConfidentialModal
        open={confirmConfidential}
        onCancel={() => setConfirmConfidential(false)}
        onConfirm={() => {
          update({ privacy_mode: 'confidential' })
          setConfirmConfidential(false)
        }}
      />
    </div>
  )
}
