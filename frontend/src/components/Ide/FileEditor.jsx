import Editor from '@monaco-editor/react'
import { useCallback, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { useUI } from '../../context/UIContext'
import { apiFetch } from '../../lib/api'
import { notifyWorkspaceFsUpdated } from '../../lib/saveLocalArtifact'

export default function FileEditor() {
  const {
    activeWorkspace,
    openFiles,
    activeFilePath,
    appearance,
    updateIdeFileContent,
    markDirty,
  } = useApp()
  const { pushToast } = useUI()

  const active = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) || null,
    [openFiles, activeFilePath],
  )

  const save = useCallback(async () => {
    if (!activeWorkspace?.id || !active) return
    try {
      const response = await apiFetch(
        `/api/v1/workspaces/${activeWorkspace.id}/fs/file`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: active.path, content: active.content ?? '' }),
        },
      )
      if (!response.ok) {
        throw new Error((await response.text()) || 'Save failed')
      }
      markDirty(active.path, false)
      notifyWorkspaceFsUpdated(activeWorkspace.id)
      pushToast({ type: 'success', message: `Saved ${active.path}` })
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Save failed',
      })
    }
  }, [active, activeWorkspace?.id, markDirty, pushToast])

  const onMount = useCallback(
    (editor, monaco) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        save()
      })
    },
    [save],
  )

  if (!active) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]"
        data-testid="file-editor-empty"
      >
        Open a file from the explorer
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1" data-testid="file-editor">
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          data-testid="ide-save-file"
          onClick={save}
          disabled={!active.dirty}
          className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[11px] text-[var(--app-fg)] hover:bg-[var(--hover)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <Editor
        height="100%"
        language={active.language || 'plaintext'}
        theme={appearance === 'dark' ? 'vs-dark' : 'light'}
        value={active.content ?? ''}
        onChange={(value) => updateIdeFileContent(active.path, value ?? '', { dirty: true })}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  )
}
