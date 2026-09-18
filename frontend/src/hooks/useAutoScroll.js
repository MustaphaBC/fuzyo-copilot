import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Auto-follow stream tokens; freeze when user scrolls up; floating jump button.
 */
export function useAutoScroll(deps = []) {
  const containerRef = useRef(null)
  const bottomRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance <= 150
    stickToBottomRef.current = nearBottom
    setShowJump(!nearBottom)
  }, [])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const jumpToBottom = useCallback(() => {
    stickToBottomRef.current = true
    setShowJump(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  return { containerRef, bottomRef, onScroll, showJump, jumpToBottom }
}
