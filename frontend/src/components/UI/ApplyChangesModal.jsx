import { FileCode2, HardDrive } from 'lucide-react'
import { useState } from 'react'

export default function ApplyChangesModal({ open, workspaceName, files, onCancel, onConfirm }) {
  const [approved, setApproved] = useState(false)

  if (!open) return null

  const close = () => {
    setApproved(false)
    onCancel()
  }
  const confirm = () => {
    setApproved(false)
    onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--overlay)' }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-changes-title"
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        data-testid="apply-changes-modal"
      >
        <h2
          id="apply-changes-title"
          className="flex items-center gap-2 text-base font-semibold text-[var(--app-fg)]"
        >
          <HardDrive className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
          Apply changes to host
        </h2>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Target</dt>
            <dd className="truncate text-right text-[var(--app-fg)]">{workspaceName || 'Workspace'}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Files ({files.length})</dt>
            <dd className="mt-1 space-y-1">
              {files.map((path) => (
                <p
                  key={path}
                  className="flex items-center gap-1.5 rounded-md bg-[var(--chip)] px-2 py-1 font-mono text-xs text-[var(--app-fg)]"
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {path}
                </p>
              ))}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Backup</dt>
            <dd className="text-right text-[var(--app-fg)]">Existing files copied to .fuzyo/backups/</dd>
          </div>
        </dl>

        <label className="mt-4 flex items-start gap-2 text-sm text-[var(--app-fg)]">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
            className="mt-0.5"
            data-testid="apply-changes-approve"
          />
          I reviewed these changes and approve writing them to disk.
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!approved}
            data-testid="apply-changes-confirm"
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
