import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { isLikelyBot, welcomeSeen, dismissWelcome } from '@/utils/bot'
import { LegendList } from './LegendList'

// First-mobile-visit auto-peek (#643): mobile has no chip row, so the legend
// is the only surface that teaches what the dot colors mean — but it hides
// behind a small 4-dot button a first-time guest has no reason to tap. Once
// per device, on a phone-sized viewport, the legend panel peeks open on its
// own for a few seconds and then folds back into the button. A tap anywhere
// inside the peeked panel promotes it to a normally-opened legend (rows are
// live filter toggles); the peek never fires while another surface is open.
const PEEK_STORAGE_KEY = 'funradar:legend-peeked'
const PEEK_DELAY_MS = 1_500 // let the map paint first
// QA note (PR #646): 5s read as ~3s on a real phone once first-paint jank ate
// into it — a busy parent could miss the key entirely. 7s of visible time.
const PEEK_DURATION_MS = 7_000

// Legend with a standalone bottom-right icon button on ALL sizes (revision 4,
// item 1 — the legend is the primary "what are these dots?" affordance and no
// longer buried in the mobile ⋯). Its rows are tappable category filter toggles
// on all breakpoints (revision 6 — round 3 dropped the mobile chip row, so the
// legend is now the category-filter surface); the interactivity lives in the
// shared LegendList. Open state is the shared
// overlay coordinator (`overlay === 'legend'`) so opening it closes the detail
// panel and other popovers. z-20 at rest; the container lifts to z-50 while the
// popover is open. On mobile it sits above the bottom control bar.
export function LegendButton() {
  const { t } = useTranslation()
  const overlay = useMapStore((s) => s.overlay)
  const openOverlay = useMapStore((s) => s.openOverlay)
  const closeOverlay = useMapStore((s) => s.closeOverlay)
  const detailOpen = useMapStore((s) => s.selectedId !== null)
  // First-visit affordance — pulse the legend pin for new (non-bot) users.
  // Lazy initial state (not an effect): both reads are synchronous and
  // side-effect-free, so deciding on first render avoids the extra
  // render a mount-time setState would trigger.
  const [pulse, setPulse] = useState(() => !isLikelyBot() && !welcomeSeen())
  const [peeking, setPeeking] = useState(false)
  const isDesktop = useIsDesktop()
  const ref = useRef<HTMLDivElement>(null)
  const open = overlay === 'legend'

  // First-mobile-visit auto-peek (#643). The once-per-device flag is stamped
  // when the peek actually SHOWS (inside the timer), not on mount — a
  // StrictMode double-mount or an unmount during the delay must not burn the
  // one chance without anything having been seen.
  useEffect(() => {
    if (isDesktop || isLikelyBot()) return
    const show = window.setTimeout(() => {
      // Busy at fire time (deep link opened a pin, an overlay is up) → skip
      // WITHOUT stamping the flag, so the one chance isn't burned unseen.
      const s = useMapStore.getState()
      if (s.overlay !== null || s.selectedId !== null) return
      try {
        if (localStorage.getItem(PEEK_STORAGE_KEY)) return
        localStorage.setItem(PEEK_STORAGE_KEY, '1')
      } catch { return } // storage blocked — cannot dedupe, skip rather than nag every visit
      setPeeking(true)
    }, PEEK_DELAY_MS)
    const hide = window.setTimeout(() => setPeeking(false), PEEK_DELAY_MS + PEEK_DURATION_MS)
    return () => { window.clearTimeout(show); window.clearTimeout(hide) }
  }, [isDesktop])

  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeOverlay('legend')
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay('legend') }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', click)
      document.removeEventListener('keydown', key)
    }
  }, [open, closeOverlay])

  const toggleOpen = () => {
    if (open) closeOverlay('legend')
    else openOverlay('legend')
    setPeeking(false)
    if (pulse) { dismissWelcome(); setPulse(false) }
  }

  // The peek renders the same panel without claiming the overlay coordinator,
  // and yields to anything the user actually opened (another overlay, a pin's
  // detail view) so it never sits on top of a deliberate action.
  const peekVisible = peeking && !open && overlay === null && !detailOpen

  return (
    <div ref={ref} className={`absolute right-3 bottom-20 md:bottom-8 transition-transform duration-200 ${open || peekVisible ? 'z-50' : 'z-20'} ${detailOpen ? 'md:-translate-x-[392px]' : ''}`}>
      {(open || peekVisible) && (
        <div
          // A tap anywhere in the peeked panel promotes it to the real thing:
          // the row's own filter toggle still runs, and the panel stops
          // auto-collapsing under the user's finger.
          onPointerDown={peekVisible ? () => { openOverlay('legend'); setPeeking(false); if (pulse) { dismissWelcome(); setPulse(false) } } : undefined}
          // w-[290px] fits the two-column list in both the peek and the
          // opened legend — same shape, so peek→open doesn't reflow into a
          // screen-tall single column (#643 follow-up).
          className="absolute bottom-full right-0 mb-2 backdrop-blur-md bg-white/95 dark:bg-gray-900/95 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 overflow-hidden max-h-[60vh] overflow-y-auto w-[290px] max-w-[calc(100vw-24px)]"
        >
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('legend.categories')}</div>
            {!peekVisible && (
              <div className="text-[11px] font-normal text-gray-400 dark:text-gray-500">{t('legend.tapToFilter')}</div>
            )}
          </div>
          <LegendList peek={peekVisible} />
        </div>
      )}
      <button
        onClick={toggleOpen}
        aria-pressed={open}
        aria-label={t('legend.mapLegend')}
        title={t('legend.legend')}
        className={`relative backdrop-blur-md ${open ? 'bg-white dark:bg-gray-900' : 'bg-white/90 dark:bg-gray-900/90'} text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-white dark:hover:bg-gray-900 transition-colors`}
      >
        {/* Colored pin icon — matches map pins (bigger circles for visibility) */}
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
          <circle cx="7" cy="7" r="4.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="17" cy="11" r="4.5" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="9" cy="17" r="4.5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
        </svg>
        {pulse && (
          <>
            <span className="absolute inset-0 rounded-lg ring-2 ring-amber-400 animate-ping pointer-events-none" />
            <span className="absolute inset-0 rounded-lg ring-2 ring-amber-400 pointer-events-none" />
          </>
        )}
      </button>
    </div>
  )
}
