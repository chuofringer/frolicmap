import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Shared modal a11y contract, extracted from the focus/Escape wiring
 * WelcomeGate and MetroPicker each had inline (deep-review #426): focus the
 * dialog on open, Escape closes it, and Tab/Shift+Tab cycle within the
 * dialog instead of walking focus out to the map behind it.
 *
 * `open` gates all wiring so a closed/unmounted dialog never listens.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  // Callers pass freshly-created onClose functions every render; taking the
  // latest through a ref keeps the effect's deps to [open, ref] so an
  // unrelated re-render doesn't tear the trap down and yank focus back to
  // the dialog container mid-interaction.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    ref.current?.focus()

    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const el = ref.current
      if (!el) return
      const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && el.contains(active)
      if (e.shiftKey) {
        // `active === el` covers the just-opened state where focus sits on
        // the container itself (tabIndex=-1, excluded from FOCUSABLE_SELECTOR)
        // — without it the browser would walk focus backwards out of the
        // dialog to whatever precedes it in the document.
        if (!inside || active === first || active === el) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (!inside || active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, ref])
}
