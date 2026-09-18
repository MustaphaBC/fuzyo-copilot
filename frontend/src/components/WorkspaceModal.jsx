import { Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiFetch } from '../lib/api'
import CreateWorkspaceModal from './Workspace/CreateWorkspaceModal'

const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.pdf', '.docx', '.xlsx']
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')

const STACK_OPTIONS = [
  'React',
  'FastAPI',
  'Python',
  'PostgreSQL',
  'TypeScript',
  'JavaScript',
  'Docker',
  'Supabase',
  'Vite',
  'Tailwind',
  'Node.js',
]

const STACK_PRESETS = [
  {
    id: 'fullstack',
    label: 'Full-stack',
    stack: ['React', 'FastAPI', 'PostgreSQL', 'Tailwind'],
  },
  {
    id: 'frontend',
    label: 'Frontend',
    stack: ['React', 'TypeScript', 'Vite', 'Tailwind'],
  },
  {
    id: 'backend',
    label: 'Backend',
    stack: ['Python', 'FastAPI', 'PostgreSQL'],
  },
  {
    id: 'data',
    label: 'Data',
    stack: ['Python', 'PostgreSQL'],
  },
]

function hasAllowedExtension(file) {
  const name = (file?.name || '').toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function dropZoneState(dragging, files, uploadPhase) {
  if (uploadPhase === 'uploading') return 'uploading'
  if (uploadPhase === 'error') return 'error'
  if (dragging) return 'dragging'
  if (files.length) return 'ready'
  return 'idle'
}

export default function WorkspaceModal() {
  const {
    workspaceModal,
    closeWorkspaceModal,
    activeWorkspace,
    sdlcPhase,
    refreshWorkspaces,
    setActiveWorkspace,
    deleteWorkspace,
  } = useApp()

  const isEdit = workspaceModal.mode === 'edit'
  const open = workspaceModal.open

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [techStack, setTechStack] = useState([])
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploadPhase, setUploadPhase] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (!open) return
    setError(null)
    setUploadPhase(null)
    setFiles([])
    setDragging(false)
    setConfirmingDelete(false)
    setDeleting(false)
    dragDepth.current = 0

    if (isEdit && activeWorkspace) {
      setName(activeWorkspace.name || '')
      setDescription(activeWorkspace.description || '')
      setCustomInstructions(activeWorkspace.custom_instructions || '')
      setTechStack(Array.isArray(activeWorkspace.tech_stack) ? [...activeWorkspace.tech_stack] : [])
    } else {
      setName('')
      setDescription('')
      setCustomInstructions('')
      setTechStack([])
    }
  }, [open, isEdit, activeWorkspace])

  const zoneState = useMemo(
    () => dropZoneState(dragging, files, uploadPhase),
    [dragging, files, uploadPhase],
  )

  const zoneClass = {
    idle: 'border-[var(--border)] bg-[var(--panel-elevated)]',
    dragging: 'border-sky-500 bg-sky-950/30',
    ready: 'border-[var(--border)] bg-[var(--chip)]',
    uploading: 'border-amber-700 bg-amber-950/20',
    error: 'border-red-800 bg-red-950/20',
  }[zoneState]

  const addFiles = (incoming) => {
    const next = [...incoming].filter(hasAllowedExtension)
    if (!next.length) {
      setError(`Supported files: ${ACCEPTED_EXTENSIONS.join(', ')}`)
      setUploadPhase('error')
      return
    }
    setError(null)
    setUploadPhase(null)
    setFiles((prev) => {
      const map = new Map(prev.map((f) => [`${f.name}-${f.size}-${f.lastModified}`, f]))
      for (const file of next) {
        map.set(`${file.name}-${file.size}-${file.lastModified}`, file)
      }
      return [...map.values()]
    })
  }

  const toggleStack = (tag) => {
    setTechStack((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    )
  }

  const applyPreset = (preset) => {
    setTechStack([...preset.stack])
  }

  const uploadQueuedFiles = async (workspaceId) => {
    if (!files.length) return
    setUploadPhase('uploading')
    for (const file of files) {
      const body = new FormData()
      body.append('file', file)
      body.append('sdlc_phase', String(sdlcPhase || 1))
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        body,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Upload failed for ${file.name}`)
      }
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      let workspace
      if (isEdit) {
        if (!activeWorkspace?.id) throw new Error('No workspace selected')
        const response = await apiFetch(`/api/v1/workspaces/${activeWorkspace.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            description: description.trim() || null,
            custom_instructions: customInstructions.trim() || null,
            tech_stack: techStack,
          }),
        })
        if (!response.ok) {
          throw new Error((await response.text()) || 'Update failed')
        }
        workspace = await response.json()
      } else {
        const response = await apiFetch('/api/v1/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            description: description.trim() || null,
            custom_instructions: customInstructions.trim() || null,
            tech_stack: techStack,
          }),
        })
        if (!response.ok) {
          throw new Error((await response.text()) || 'Create failed')
        }
        workspace = await response.json()
      }

      await uploadQueuedFiles(workspace.id)
      await refreshWorkspaces(workspace.id)
      setActiveWorkspace(workspace)
      setUploadPhase(null)
      closeWorkspaceModal()
    } catch (err) {
      setUploadPhase(files.length ? 'error' : null)
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!isEdit || !activeWorkspace?.id || deleting) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      setError(null)
      return
    }
    setDeleting(true)
    setError(null)
    const result = await deleteWorkspace(activeWorkspace.id)
    setDeleting(false)
    if (!result.ok) {
      setError(result.error || 'Delete failed')
      return
    }
    setConfirmingDelete(false)
    closeWorkspaceModal()
  }

  if (!open) return null

  if (!isEdit) {
    return <CreateWorkspaceModal onClose={closeWorkspaceModal} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--overlay)' }}
        aria-label="Close workspace modal backdrop"
        onClick={closeWorkspaceModal}
      />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--app-fg)]">
            {isEdit ? 'Edit workspace' : 'New workspace'}
          </h2>
          <button
            type="button"
            onClick={closeWorkspaceModal}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label htmlFor="ws-name" className="mb-1 block text-xs text-[var(--muted)]">
              Project name
            </label>
            <input
              id="ws-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
              placeholder="My project"
            />
          </div>

          <div>
            <label htmlFor="ws-desc" className="mb-1 block text-xs text-[var(--muted)]">
              Description
            </label>
            <textarea
              id="ws-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)] resize-y"
              placeholder="Optional project summary"
            />
          </div>

          <div>
            <label htmlFor="ws-instructions" className="mb-1 block text-xs text-[var(--muted)]">
              Custom instructions
            </label>
            <textarea
              id="ws-instructions"
              rows={2}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)] resize-y"
              placeholder="Optional copilot guidance"
            />
          </div>

          <div>
            <p className="mb-2 text-xs text-[var(--muted)]">Stack presets</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {STACK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-xs text-[var(--muted)]">Tech stack</p>
            <div className="flex flex-wrap gap-2">
              {STACK_OPTIONS.map((tag) => {
                const active = techStack.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleStack(tag)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? 'border-[var(--border)] bg-[var(--chip)] text-[var(--app-fg)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--app-fg)]'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-[var(--muted)]">Documentation upload</p>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragDepth.current += 1
                setDragging(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragDepth.current = Math.max(0, dragDepth.current - 1)
                if (dragDepth.current === 0) setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragDepth.current = 0
                setDragging(false)
                addFiles(e.dataTransfer.files)
              }}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors ${zoneClass}`}
            >
              <Upload className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--app-fg)]">
                {zoneState === 'dragging'
                  ? 'Drop files to queue'
                  : zoneState === 'uploading'
                    ? 'Uploading…'
                    : 'Drag & drop docs, or click to browse'}
              </p>
              <p className="text-xs text-[var(--muted)]">{ACCEPT_ATTR}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files || [])
                  e.target.value = ''
                }}
              />
            </div>
            {files.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {files.map((file) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="flex items-center justify-between rounded-md border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--app-fg)]"
                  >
                    <span className="truncate pr-2">{file.name}</span>
                    <button
                      type="button"
                      className="shrink-0 text-[var(--muted)] hover:text-[var(--app-fg)]"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFiles((prev) => prev.filter((f) => f !== file))
                      }}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          {isEdit && confirmingDelete ? (
            <p className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
              Permanently delete &quot;{activeWorkspace?.name}&quot; and purge its documents/chunks? Click
              Delete again to confirm.
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {isEdit ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={submitting || deleting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm delete' : 'Delete'}
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false)
                  closeWorkspaceModal()
                }}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || deleting || !name.trim()}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-40"
              >
                {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create workspace'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
