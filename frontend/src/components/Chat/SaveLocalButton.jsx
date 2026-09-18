import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import {
  defaultArtifactFileName,
  saveArtifactToLocalPc,
} from '../../lib/saveLocalArtifact'

export default function SaveLocalButton({
  content,
  fileName,
  language,
  label = 'Save to Local PC',
}) {
  const { activeWorkspace, sdlcPhase } = useApp()
  const { pushToast } = useUI()
  const [busy, setBusy] = useState(false)

  const onSave = async () => {
    if (!activeWorkspace?.id) {
      pushToast({ type: 'error', message: 'Select a workspace first' })
      return
    }
    if (!String(content || '').trim()) {
      pushToast({ type: 'error', message: 'Nothing to save' })
      return
    }
    setBusy(true)
    try {
      const name = fileName || defaultArtifactFileName(language)
      const result = await saveArtifactToLocalPc({
        workspaceId: activeWorkspace.id,
        fileName: name,
        content: content || '',
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
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      data-testid="save-to-local-pc"
      disabled={busy}
      onClick={onSave}
      className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)] disabled:opacity-50"
    >
      {busy ? 'Saving…' : label}
    </button>
  )
}
