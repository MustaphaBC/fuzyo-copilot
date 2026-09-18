export default function DeleteConfirmModal({
  open,
  title = 'Delete?',
  description = 'This cannot be undone.',
  error = '',
  busy = false,
  confirmLabel = 'Delete',
  onCancel,
  onConfirm,
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--overlay)' }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        data-testid="delete-confirm-modal"
      >
        <h2 id="delete-confirm-title" className="text-base font-semibold text-[var(--app-fg)]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
