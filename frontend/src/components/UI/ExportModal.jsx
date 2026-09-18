export default function ExportModal({ open, threadTitle, messages, onClose }) {
  if (!open) return null

  const safeName = (threadTitle || 'chat').replace(/[^\w-]+/g, '_').slice(0, 48)

  function download(filename, content, type) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function exportMarkdown() {
    const lines = [`# ${threadTitle || 'Chat'}\n`]
    for (const msg of messages || []) {
      const role = msg.role === 'user' ? 'You' : 'Assistant'
      lines.push(`## ${role}\n\n${msg.content || ''}\n`)
    }
    download(`${safeName}.md`, lines.join('\n'), 'text/markdown;charset=utf-8')
    onClose?.()
  }

  function exportJson() {
    const payload = {
      title: threadTitle || 'Chat',
      exportedAt: new Date().toISOString(),
      messages: (messages || []).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        routingBadge: msg.routingBadge ?? null,
      })),
    }
    download(
      `${safeName}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
    onClose?.()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--overlay)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        data-testid="export-modal"
      >
        <h2 id="export-modal-title" className="text-base font-semibold text-[var(--app-fg)]">
          Export chat
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Download the current thread as Markdown or JSON.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={exportMarkdown}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
            data-testid="export-md"
          >
            Download .md
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--app-fg)] hover:bg-[var(--hover)]"
            data-testid="export-json"
          >
            Download .json
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
