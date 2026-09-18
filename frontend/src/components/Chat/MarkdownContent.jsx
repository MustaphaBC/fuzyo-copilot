import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function priorityClass(value) {
  const v = String(value || '').toLowerCase()
  if (v.includes('high') || v.includes('haute') || v.includes('p0') || v.includes('p1')) {
    return 'border-rose-800/50 bg-rose-950/40 text-rose-200'
  }
  if (v.includes('medium') || v.includes('moyenne') || v.includes('p2')) {
    return 'border-amber-800/50 bg-amber-950/30 text-amber-200'
  }
  if (v.includes('low') || v.includes('basse') || v.includes('p3')) {
    return 'border-emerald-800/50 bg-emerald-950/30 text-emerald-200'
  }
  return 'border-[var(--border)] bg-[var(--chip)] text-[var(--muted)]'
}

function flattenText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (node?.props?.children) return flattenText(node.props.children)
  return ''
}

function looksLikePriorityValue(text) {
  return /^(high|medium|low|haute|moyenne|basse|p[0-3]|critical|urgent)$/i.test(
    String(text || '').trim(),
  )
}

function CellContent({ children, isPriorityCol }) {
  const text = flattenText(children)

  if (isPriorityCol && text && text.trim() && !/^-+$/.test(text.trim())) {
    return (
      <span
        className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${priorityClass(text)}`}
      >
        {text.trim()}
      </span>
    )
  }
  return children
}

const markdownComponents = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-1 text-lg font-semibold tracking-tight text-[var(--app-fg)]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2.5 mt-4 border-b border-[var(--border)] pb-1.5 text-base font-semibold text-[var(--app-fg)] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold text-[var(--app-fg)]">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-sm font-medium text-[var(--app-fg)]">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mb-2.5 text-sm leading-relaxed text-[var(--app-fg)] last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-[var(--app-fg)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-[var(--app-fg)]">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed marker:text-[var(--muted)]">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--app-fg)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[var(--app-fg)]">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sky-400 underline decoration-sky-700/50 underline-offset-2 hover:text-sky-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--border)]" />,
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === 'string' && className.includes('language-')
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded border border-[var(--border)] bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--app-fg)]"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-3 text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div
      className="my-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] shadow-sm shadow-black/10"
      data-testid="markdown-table"
    >
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--chip)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-[var(--border)]">{children}</tbody>,
  tr: ({ children }) => (
    <tr className="transition-colors hover:bg-[var(--hover)]/60">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3 py-2.5 font-medium">{children}</th>
  ),
  td: ({ children, ...props }) => {
    const text = flattenText(children)
    const isPriority = looksLikePriorityValue(text) && text.length < 16
    return (
      <td className="px-3 py-2.5 align-top text-[var(--app-fg)]" {...props}>
        <CellContent isPriorityCol={isPriority}>{children}</CellContent>
      </td>
    )
  },
  input: ({ checked, ...props }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      className="mr-2 align-middle accent-sky-500"
      {...props}
    />
  ),
}

export default function MarkdownContent({ content }) {
  if (!content?.trim()) return null

  return (
    <div className="fuzyo-md space-y-1" data-testid="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
