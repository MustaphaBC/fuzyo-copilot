import { useUI } from '../../context/UIContext'

const SHORTCUTS = [
  { keys: 'Ctrl/Cmd + K', label: 'Command palette' },
  { keys: 'Ctrl/Cmd + \\', label: 'Toggle sidebar' },
  { keys: 'Ctrl/Cmd + Shift + O', label: 'New chat' },
  { keys: 'Ctrl/Cmd + /', label: 'Shortcut guide' },
  { keys: 'Ctrl/Cmd + D', label: 'Toggle theme' },
]

export default function ShortcutGuide() {
  const { shortcutGuideOpen, setShortcutGuideOpen } = useUI()
  if (!shortcutGuideOpen) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--overlay)] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-guide-title"
      data-testid="shortcut-guide"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShortcutGuideOpen(false)
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="shortcut-guide-title" className="text-base font-semibold text-[var(--app-fg)]">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            className="text-sm text-[var(--muted)] hover:text-[var(--app-fg)]"
            onClick={() => setShortcutGuideOpen(false)}
          >
            Close
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((item) => (
            <li
              key={item.keys}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="text-[var(--app-fg)]">{item.label}</span>
              <kbd className="rounded border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                {item.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
