import { AlertTriangle, Clock, Database, Lock, ShieldAlert, Shuffle } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Notice kinds attached to an assistant message:
 *  - sensitive:              { kind, secrets: string[] }
 *  - classifier_unavailable: { kind }
 *  - degraded_rag:           { kind, hitCount }
 *  - fallback:               { kind, fromProvider, toProvider, target, reason }
 *  - rate_limit:             { kind, retryAfter: number, message }
 *  - error:                  { kind, message }
 */

const TONES = {
  amber:
    'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100',
  sky: 'border-sky-500/40 bg-sky-50 text-sky-900 dark:border-sky-700/50 dark:bg-sky-950/30 dark:text-sky-100',
  red: 'border-red-500/40 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-100',
  emerald:
    'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-100',
}

function Card({ tone, icon, title, testId, children, actions }) {
  const Icon = icon
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs ${TONES[tone]}`}
      role="status"
      data-testid={testId}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{title}</p>
          <div className="leading-relaxed opacity-90">{children}</div>
          {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
        </div>
      </div>
    </div>
  )
}

function RateLimitCard({ notice, onRetry }) {
  const [remaining, setRemaining] = useState(Math.max(0, Number(notice.retryAfter) || 0))

  useEffect(() => {
    if (remaining <= 0) return undefined
    const timer = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [remaining])

  return (
    <Card
      tone="amber"
      icon={Clock}
      title="Rate limit reached"
      testId="rate-limit-card"
      actions={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={remaining > 0}
            className="rounded-md border border-current/30 px-2 py-1 font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            data-testid="rate-limit-retry"
          >
            {remaining > 0 ? `Retry in ${remaining}s` : 'Retry now'}
          </button>
        ) : null
      }
    >
      Too many requests in a short period. Your message is preserved.
      {notice.message ? <span className="block opacity-80">{notice.message}</span> : null}
    </Card>
  )
}

function NoticeCard({ notice, onRetry }) {
  switch (notice.kind) {
    case 'sensitive':
      return (
        <Card tone="emerald" icon={Lock} title="Sensitive content detected" testId="sensitive-card">
          Request routed to the <strong>local model</strong> only — nothing was sent to a cloud provider.
          {notice.secrets?.length ? (
            <span className="mt-1 block">Detected: {notice.secrets.join(', ')}</span>
          ) : null}
        </Card>
      )
    case 'classifier_unavailable':
      return (
        <Card
          tone="amber"
          icon={ShieldAlert}
          title="Privacy classifier unavailable"
          testId="classifier-unavailable-card"
        >
          No sensitivity classifier could score this prompt (unreachable, timed out, or misconfigured). Fuzyo
          failed closed and used the local model.
        </Card>
      )
    case 'degraded_rag':
      return (
        <Card tone="sky" icon={Database} title="Degraded retrieval (BM25)" testId="degraded-rag-card">
          Vector search was unavailable; context came from keyword search over local project files
          {typeof notice.hitCount === 'number' ? ` (${notice.hitCount} hits)` : ''}. Answers may be less precise.
        </Card>
      )
    case 'fallback':
      return (
        <Card tone="sky" icon={Shuffle} title="Provider fallback" testId="fallback-card">
          {notice.fromProvider} was unavailable ({notice.reason}); switched to{' '}
          <strong>{notice.toProvider}</strong>
          {notice.target === 'LOCAL' ? ' (local model)' : ''}.
        </Card>
      )
    case 'rate_limit':
      return <RateLimitCard notice={notice} onRetry={onRetry} />
    case 'error':
      return (
        <Card tone="red" icon={AlertTriangle} title="Request failed" testId="stream-error-card">
          {notice.message}
        </Card>
      )
    default: {
      const exhaustive = notice.kind
      throw new Error(`Unknown notice kind: ${exhaustive}`)
    }
  }
}

export default function StatusCards({ notices, onRetry }) {
  if (!notices?.length) return null
  return (
    <div className="space-y-2" data-testid="status-cards">
      {notices.map((notice, index) => (
        <NoticeCard key={`${notice.kind}-${index}`} notice={notice} onRetry={onRetry} />
      ))}
    </div>
  )
}
