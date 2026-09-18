import { Download } from 'lucide-react'
import { useState } from 'react'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'

function defaultFormatForPhase(phase) {
  const id = Number(phase) || 1
  if (id === 5 || id === 6) return 'zip'
  return 'docx'
}

function defaultLabel(phase, format) {
  const id = Number(phase) || 1
  const fmt = (format || defaultFormatForPhase(id)).toLowerCase()
  if (id === 1 && fmt === 'docx') return 'Download CDC (.docx)'
  if (fmt === 'zip') return `Download (.zip)`
  if (fmt === 'md') return 'Download (.md)'
  if (fmt === 'pdf') return 'Download (.pdf)'
  if (fmt === 'raw') return 'Download (raw)'
  return `Download (.${fmt})`
}

export default function DeliverableDownloadButton({
  workspaceId,
  phase,
  format,
  label,
  className = '',
}) {
  const { pushToast } = useUI()
  const [busy, setBusy] = useState(false)
  const fmt = (format || defaultFormatForPhase(phase)).toLowerCase()
  const buttonLabel = label || defaultLabel(phase, fmt)

  const onClick = async () => {
    if (!workspaceId) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${workspaceId}/deliverables/${Number(phase) || 1}/download?format=${encodeURIComponent(fmt)}`,
      )
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Download failed (${response.status})`)
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = /filename="([^"]+)"/i.exec(disposition)
      const filename = match?.[1] || `phase_${phase}.${fmt}`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      pushToast({ type: 'success', message: `Downloaded ${filename}` })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Download failed',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      data-testid="deliverable-download"
      data-phase={String(phase)}
      data-format={fmt}
      disabled={busy || !workspaceId}
      onClick={onClick}
      className={
        className ||
        'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-50'
      }
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? 'Preparing…' : buttonLabel}
    </button>
  )
}

export { defaultFormatForPhase }
