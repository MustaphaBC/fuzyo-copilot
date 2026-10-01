import { ShieldCheck } from 'lucide-react'

export default function ForceConfidentialModal({ open, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--overlay)' }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-confidential-title"
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        data-testid="force-confidential-modal"
      >
        <h2
          id="force-confidential-title"
          className="flex items-center gap-2 text-base font-semibold text-[var(--app-fg)]"
        >
          <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          Force confidential mode
        </h2>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-current" /> LOCAL ONLY
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Requests are routed to the local mock path. No external cloud provider will receive
          the request, and responses will come from the local stub.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="force-confidential-enable"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  )
}
