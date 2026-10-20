import { useRef, useState } from 'react'

/**
 * Drag-down-to-dismiss pointer mechanics extracted from the BottomSheet grabber
 * (design handoff revision 2, item 2c). Reused by the mobile ListPanel so a
 * swipe down past `threshold` returns to map view. Simpler than the sheet's
 * three-snap logic: it only tracks downward drag and fires `onDismiss` past the
 * threshold, snapping back to 0 otherwise.
 *
 * Returns the live vertical `offset` (px, >= 0), a `dragging` flag (to disable
 * the transition mid-drag), and `grabberProps` to spread onto the drag handle.
 */
export function useDragToDismiss(onDismiss: () => void, threshold = 100) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef<number | null>(null)
  const offsetRef = useRef(0)

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
    setDragging(true)
    // Optional-chained: jsdom (tests) doesn't implement setPointerCapture.
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return
    const dy = Math.max(0, e.clientY - startY.current)
    offsetRef.current = dy
    setOffset(dy)
  }
  const end = () => {
    if (startY.current == null) return
    startY.current = null
    setDragging(false)
    const dismissed = offsetRef.current > threshold
    // Always reset the offset to 0 — including on dismiss. The consumer
    // (ListPanel) stays mounted and just returns null in map view, so a
    // leftover offset would translate the panel down when it reopens
    // (bug: swipe-dismiss → toggle back to list showed a shoved-down panel).
    offsetRef.current = 0
    setOffset(0)
    if (dismissed) onDismiss()
  }

  return {
    offset,
    dragging,
    grabberProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  }
}
