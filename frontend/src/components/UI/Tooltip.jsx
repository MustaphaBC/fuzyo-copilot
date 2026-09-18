import { useId, useState } from 'react'

export default function Tooltip({ label, children, side = 'top' }) {
  const id = useId()
  const [open, setOpen] = useState(false)

  const position =
    side === 'bottom'
      ? 'top-full mt-1 left-1/2 -translate-x-1/2'
      : side === 'left'
        ? 'right-full mr-1 top-1/2 -translate-y-1/2'
        : side === 'right'
          ? 'left-full ml-1 top-1/2 -translate-y-1/2'
          : 'bottom-full mb-1 left-1/2 -translate-x-1/2'

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1 text-[11px] text-[var(--app-fg)] shadow-lg ${position}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
