import JSZip from 'jszip'
import { FolderUp, FileText, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { apiFetch } from '../../lib/api'
import { shouldIgnorePath } from '../../utils/ignoreFilter'

const DOCS_EXTENSIONS = ['.md', '.markdown', '.pdf', '.docx', '.xlsx', '.csv']
const CODE_EXTENSIONS = [
  '.md',
  '.markdown',
  '.csv',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.go',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.sql',
  '.txt',
]

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

function hasExt(file, exts) {
  const name = (file?.name || '').toLowerCase()
  return exts.some((ext) => name.endsWith(ext))
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function zipCodeFiles(fileList, onProgress) {
  const zip = new JSZip()
  let added = 0
  let skipped = 0
  const files = [...fileList]
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    const rel = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/')
    if (shouldIgnorePath(rel) || !hasExt(file, CODE_EXTENSIONS)) {
      skipped += 1
      continue
    }
    const buffer = await file.arrayBuffer()
    zip.file(rel, buffer)
    added += 1
    if (i % 25 === 0) {
      onProgress?.({ added, skipped, index: i, total: files.length })
      await yieldToMain()
    }
  }
  onProgress?.({ added, skipped, index: files.length, total: files.length })
  if (!added) {
    return { blob: null, added, skipped }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, added, skipped }
}

export default function CreateWorkspaceModal({ onClose }) {
  const { sdlcPhase, refreshWorkspaces, setActiveWorkspace } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [techStack, setTechStack] = useState([])
  const [mode, setMode] = useState('docs')
  const [customHostPath, setCustomHostPath] = useState('')
  const [docsFiles, setDocsFiles] = useState([])
  const [codeFiles, setCodeFiles] = useState([])
  const [zipFile, setZipFile] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const docsInputRef = useRef(null)
  const dirInputRef = useRef(null)
  const zipInputRef = useRef(null)

  const statusLine = useMemo(() => {
    if (!progress) return null
    return `Packaging ${progress.added} files (skipped ${progress.skipped})…`
  }, [progress])

  const toggleStack = (tag) => {
    setTechStack((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    setProgress(null)
    try {
      const body = new FormData()
      body.append('name', trimmed)
      body.append('description', description.trim())
      body.append('custom_instructions', customInstructions.trim())
      body.append('tech_stack', JSON.stringify(techStack))
      body.append('mode', mode)
      body.append('sdlc_phase', String(sdlcPhase || 1))
      if (customHostPath.trim()) {
        body.append('custom_host_path', customHostPath.trim())
      }

      if (mode === 'docs') {
        for (const file of docsFiles) {
          body.append('files', file, file.name)
        }
      } else if (zipFile) {
        body.append('zip_file', zipFile, zipFile.name || 'codebase.zip')
      } else if (codeFiles.length) {
        setProgress({ added: 0, skipped: 0, index: 0, total: codeFiles.length })
        const { blob, added, skipped } = await zipCodeFiles(codeFiles, setProgress)
        if (!blob || !added) {
          throw new Error(
            skipped
              ? 'All selected files were ignored or unsupported'
              : 'No ingestible source files found',
          )
        }
        body.append('zip_file', blob, `${trimmed.replace(/\s+/g, '-').toLowerCase() || 'codebase'}.zip`)
      }

      const response = await apiFetch('/api/v1/workspaces/create-and-ingest', {
        method: 'POST',
        body,
      })
      if (!response.ok) {
        throw new Error((await response.text()) || 'Create failed')
      }
      const payload = await response.json()
      const workspace = payload.workspace || payload
      await refreshWorkspaces(workspace.id)
      setActiveWorkspace(workspace)
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--overlay)' }}
        aria-label="Close create workspace backdrop"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--app-fg)]">New workspace</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4" data-testid="create-workspace-form">
          <div>
            <label htmlFor="create-ws-name" className="mb-1 block text-xs text-[var(--muted)]">
              Project name
            </label>
            <input
              id="create-ws-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
              placeholder="My project"
            />
          </div>

          <div>
            <label htmlFor="create-ws-desc" className="mb-1 block text-xs text-[var(--muted)]">
              Description
            </label>
            <textarea
              id="create-ws-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
            />
          </div>

          <div>
            <label htmlFor="create-ws-instructions" className="mb-1 block text-xs text-[var(--muted)]">
              Custom instructions
            </label>
            <textarea
              id="create-ws-instructions"
              rows={2}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
            />
          </div>

          <div>
            <label htmlFor="create-ws-host-path" className="mb-1 block text-xs text-[var(--muted)]">
              Host path location
            </label>
            <input
              id="create-ws-host-path"
              value={customHostPath}
              onChange={(e) => setCustomHostPath(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
              placeholder="C:/Dev/Projects (optional — contains <ProjectName>/)"
              data-testid="custom-host-path"
            />
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Absolute folder that will contain your project. Leave empty for the default workspace storage.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs text-[var(--muted)]">Tech stack</p>
            <div className="flex flex-wrap gap-2">
              {STACK_OPTIONS.map((tag) => {
                const active = techStack.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleStack(tag)}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
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

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              data-testid="mode-docs"
              onClick={() => setMode('docs')}
              className={`rounded-lg border p-4 text-left transition ${
                mode === 'docs'
                  ? 'border-sky-700 bg-sky-950/30'
                  : 'border-[var(--border)] bg-[var(--panel-elevated)] hover:bg-[var(--hover)]'
              }`}
            >
              <FileText className="mb-2 h-5 w-5 text-[var(--muted)]" />
              <p className="text-sm font-medium text-[var(--app-fg)]">Specs & Docs</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Upload markdown, PDF, DOCX, XLSX, CSV
              </p>
            </button>
            <button
              type="button"
              data-testid="mode-codebase"
              onClick={() => setMode('codebase')}
              className={`rounded-lg border p-4 text-left transition ${
                mode === 'codebase'
                  ? 'border-sky-700 bg-sky-950/30'
                  : 'border-[var(--border)] bg-[var(--panel-elevated)] hover:bg-[var(--hover)]'
              }`}
            >
              <FolderUp className="mb-2 h-5 w-5 text-[var(--muted)]" />
              <p className="text-sm font-medium text-[var(--app-fg)]">Codebase Import</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                ZIP or folder — skips node_modules, .git, .env
              </p>
            </button>
          </div>

          {mode === 'docs' ? (
            <div>
              <button
                type="button"
                onClick={() => docsInputRef.current?.click()}
                className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] bg-[var(--panel-elevated)] px-4 py-6 text-center hover:bg-[var(--hover)]"
              >
                <Upload className="h-5 w-5 text-[var(--muted)]" />
                <span className="text-sm text-[var(--app-fg)]">Choose documentation files</span>
                <span className="text-xs text-[var(--muted)]">{DOCS_EXTENSIONS.join(', ')}</span>
              </button>
              <input
                ref={docsInputRef}
                type="file"
                multiple
                accept={DOCS_EXTENSIONS.join(',')}
                className="hidden"
                onChange={(e) => {
                  const next = [...(e.target.files || [])].filter((f) => hasExt(f, DOCS_EXTENSIONS))
                  setDocsFiles(next)
                  e.target.value = ''
                }}
              />
              {docsFiles.length ? (
                <ul className="mt-2 space-y-1 text-xs text-[var(--app-fg)]">
                  {docsFiles.map((file) => (
                    <li key={`${file.name}-${file.size}`}>{file.name}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => zipInputRef.current?.click()}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
                >
                  Upload .zip
                </button>
                <button
                  type="button"
                  onClick={() => dirInputRef.current?.click()}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--app-fg)] hover:bg-[var(--hover)]"
                >
                  Select folder
                </button>
              </div>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  setZipFile(file)
                  setCodeFiles([])
                  e.target.value = ''
                }}
              />
              <input
                ref={dirInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => {
                  setCodeFiles([...(e.target.files || [])])
                  setZipFile(null)
                  e.target.value = ''
                }}
                {...{ webkitdirectory: '', directory: '' }}
              />
              <p className="text-xs text-[var(--muted)]">
                {zipFile
                  ? `ZIP: ${zipFile.name}`
                  : codeFiles.length
                    ? `${codeFiles.length} files selected from folder`
                    : 'No codebase selected yet'}
              </p>
            </div>
          )}

          {statusLine ? <p className="text-xs text-[var(--muted)]">{statusLine}</p> : null}
          {error ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create & ingest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
