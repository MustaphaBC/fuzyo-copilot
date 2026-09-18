import { Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'
import {
  defaultArtifactFileName,
  notifyWorkspaceFsUpdated,
  saveArtifactToLocalPc,
} from '../../lib/saveLocalArtifact'

function buildLineDiff(previous, current) {
  const a = (previous || '').split('\n')
  const b = (current || '').split('\n')
  const max = Math.max(a.length, b.length)
  const rows = []
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === right) {
      rows.push({ type: 'same', text: right ?? '' })
    } else {
      if (left !== undefined) rows.push({ type: 'del', text: left })
      if (right !== undefined) rows.push({ type: 'add', text: right })
    }
  }
  return rows
}

export default function CodeDiffViewer({ language, value, previousValue = '' }) {
  const {
    activeWorkspace,
    sdlcPhase,
    viewMode,
    openFiles,
    setPendingDiff,
  } = useApp()
  const { pushToast } = useUI()
  const [tab, setTab] = useState('formatted')
  const [copied, setCopied] = useState(false)
  const [applying, setApplying] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingLocal, setSavingLocal] = useState(false)

  const lines = useMemo(
    () => buildLineDiff(previousValue, value),
    [previousValue, value],
  )

  const resolveIdePath = () => {
    const phase = Number(sdlcPhase) || 5
    const filename = defaultArtifactFileName(language)
    if (phase === 5) return `src/${filename}`
    if (phase === 6) return `tests/${filename}`
    return filename
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const queueIdeDiff = async (relativePath) => {
    let original = ''
    const existing = openFiles.find((f) => f.path === relativePath)
    if (existing) {
      original = existing.content || ''
    } else if (activeWorkspace?.id) {
      try {
        const response = await apiFetch(
          `/api/v1/workspaces/${activeWorkspace.id}/fs/file?path=${encodeURIComponent(relativePath)}`,
        )
        if (response.ok) {
          const json = await response.json()
          original = json.content || ''
        }
      } catch {
        original = ''
      }
    }
    setPendingDiff({
      path: relativePath,
      proposed: value || '',
      original,
      phase: Number(sdlcPhase) || 5,
    })
    pushToast({ type: 'info', message: `Review ${relativePath} in the editor` })
  }

  const applyToWorkspace = async () => {
    if (!activeWorkspace?.id) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    if (viewMode === 'ide') {
      setApplying(true)
      try {
        await queueIdeDiff(resolveIdePath())
      } finally {
        setApplying(false)
      }
      return
    }
    setApplying(true)
    try {
      const lang = (language || '').toLowerCase()
      const extMap = {
        javascript: 'js',
        js: 'js',
        jsx: 'jsx',
        typescript: 'ts',
        ts: 'ts',
        tsx: 'tsx',
        python: 'py',
        py: 'py',
        go: 'go',
        json: 'json',
        yaml: 'yml',
        yml: 'yml',
        sql: 'sql',
        markdown: 'md',
        md: 'md',
        csv: 'csv',
        toml: 'toml',
        text: 'txt',
        txt: 'txt',
      }
      const ext = extMap[lang] || 'md'
      const filename = `assistant-snippet.${ext}`
      const blob = new Blob([value || ''], { type: 'text/plain;charset=utf-8' })
      const file = new File([blob], filename, { type: 'text/plain' })
      const body = new FormData()
      body.append('file', file)
      body.append('sdlc_phase', String(sdlcPhase || 1))
      const response = await apiFetch(`/api/v1/workspaces/${activeWorkspace.id}/documents`, {
        method: 'POST',
        body,
      })
      if (!response.ok) {
        throw new Error((await response.text()) || 'Apply failed')
      }
      pushToast({ type: 'success', message: `Applied as ${filename}` })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Apply failed',
      })
    } finally {
      setApplying(false)
    }
  }

  const applyAndSyncToHost = async () => {
    if (!activeWorkspace?.id) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    const relativePath = resolveIdePath()
    if (viewMode === 'ide') {
      setSyncing(true)
      try {
        await queueIdeDiff(relativePath)
      } finally {
        setSyncing(false)
      }
      return
    }
    setSyncing(true)
    try {
      const phase = Number(sdlcPhase) || 5
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/apply-changes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase,
            files: [{ relative_path: relativePath, content: value || '' }],
          }),
        },
      )
      if (!response.ok) {
        throw new Error((await response.text()) || 'Apply & Sync failed')
      }
      const json = await response.json()
      const written = json.written?.[0] || relativePath
      notifyWorkspaceFsUpdated(activeWorkspace.id)
      pushToast({
        type: 'success',
        message: `Synced to host \`${written}\``,
      })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Apply & Sync failed',
      })
    } finally {
      setSyncing(false)
    }
  }

  const saveToLocalPc = async () => {
    if (!activeWorkspace?.id) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    setSavingLocal(true)
    try {
      const filename = defaultArtifactFileName(language)
      const result = await saveArtifactToLocalPc({
        workspaceId: activeWorkspace.id,
        fileName: filename,
        content: value || '',
        phase: sdlcPhase || 1,
      })
      pushToast({
        type: 'success',
        message: `Saved to \`${result.relative_path}\` on your PC`,
      })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Save to PC failed',
      })
    } finally {
      setSavingLocal(false)
    }
  }

  const tabs = [
    { id: 'formatted', label: 'Formatted' },
    { id: 'diff', label: 'Diff View' },
    { id: 'raw', label: 'Raw' },
  ]

  return (
    <div
      className="my-2 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--code-bg)]"
      data-testid="code-diff-viewer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
        <div className="flex flex-wrap gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded px-2 py-1 ${
                tab === item.id
                  ? 'bg-[var(--hover)] text-[var(--app-fg)]'
                  : 'hover:bg-[var(--hover)] hover:text-[var(--app-fg)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--app-fg)]"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            data-testid="apply-to-workspace"
            disabled={applying}
            onClick={applyToWorkspace}
            className="rounded px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply to Project Workspace'}
          </button>
          <button
            type="button"
            data-testid="apply-sync-to-host"
            disabled={syncing}
            onClick={applyAndSyncToHost}
            className="rounded px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Apply & Sync to Host'}
          </button>
          <button
            type="button"
            data-testid="save-to-local-pc"
            disabled={savingLocal}
            onClick={saveToLocalPc}
            className="rounded px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
          >
            {savingLocal ? 'Saving…' : 'Save to Local PC'}
          </button>
        </div>
      </div>

      {tab === 'formatted' ? (
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-[var(--app-fg)]">
          <code>{value}</code>
        </pre>
      ) : null}
      {tab === 'raw' ? (
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-[var(--muted)]">
          <code>{`\`\`\`${language || ''}\n${value || ''}\n\`\`\``}</code>
        </pre>
      ) : null}
      {tab === 'diff' ? (
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
          {lines.map((row, index) => (
            <div
              key={`${row.type}-${index}`}
              className={
                row.type === 'add'
                  ? 'bg-emerald-950/40 text-emerald-200'
                  : row.type === 'del'
                    ? 'bg-red-950/40 text-red-200'
                    : 'text-[var(--app-fg)]'
              }
            >
              <span className="mr-2 opacity-60">
                {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
              </span>
              {row.text}
            </div>
          ))}
        </pre>
      ) : null}
    </div>
  )
}
