export default function EmptyState({
  title = 'Nothing here yet',
  description = '',
  action = null,
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-[var(--app-fg)]">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
