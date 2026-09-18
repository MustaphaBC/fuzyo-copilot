import { X } from 'lucide-react'
import { useApp } from '../../context/AppContext'

export default function EditorTabBar() {
  const { openFiles, activeFilePath, setActiveFile, closeIdeFile } = useApp()

  if (!openFiles.length) return null

  return (
    <div
      className="flex min-h-[32px] items-stretch gap-0 overflow-x-auto bg-transparent"
      data-testid="editor-tab-bar"
      role="tablist"
    >
      {openFiles.map((file) => {
        const active = file.path === activeFilePath
        const name = file.path.split('/').pop() || file.path
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={active}
            className={`group flex max-w-[180px] items-center gap-1 border-r border-[var(--border)] px-2 text-xs ${
              active
                ? 'bg-[var(--panel)] text-[var(--app-fg)]'
                : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--app-fg)]'
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate py-1.5 text-left"
              onClick={() => setActiveFile(file.path)}
              title={file.path}
            >
              {file.dirty ? '• ' : ''}
              {name}
            </button>
            <button
              type="button"
              aria-label={`Close ${name}`}
              className="rounded p-0.5 opacity-60 hover:bg-[var(--hover)] hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                closeIdeFile(file.path)
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
