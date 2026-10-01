import { ChevronDown, Play, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { apiFetch } from '../../lib/api'

const SECTIONS = [
  { id: 'role', label: '[RÔLE]' },
  { id: 'context', label: '[CONTEXTE]' },
  { id: 'objective', label: '[OBJECTIF]' },
  { id: 'constraints', label: '[CONTRAINTES]' },
  { id: 'output_format', label: '[FORMAT DE SORTIE]' },
]

function buildUserPrompt(preview, phase, includeDetected) {
  if (!preview) return ''
  const detected = (phase?.deliverables || []).slice(0, 8)
  const lines = [preview.suggested_user_prompt]
  if (includeDetected && detected.length) {
    lines.push(`Livrables déjà détectés dans le projet : ${detected.join(', ')}. Complète ce qui manque.`)
  }
  return lines.join('\n\n')
}

function SectionAccordion({ label, body }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-[var(--app-fg)] hover:bg-[var(--hover)]"
        aria-expanded={open}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-[var(--border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
          {body || '—'}
        </pre>
      ) : null}
    </div>
  )
}

export default function ExecutePhaseModal({ open, phase, onClose }) {
  const { activeWorkspace, aiBehavior, setAiBehavior, setSdlcPhase, resetChat, seedComposer } = useApp()
  const [options, setOptions] = useState(aiBehavior)
  const [includeDetected, setIncludeDetected] = useState(true)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptEdited, setPromptEdited] = useState(false)
  const [sending, setSending] = useState(false)

  const workspaceId = activeWorkspace?.id
  const phaseId = Number(phase?.id) || null

  useEffect(() => {
    if (!open) return
    setOptions(aiBehavior)
    setPromptEdited(false)
  }, [open, aiBehavior])

  useEffect(() => {
    if (!open || !workspaceId || !phaseId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    const query = new URLSearchParams({
      use_project_context: String(options.useProjectContext),
      prefer_project_files: String(options.preferProjectFiles),
    })
    apiFetch(`/api/v1/workspaces/${workspaceId}/phases/${phaseId}/prompt-preview?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
        return response.json()
      })
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, workspaceId, phaseId, options.useProjectContext, options.preferProjectFiles])

  useEffect(() => {
    if (!promptEdited) setPrompt(buildUserPrompt(preview, phase, includeDetected))
  }, [preview, phase, includeDetected, promptEdited])

  if (!open || !phase) return null

  const toggle = (key) => setOptions((prev) => ({ ...prev, [key]: !prev[key] }))

  async function reviewAndSend() {
    const text = prompt.trim()
    if (!text) return
    setSending(true)
    setAiBehavior(options)
    setSdlcPhase(phaseId)
    await resetChat()
    seedComposer(text, { autoSend: true })
    setSending(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--overlay)' }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="execute-phase-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        data-testid="execute-phase-modal"
      >
        <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Phase {String(phaseId).padStart(2, '0')}
            </p>
            <h2 id="execute-phase-title" className="text-base font-semibold text-[var(--app-fg)]">
              Execute {phase.name}
            </h2>
            {preview ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Role: {preview.role} · {preview.deliverables.length} expected deliverables
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close execute phase"
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">Context</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['useProjectContext', 'Project instructions'],
                ['preferProjectFiles', 'Prefer existing project files'],
                ['useWorkspaceKnowledge', 'Workspace knowledge (RAG)'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[var(--app-fg)]">
                  <input
                    type="checkbox"
                    checked={Boolean(options[key])}
                    onChange={() => toggle(key)}
                    data-testid={`execute-option-${key}`}
                  />
                  {label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-[var(--app-fg)]">
                <input
                  type="checkbox"
                  checked={includeDetected}
                  onChange={() => setIncludeDetected((value) => !value)}
                />
                Mention detected deliverables
              </label>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
              System prompt (5-component model)
            </h3>
            {loading ? <p className="text-xs text-[var(--muted)]">Loading preview…</p> : null}
            {error ? (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            {preview ? (
              <div className="space-y-1.5" data-testid="execute-prompt-sections">
                {SECTIONS.map((section) => (
                  <SectionAccordion
                    key={section.id}
                    label={section.label}
                    body={preview.sections?.[section.id]}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <label htmlFor="execute-user-prompt" className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted)]">
              Request
            </label>
            <textarea
              id="execute-user-prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value)
                setPromptEdited(true)
              }}
              rows={5}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
              data-testid="execute-user-prompt"
            />
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={reviewAndSend}
            disabled={sending || !prompt.trim()}
            data-testid="execute-phase-send"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Review &amp; Send
          </button>
        </div>
      </div>
    </div>
  )
}
