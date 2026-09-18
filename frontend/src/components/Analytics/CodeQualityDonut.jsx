import { useMemo, useState } from 'react'

const SEGMENTS = [
  { key: 'code_quality', label: 'Clean code', color: '#64748b' },
  { key: 'test_completeness', label: 'Test coverage', color: '#94a3b8' },
  { key: 'security', label: 'Security posture', color: '#78716c' },
  { key: 'rag_readiness', label: 'RAG readiness', color: '#a8a29e' },
]

function clampPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, endAngle)
  const end = polar(cx, cy, r, startAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`
}

export default function CodeQualityDonut({ scores = {}, testabilityScore = 0 }) {
  const [hover, setHover] = useState(null)

  const slices = useMemo(() => {
    const values = SEGMENTS.map((seg) => ({
      ...seg,
      value: clampPct(
        seg.key === 'test_completeness'
          ? Math.max(Number(scores.test_completeness) || 0, testabilityScore || 0)
          : scores[seg.key],
      ),
    }))
    const total = values.reduce((sum, item) => sum + item.value, 0) || 1
    let angle = 0
    return values.map((item) => {
      const sweep = (item.value / total) * 360
      const start = angle
      const end = angle + Math.max(sweep, item.value > 0 ? 2 : 0)
      angle = end
      return { ...item, start, end, share: (item.value / total) * 100 }
    })
  }, [scores, testabilityScore])

  const cx = 80
  const cy = 80
  const r = 54
  const active = hover != null ? slices[hover] : null
  const centerLabel = active
    ? `${active.value.toFixed(0)}%`
    : `${(slices.reduce((s, x) => s + x.value, 0) / slices.length).toFixed(0)}%`

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-4"
      data-testid="code-quality-donut"
    >
      <h3 className="mb-3 text-xs uppercase tracking-wide text-[var(--muted)]">
        Code quality breakdown
      </h3>
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative mx-auto">
          <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="var(--border)"
              strokeWidth="16"
            />
            {slices.map((slice, index) => {
              if (slice.value <= 0) return null
              const path = arcPath(cx, cy, r, slice.start, slice.end)
              return (
                <path
                  key={slice.key}
                  d={path}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={hover === index ? 20 : 16}
                  strokeLinecap="butt"
                  className="cursor-pointer transition-[stroke-width]"
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {slice.label}: {slice.value.toFixed(0)}%
                  </title>
                </path>
              )
            })}
            <circle cx={cx} cy={cy} r="38" fill="var(--panel)" />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="fill-[var(--app-fg)] text-lg font-semibold"
              style={{ fontSize: '18px' }}
            >
              {centerLabel}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              style={{ fontSize: '10px', fill: 'var(--muted)' }}
            >
              {active ? active.label : 'avg score'}
            </text>
          </svg>
        </div>
        <ul className="min-w-[10rem] flex-1 space-y-2 text-sm">
          {slices.map((slice, index) => (
            <li
              key={slice.key}
              className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 ${
                hover === index ? 'bg-[var(--hover)]' : ''
              }`}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="flex items-center gap-2 text-[var(--app-fg)]">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: slice.color }}
                />
                {slice.label}
              </span>
              <span className="text-[var(--muted)]">{slice.value.toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
