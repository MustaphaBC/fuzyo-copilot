import { FileText, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SDLC_PHASES, useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'
import DeleteConfirmModal from '../UI/DeleteConfirmModal'
import EmptyState from '../UI/EmptyState'
import ErrorState from '../UI/ErrorState'

const ACCEPT = '.md,.markdown,.pdf,.docx,.xlsx,.csv,.txt,.json,.yml,.yaml,.py,.ts,.tsx,.js,.jsx,.go,.sql,.toml'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function Counter({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--app-fg)]">{value}</p>
    </div>
  )
}

export default function KnowledgeTab() {
  const { activeWorkspace, sdlcPhase } = useApp()
  const { pushToast } = useUI()
  const workspaceId = activeWorkspace?.id
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [uploadPhase, setUploadPhase] = useState(sdlcPhase || 1)
  const [uploading, setUploading] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/knowledge`)
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
      setListing(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge base')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const documents = useMemo(() => {
    const items = listing?.documents || []
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((doc) => doc.name.toLowerCase().includes(needle))
  }, [listing, query])

  async function onFiles(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || !workspaceId) return
    let ok = 0
    for (const file of files) {
      setUploading(file.name)
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('sdlc_phase', String(uploadPhase))
        const response = await apiFetch(`/api/v1/workspaces/${workspaceId}/documents`, {
          method: 'POST',
          body: form,
        })
        if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
        const result = await response.json()
        if (result.chunks_inserted > 0) ok += 1
        else pushToast({ type: 'error', message: `${file.name}: no chunks indexed (parse or embedding failed)` })
      } catch (err) {
        pushToast({
          type: 'error',
          message: `${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`,
        })
      }
    }
    setUploading('')
    if (ok) pushToast({ type: 'success', message: `Indexed ${ok} document${ok > 1 ? 's' : ''}` })
    await load()
  }

  async function confirmDelete() {
    if (!pendingDelete || !workspaceId) return
    setDeleting(true)
    setDeleteError('')
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${workspaceId}/knowledge?name=${encodeURIComponent(pendingDelete.name)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
      setPendingDelete(null)
      await load()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6" data-testid="knowledge-tab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-[var(--app-fg)]">Knowledge base</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Documents indexed for retrieval (Cohere embeddings, hybrid search with FlashRank reranking).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="knowledge-upload-phase">
            Upload phase
          </label>
          <select
            id="knowledge-upload-phase"
            value={uploadPhase}
            onChange={(event) => setUploadPhase(Number(event.target.value))}
            className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--app-fg)]"
          >
            {SDLC_PHASES.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.id}. {phase.label}
              </option>
            ))}
          </select>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onFiles} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(uploading)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
            data-testid="knowledge-upload"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {uploading ? `Indexing ${uploading}…` : 'Upload'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh knowledge base"
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? <ErrorState title="Knowledge base unavailable" description={error} onRetry={load} /> : null}

      {listing ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Counter label="Documents" value={listing.document_count} />
          <Counter label="Chunks" value={listing.chunk_count} />
          <Counter label="Status" value={listing.document_count ? 'Indexed' : 'Empty'} />
        </div>
      ) : null}

      {listing && listing.document_count > 0 ? (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] py-2 pl-8 pr-3 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--muted)]"
              data-testid="knowledge-search"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--panel-elevated)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Phase</th>
                  <th className="px-3 py-2 font-medium">Chunks</th>
                  <th className="px-3 py-2 font-medium">Indexed</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.name} className="border-t border-[var(--border)]" data-testid="knowledge-row">
                    <td className="max-w-xs px-3 py-2">
                      <span className="flex items-center gap-2 text-[var(--app-fg)]">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                        <span className="truncate">{doc.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)]">{doc.file_type || '—'}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{doc.sdlc_phase ?? '—'}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{doc.chunks}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{formatDate(doc.last_indexed_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError('')
                          setPendingDelete(doc)
                        }}
                        aria-label={`Remove ${doc.name} from knowledge base`}
                        className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!documents.length ? (
              <p className="px-3 py-4 text-sm text-[var(--muted)]">No documents match “{query}”.</p>
            ) : null}
          </div>
        </>
      ) : null}

      {listing && listing.document_count === 0 && !error ? (
        <EmptyState
          title="No documents indexed"
          description="Upload specs, architecture notes or code so Fuzyo can ground answers in your project."
        />
      ) : null}

      <DeleteConfirmModal
        open={Boolean(pendingDelete)}
        title="Remove document from knowledge base?"
        description={
          pendingDelete
            ? `All ${pendingDelete.chunks} chunks of "${pendingDelete.name}" will be removed from retrieval. Files on disk are not touched.`
            : ''
        }
        error={deleteError}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
