import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'
import { STACK_OPTIONS } from '../../lib/stackOptions'
import ForceConfidentialModal from '../UI/ForceConfidentialModal'

function Checkbox({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-sm text-[var(--app-fg)]">{label}</span>
        {hint ? <span className="block text-xs text-[var(--muted)]">{hint}</span> : null}
      </span>
    </label>
  )
}

export default function InstructionsPanel() {
  const {
    activeWorkspace,
    refreshWorkspaces,
    aiBehavior,
    setAiBehavior,
    forceConfidential,
    setForceConfidential,
  } = useApp()
  const { pushToast } = useUI()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [techStack, setTechStack] = useState([])
  const [saving, setSaving] = useState(false)
  const [confirmConfidential, setConfirmConfidential] = useState(false)

  useEffect(() => {
    setName(activeWorkspace?.name || '')
    setDescription(activeWorkspace?.description || '')
    setInstructions(activeWorkspace?.custom_instructions || '')
    setTechStack(Array.isArray(activeWorkspace?.tech_stack) ? [...activeWorkspace.tech_stack] : [])
  }, [activeWorkspace])

  if (!activeWorkspace) return null

  const dirty =
    name.trim() !== (activeWorkspace.name || '') ||
    description !== (activeWorkspace.description || '') ||
    instructions !== (activeWorkspace.custom_instructions || '') ||
    techStack.join('|') !== (activeWorkspace.tech_stack || []).join('|')

  async function save() {
    setSaving(true)
    try {
      const response = await apiFetch(`/api/v1/workspaces/${activeWorkspace.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          custom_instructions: instructions.trim() || null,
          tech_stack: techStack,
        }),
      })
      if (!response.ok) throw new Error((await response.text()) || 'Save failed')
      await refreshWorkspaces(activeWorkspace.id)
      pushToast({ type: 'success', message: 'Project instructions saved' })
    } catch (err) {
      pushToast({ type: 'error', message: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]'

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="instructions-panel">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-[var(--app-fg)]">Project Instructions</h2>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || !name.trim()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Project context
          </h3>
          <label className="block text-xs text-[var(--muted)]" htmlFor="instr-name">
            Project name
          </label>
          <input
            id="instr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
          <label className="block text-xs text-[var(--muted)]" htmlFor="instr-desc">
            Description
          </label>
          <textarea
            id="instr-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${field} resize-y`}
            placeholder="Project purpose"
          />
          <label className="block text-xs text-[var(--muted)]" htmlFor="instr-body">
            Instructions injected into every chat for this project
          </label>
          <textarea
            id="instr-body"
            rows={8}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className={`${field} resize-y font-mono text-xs`}
            placeholder={'Architecture constraints…\nCoding standards…\nNaming conventions…'}
          />
          <p className="text-xs text-[var(--muted)]">Tech stack</p>
          <div className="flex flex-wrap gap-2">
            {STACK_OPTIONS.map((tag) => {
              const active = techStack.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setTechStack((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                    )
                  }
                  className={`rounded-md border border-[var(--border)] px-2.5 py-1 text-xs ${
                    active
                      ? 'bg-[var(--chip)] text-[var(--app-fg)]'
                      : 'text-[var(--muted)] hover:text-[var(--app-fg)]'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            AI behavior
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox
              checked={aiBehavior.useProjectContext}
              onChange={(v) => setAiBehavior({ useProjectContext: v })}
              label="Respect project context"
              hint="Inject the instructions above into the system prompt."
            />
            <Checkbox
              checked={aiBehavior.preferProjectFiles}
              onChange={(v) => setAiBehavior({ preferProjectFiles: v })}
              label="Prefer project files"
              hint="Reuse existing modules and conventions."
            />
            <Checkbox
              checked={aiBehavior.useWorkspaceKnowledge}
              onChange={(v) => setAiBehavior({ useWorkspaceKnowledge: v })}
              label="Use workspace knowledge"
              hint="Retrieve indexed documents (RAG) for each prompt."
            />
            <Checkbox
              checked={forceConfidential}
              onChange={(v) => (v ? setConfirmConfidential(true) : setForceConfidential(false))}
              label="Force confidential"
              hint="Route every request to the local path."
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            AI behavior toggles apply immediately and are stored per project in this browser.
          </p>
        </section>
      </div>
      <ForceConfidentialModal
        open={confirmConfidential}
        onCancel={() => setConfirmConfidential(false)}
        onConfirm={() => {
          setForceConfidential(true)
          setConfirmConfidential(false)
        }}
      />
    </div>
  )
}
