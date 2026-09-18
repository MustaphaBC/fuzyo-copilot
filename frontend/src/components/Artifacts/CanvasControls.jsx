import { Download, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'

/**
 * Floating viewport toolbar for the Artifact Canvas.
 * Zoom steps: ±0.2, clamp 0.4–3.0; Reset restores scale 1 + pan (0,0).
 */
export default function CanvasControls({
  scale = 1,
  onZoomIn,
  onZoomOut,
  onReset,
  onExport,
  onClose,
  onPopout,
  title,
}) {
  const pct = Math.round(Number(scale) * 100)

  return (
    <div
      className="pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-[#141418]/95 px-1.5 py-1.5 shadow-2xl backdrop-blur-md"
      data-testid="canvas-controls"
      role="toolbar"
      aria-label="Canvas viewport controls"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {title ? (
        <span className="mr-1 hidden max-w-[10rem] truncate px-2 text-xs text-white/70 sm:inline">
          {title}
        </span>
      ) : null}

      <button
        type="button"
        data-testid="canvas-zoom-in"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
        className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <Plus className="h-4 w-4" />
      </button>
      <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-white/60">
        {pct}%
      </span>
      <button
        type="button"
        data-testid="canvas-zoom-out"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onZoomOut}
        className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-testid="canvas-reset"
        aria-label="Reset view"
        title="Reset view"
        onClick={onReset}
        className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <RotateCcw className="h-4 w-4" />
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      {typeof onExport === 'function' ? (
        <button
          type="button"
          data-testid="canvas-export"
          aria-label="Export image"
          title="Export PNG"
          onClick={onExport}
          className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <Download className="h-4 w-4" />
        </button>
      ) : null}

      {typeof onPopout === 'function' ? (
        <button
          type="button"
          data-testid="canvas-popout"
          aria-label="Pop out"
          title="Pop out"
          onClick={onPopout}
          className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      ) : null}

      <button
        type="button"
        data-testid="canvas-close"
        aria-label="Close canvas"
        title="Close"
        onClick={onClose}
        className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
