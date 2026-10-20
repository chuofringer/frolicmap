import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CategoryChips } from '@/components/Filters/CategoryChips'
import { AgeSlider } from '@/components/Filters/AgeSlider'
import { FreeToggle } from '@/components/Filters/FreeToggle'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export function FiltersDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const reset = useFiltersStore((s) => s.reset)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Scroll affordances: track whether there's hidden content above/below so the
  // fades + the "more below" chevron only show when scrolling is actually
  // possible (an always-on fade reads as decoration and gets tuned out).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const up = el.scrollTop > 4
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 4
    setCanScrollUp((prev) => (prev === up ? prev : up))
    setCanScrollDown((prev) => (prev === down ? prev : down))
  }, [])

  // Re-measure on mount and whenever content height can change. A
  // ResizeObserver also catches font/reflow shifts.
  useEffect(() => {
    updateScroll()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateScroll)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [updateScroll])

  const scrollDown = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: el.clientHeight * 0.7, behavior: 'smooth' })
  }, [])

  // Focus the drawer on open, ESC closes it, and Tab/Shift+Tab stay inside
  // it instead of walking out to the map/detail panel behind it.
  useFocusTrap(dialogRef, true, onClose)

  const sectionLabel = 'text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5'

  return (
    <>
      {/* z-50 so the drawer sits above the z-40 detail panel / bottom sheet —
          it's a user-invoked topmost surface opened from the bar's "All filters"
          chip, which can be tapped while a detail is open. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-drawer-title"
        className="fixed z-50 bg-white dark:bg-gray-900 shadow-xl ring-1 ring-black/20 dark:ring-white/10 top-16 inset-x-3 max-h-[55dvh] rounded-2xl md:inset-x-auto md:top-16 md:right-3 md:w-96 md:max-h-[calc(100dvh-80px)] flex flex-col overflow-hidden focus:outline-none"
      >
        <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 id="filters-drawer-title" className="font-semibold text-sm md:text-base">{t('filters.drawerTitle')}</h2>
          <div className="flex gap-3 items-center">
            <button onClick={reset} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">{t('filters.reset')}</button>
            <button aria-label={t('filters.closeFilters')} onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div
          ref={scrollRef}
          onScroll={updateScroll}
          className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain"
        >
          {/* Top fade — sticky to the top of the scroll viewport; appears once
              content is scrolled up out of view. Negative margin so it overlays
              content instead of adding scroll height. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none sticky top-0 z-10 -mb-6 h-6 bg-gradient-to-b from-white dark:from-gray-900 to-transparent transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
          />
          <div className="p-3 md:p-4 pb-6 space-y-3 md:space-y-5 text-base">
            <section>
              <div className={sectionLabel}>{t('filters.sectionCategory')}</div>
              <CategoryChips />
            </section>
            <section>
              <div className={sectionLabel}>{t('filters.sectionCost')}</div>
              <FreeToggle />
            </section>
            <section>
              <div className={sectionLabel}>{t('filters.sectionAges')}</div>
              <AgeSlider />
            </section>
          </div>
          {/* Bottom overlay — sticky to the bottom of the scroll viewport. Holds
              the fade + the "more below" chevron. Negative margin neutralises its
              layout height; pointer-events-none lets touch-scroll pass through,
              with the chevron re-enabling pointer events on itself. */}
          <div className="pointer-events-none sticky bottom-0 z-10 -mt-12 h-12">
            <div
              aria-hidden="true"
              className={`absolute inset-0 bg-gradient-to-t from-white dark:from-gray-900 to-transparent transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
            />
            <button
              type="button"
              aria-label={t('filters.showMoreFilters')}
              tabIndex={canScrollDown ? 0 : -1}
              onClick={scrollDown}
              className={`absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shadow-md ring-1 ring-black/10 dark:ring-white/10 transition-opacity duration-200 ${canScrollDown ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
