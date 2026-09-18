export default function TechStackBar({ languages = [], frameworks = [] }) {
  const total = languages.reduce((sum, lang) => sum + (Number(lang.pct) || 0), 0) || 100

  return (
    <section className="space-y-3" data-testid="tech-stack-bar">
      <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Languages</h3>
      {languages.length ? (
        <>
          <div className="flex h-3 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--panel-elevated)]">
            {languages.map((lang) => (
              <div
                key={lang.name}
                title={`${lang.name} ${lang.pct}%`}
                style={{
                  width: `${((Number(lang.pct) || 0) / total) * 100}%`,
                  backgroundColor: lang.color || 'var(--muted)',
                }}
                className="h-full"
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-3 text-xs text-[var(--app-fg)]">
            {languages.map((lang) => (
              <li key={lang.name} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: lang.color || 'var(--muted)' }}
                />
                {lang.name} {Number(lang.pct || 0).toFixed(0)}%
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">No language signals yet.</p>
      )}

      {frameworks?.length ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {frameworks.map((fw) => (
            <span
              key={fw}
              className="rounded-md border border-[var(--border)] bg-[var(--chip)] px-2.5 py-1 text-xs text-[var(--app-fg)]"
            >
              {fw}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}
