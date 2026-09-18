import { useEffect } from 'react'
import { useUI } from '../../context/UIContext'

export default function ToastContainer() {
  const { toasts, dismissToast } = useUI()

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast.duration) return undefined
    const id = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(id)
  }, [toast, onDismiss])

  const tone =
    toast.type === 'error'
      ? 'border-red-800/60 bg-red-950/90 text-red-100'
      : toast.type === 'success'
        ? 'border-emerald-800/50 bg-emerald-950/90 text-emerald-100'
        : 'border-[var(--border)] bg-[var(--panel)] text-[var(--app-fg)]'

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${tone}`}
      role="status"
    >
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button
        type="button"
        className="shrink-0 text-xs opacity-70 hover:opacity-100"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        Close
      </button>
    </div>
  )
}
