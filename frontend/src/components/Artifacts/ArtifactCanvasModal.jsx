import mermaid from 'mermaid'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useArtifact } from '../../context/ArtifactContext'
import { renderMermaidSafe } from '../../utils/sanitizeMermaid'
import CanvasControls from './CanvasControls'

const MIN_SCALE = 0.4
const MAX_SCALE = 3
const SCALE_STEP = 0.2

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))))
}

function downloadSvgAsPng(svgEl, filename = 'artifact.png') {
  if (!svgEl) return
  const serializer = new XMLSerializer()
  let svgText = serializer.serializeToString(svgEl)
  if (!svgText.includes('xmlns=')) {
    svgText = svgText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const bbox = svgEl.getBoundingClientRect()
    const width = Math.max(1, Math.ceil(bbox.width || svgEl.viewBox?.baseVal?.width || 800))
    const height = Math.max(1, Math.ceil(bbox.height || svgEl.viewBox?.baseVal?.height || 600))
    const canvas = document.createElement('canvas')
    const scale = 2
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)
    URL.revokeObjectURL(url)
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(pngBlob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1500)
    }, 'image/png')
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
  }
  img.src = url
}

export default function ArtifactCanvasModal() {
  const { activeArtifact, isOpen, closeArtifact } = useArtifact()
  const reactId = useId().replace(/:/g, '')
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 })

  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') closeArtifact()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [isOpen, closeArtifact])

  useEffect(() => {
    if (!isOpen) return
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [isOpen, activeArtifact?.content, activeArtifact?.type])

  useEffect(() => {
    if (!isOpen || !activeArtifact) return undefined
    let cancelled = false

    async function renderContent() {
      setError(null)
      setSvg('')
      if (activeArtifact.type === 'mermaid') {
        const renderId = `canvas-mmd-${reactId}-${Date.now()}`
        const result = await renderMermaidSafe(
          mermaid,
          renderId,
          activeArtifact.content,
          'dark',
        )
        if (cancelled) return
        if (result.error) {
          setError(result.error)
          return
        }
        setSvg(result.svg)
        return
      }
      // code / doc: show as preformatted text card
      setSvg('')
    }

    renderContent()
    return () => {
      cancelled = true
    }
  }, [isOpen, activeArtifact, reactId])

  const zoomBy = useCallback((delta) => {
    setScale((prev) => clampScale(prev + delta))
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleWheel = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    const direction = event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
    setScale((prev) => clampScale(prev + direction))
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node || !isOpen) return undefined
    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
  }, [handleWheel, isOpen])

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      origX: pan.x,
      origY: pan.y,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event) => {
    if (!dragRef.current.active) return
    const dx = event.clientX - dragRef.current.startX
    const dy = event.clientY - dragRef.current.startY
    setPan({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    })
  }

  const onPointerUp = (event) => {
    dragRef.current.active = false
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handleExport = () => {
    const host = contentRef.current
    const svgEl = host?.querySelector?.('svg')
    if (svgEl) {
      downloadSvgAsPng(svgEl, `${(activeArtifact?.title || 'artifact').replace(/\s+/g, '_')}.png`)
      return
    }
    // Fallback: download text content
    const blob = new Blob([activeArtifact?.content || ''], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(activeArtifact?.title || 'artifact').replace(/\s+/g, '_')}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  if (!isOpen || !activeArtifact) return null

  const transform = `matrix(${scale}, 0, 0, ${scale}, ${pan.x}, ${pan.y})`

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      data-testid="artifact-canvas-modal"
      role="dialog"
      aria-modal="true"
      aria-label={activeArtifact.title || 'Artifact canvas'}
    >
      <div
        className="absolute inset-0 bg-[#0a0a0c]/92"
        onClick={closeArtifact}
        aria-hidden
      />

      <div
        ref={viewportRef}
        className="relative z-10 flex min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        style={{
          backgroundColor: 'var(--canvas-bg, #0a0a0c)',
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <CanvasControls
          scale={scale}
          title={activeArtifact.title}
          onZoomIn={() => zoomBy(SCALE_STEP)}
          onZoomOut={() => zoomBy(-SCALE_STEP)}
          onReset={resetView}
          onExport={handleExport}
          onClose={closeArtifact}
        />

        <div
          className="flex h-full w-full items-center justify-center"
          style={{ pointerEvents: dragging ? 'none' : 'auto' }}
        >
          <div
            ref={contentRef}
            data-testid="artifact-canvas-stage"
            style={{
              transform,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
            className="[&_svg]:max-w-none [&_.node rect]:fill-[#1e1e24] [&_.node .label]:fill-white [&_.edgePath path]:stroke-[#3b82f6]"
          >
            {error ? (
              <pre className="max-w-3xl rounded-xl border border-white/10 bg-[#1e1e24] p-4 text-xs text-red-300">
                {error}
                {'\n\n'}
                {activeArtifact.content}
              </pre>
            ) : null}

            {!error && activeArtifact.type === 'mermaid' && svg ? (
              <div
                className="rounded-2xl border border-white/5 bg-[#121216]/40 p-6 shadow-2xl"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : null}

            {!error && activeArtifact.type !== 'mermaid' ? (
              <div className="max-h-[70vh] max-w-4xl overflow-auto rounded-2xl border border-white/10 bg-[#1e1e24] p-6 text-left shadow-2xl">
                <p className="mb-3 text-xs uppercase tracking-wide text-white/50">
                  {activeArtifact.type}
                </p>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-white">
                  {activeArtifact.content}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
