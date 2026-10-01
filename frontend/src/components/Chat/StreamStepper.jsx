import { Check, Circle, Loader2, Minus, X } from 'lucide-react'

const STEPS = [
  { id: 'routing', label: 'Routing' },
  { id: 'rag', label: 'RAG' },
  { id: 'generation', label: 'Generation' },
  { id: 'quality', label: 'Quality' },
]

/**
 * Derive per-step state from SSE meta.
 * States: pending | active | done | skipped | failed
 */
function deriveStepStates(meta, streaming) {
  const states = { routing: 'pending', rag: 'pending', generation: 'pending', quality: 'pending' }
  if (!meta) return states

  states.routing = meta.routing ? 'done' : streaming ? 'active' : 'pending'

  if (meta.rag) {
    states.rag = meta.rag.status === 'skipped' ? 'skipped' : 'done'
  } else if (meta.routing && streaming) {
    states.rag = 'active'
  }

  if (meta.quality) {
    states.generation = 'done'
  } else if (meta.rag && streaming) {
    states.generation = 'active'
  } else if (!streaming && (meta.tokenCount ?? 0) > 0) {
    states.generation = 'done'
  }

  if (meta.quality) {
    const passed = meta.quality.is_valid === true || Number(meta.quality.tier3_score) >= 7
    if (meta.retry && !passed && streaming) {
      states.quality = 'active'
    } else {
      states.quality = passed ? 'done' : 'failed'
    }
  } else if (meta.retry && streaming) {
    states.quality = 'active'
  }

  if (!streaming && (meta.stopped || meta.error)) {
    for (const step of STEPS) {
      if (states[step.id] === 'active') states[step.id] = 'failed'
    }
  }
  return states
}

function StepIcon({ state }) {
  switch (state) {
    case 'done':
      return <Check className="h-3 w-3" aria-hidden="true" />
    case 'active':
      return <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
    case 'skipped':
      return <Minus className="h-3 w-3" aria-hidden="true" />
    case 'failed':
      return <X className="h-3 w-3" aria-hidden="true" />
    case 'pending':
      return <Circle className="h-2.5 w-2.5" aria-hidden="true" />
    default: {
      const exhaustive = state
      throw new Error(`Unknown step state: ${exhaustive}`)
    }
  }
}

const STATE_CLASSES = {
  done: 'border-emerald-600/50 text-emerald-600 dark:text-emerald-300',
  active: 'border-sky-500/60 text-sky-600 dark:text-sky-300',
  skipped: 'border-[var(--border)] text-[var(--muted)]',
  failed: 'border-red-600/50 text-red-600 dark:text-red-300',
  pending: 'border-[var(--border)] text-[var(--muted)] opacity-70',
}

export default function StreamStepper({ meta, streaming, className = '' }) {
  const states = deriveStepStates(meta, streaming)
  const attempt = meta?.retry?.attempt

  return (
    <ol
      className={`flex flex-wrap items-center gap-1.5 text-[11px] ${className}`}
      data-testid="stream-stepper"
      aria-label="Generation progress"
    >
      {STEPS.map((step, index) => {
        const state = states[step.id]
        return (
          <li key={step.id} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${STATE_CLASSES[state]}`}
              data-testid={`stream-step-${step.id}`}
              data-state={state}
            >
              <StepIcon state={state} />
              {step.label}
              {step.id === 'quality' && attempt ? ` · ${attempt}/3` : ''}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="text-[var(--muted)]" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
