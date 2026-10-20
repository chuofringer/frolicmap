import type { MouseEvent } from 'react'

/** A plain primary-button click: no modifier keys, nothing a browser treats as "open elsewhere". */
export function isPlainLeftClick(
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>,
): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
