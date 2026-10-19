import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListItem } from '@shared/types'
import { CATEGORIES, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useItems } from '@/hooks/useItems'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMapStore } from '@/stores/useMapStore'
import { useDistanceOrigin } from '@/hooks/useDistanceOrigin'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useDragToDismiss } from '@/hooks/useDragToDismiss'
import { useActiveFilterCount } from '@/hooks/useActiveFilterCount'
import { applyFilters } from '@/utils/filters'
import { haversineMiles } from '@/utils/distance'
import { cityLabel } from '@/utils/place'
import { displayTitle } from '@/utils/displayTitle'
import { openItemDetail } from '@/utils/openItem'
import { ViewToggle } from '@/components/Bar/ViewToggle'
import { FiltersButton } from '@/components/Bar/SearchFilterBar'
import { DistanceOriginNote } from '@/components/Distance/DistanceOriginNote'

interface Row { item: ListItem; distanceMi: number }

// Cap the number of DOM cards. Without it the Bay-with-no-filters set (~5,500
// rows) mounts thousands of card buttons — a real jank/memory cost. Rows are
// distance-sorted, so the nearest 150 are the useful ones; the header keeps the
// TOTAL and a footer names the cap (no silent truncation). Zoom/filter narrows.
const LIST_CAP = 150

function ListCard({ row, selected, onClick }: {
  row: Row
  selected: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const { item, distanceMi } = row
  const meta = CATEGORIES[item.category]
  const city = cityLabel(item)
  const { title, subtitle } = displayTitle(item)
  const chips: { label: string; cls: string }[] = []
  if (item.cost === 'free') chips.push({ label: t('common.free'), cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' })
  else if (item.cost === 'paid') chips.push({ label: t('list.paid'), cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' })
  if (item.indoor === 1) chips.push({ label: t('list.indoor'), cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' })
  else if (item.indoor === 0) chips.push({ label: t('list.outdoor'), cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' })

  return (
    <button
      type="button"
      data-item-id={item.id}
      onClick={onClick}
      className={`w-full text-left flex gap-3 p-2.5 rounded-xl border transition-colors ${
        selected
          ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-600'
          : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      {/* Photos don't exist in the product yet — use the legend/pin presentation:
          a 40px category-color circle + emoji (CATEGORY_COLOR via meta.color). */}
      <div
        className="w-10 h-10 flex-shrink-0 self-center rounded-full flex items-center justify-center text-[15px] ring-2 ring-white dark:ring-gray-900 shadow-sm"
        style={{ backgroundColor: meta.color }}
        aria-hidden
      >
        {getCategoryEmoji(item.category)}
      </div>
      <div className="min-w-0 flex flex-col justify-center gap-0.5">
        <div className="text-sm font-bold truncate text-gray-900 dark:text-gray-100">
          {title}
        </div>
        {/* English name under a Chinese title (#692) — this is the browse
            surface, so it carries the pairing: recognising the name you know
            is most of what scanning a list is for. Null in English. */}
        {subtitle && (
          <div className="text-[11px] truncate text-gray-400 dark:text-gray-500">{subtitle}</div>
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {city
            ? t('list.categoryCityDistance', { category: categoryLabel(item.category), city, distance: distanceMi.toFixed(1) })
            : t('list.categoryDistance', { category: categoryLabel(item.category), distance: distanceMi.toFixed(1) })}
        </div>
        {chips.length > 0 && (
          <div className="flex gap-1.5">
            {chips.map((c) => (
              <span key={c.label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

/**
 * List view (design handoff screen 1c). A left panel of distance-sorted result
 * cards, synced with the map pins: clicking a card selects the item (opens the
 * detail panel); a pin click scrolls the list to its card (scrollTop math, not
 * scrollIntoView). Renders only in list view. Desktop is a 400px left panel.
 *
 * Mobile (visual-pass revision 2): the panel is swipe-down-dismissable (grabber
 * → useDragToDismiss → back to map view), and it hides while a card selection
 * is open so the map + selected pin + bottom sheet aren't crowded under it — the
 * list returns when the sheet closes. viewMode stays 'list' throughout.
 */
export function ListPanel() {
  const { t } = useTranslation()
  const viewMode = useMapStore((s) => s.viewMode)
  const setViewMode = useMapStore((s) => s.setViewMode)
  const selectedId = useMapStore((s) => s.selectedId)
  const openOverlay = useMapStore((s) => s.openOverlay)
  const { data } = useItems()
  const filters = useFiltersStore()
  const filterCount = useActiveFilterCount()
  const origin = useDistanceOrigin()
  const isDesktop = useIsDesktop()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Set true the moment a LIST card is clicked, so the scroll-to-selected
  // effect below skips that selection (the card is already under the pointer —
  // yanking it to the top would jump the list). Only MAP/URL-originated
  // selections scroll the list.
  const fromCardClick = useRef(false)
  const { offset, dragging, grabberProps } = useDragToDismiss(() => setViewMode('map'))

  const rows = useMemo(() => {
    const visible = applyFilters(data?.items ?? [], filters)
    const withDist: Row[] = visible.map((item) => ({
      item,
      distanceMi: haversineMiles(origin, [item.lng, item.lat]),
    }))
    withDist.sort((a, b) => a.distanceMi - b.distanceMi)
    return withDist
  }, [data, filters, origin])

  // Map/URL selection → scroll the list to the matching card via scrollTop
  // math (not scrollIntoView). Card clicks set fromCardClick so we skip them.
  // A map-selected item can fall OUTSIDE the rendered LIST_CAP cards, so the
  // card may not exist — the `if (card)` guard makes that a no-op (no scroll,
  // no crash) rather than assuming a match.
  useEffect(() => {
    if (viewMode !== 'list' || !selectedId) return
    if (fromCardClick.current) { fromCardClick.current = false; return }
    const container = scrollRef.current
    if (!container) return
    const card = container.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(selectedId)}"]`)
    if (card) container.scrollTop = card.offsetTop - 8
  }, [selectedId, viewMode])

  if (viewMode !== 'list') return null
  // Mobile: hide the list while a card selection is open (map + pin + sheet).
  // CSS-hide rather than unmount — unmounting resets scrollTop to 0, so
  // closing the sheet dropped the user back at the top of the list after
  // every single card they checked.
  const mobileHidden = !isDesktop && selectedId !== null

  return (
    // Mobile: full-width below the top-left brand/metro column (the search bar
    // now lives at the BOTTOM, and it hides in list view), so the list can start
    // near the top at top-[112px]; on md+ it's the 400px left panel at top-126.
    <div
      aria-hidden={mobileHidden || undefined}
      style={{ transform: offset ? `translateY(${offset}px)` : undefined, transition: dragging ? 'none' : 'transform 200ms ease-out' }}
      className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.22)] ring-1 ring-black/15 dark:ring-white/20 top-[112px] left-3 right-3 bottom-3 md:top-[126px] md:right-auto md:w-[400px] ${mobileHidden ? 'invisible pointer-events-none' : ''}`}
    >
      {/* Mobile grabber — swipe down past the threshold returns to map view. */}
      <div
        {...grabberProps}
        className="md:hidden flex-shrink-0 flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
        role="separator"
        aria-label={t('list.dragToReturnToMap')}
      >
        <span className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
      </div>

      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100 min-w-0 truncate">{t('list.placesNearYou', { count: rows.length })}</span>
        {/* Mobile-only: the bottom control bar (with its Map/List toggle and
            Filters button) hides while the list panel owns the screen (#483),
            so both live here too — same ViewToggle, same overlay coordinator. */}
        <div className="md:hidden flex-shrink-0 flex items-center gap-1">
          <ViewToggle compact />
          <FiltersButton onOpenFilters={() => openOverlay('filters')} filterCount={filterCount} />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{t('list.sortedByDistance')}</span>
      </div>

      {/* "Sorted by distance" above is only half the sentence — this names the
          point the sort and every card's mileage are measured from. */}
      <DistanceOriginNote />

      <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 flex flex-col gap-2">
        {rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 p-4 text-center">{t('list.noMatches')}</p>
        )}
        {rows.slice(0, LIST_CAP).map((row) => (
          <ListCard
            key={row.item.id}
            row={row}
            selected={row.item.id === selectedId}
            onClick={() => {
              fromCardClick.current = true
              openItemDetail(row.item)
            }}
          />
        ))}
        {rows.length > LIST_CAP && (
          <p className="text-[13px] text-gray-500 dark:text-gray-400 py-3 text-center">
            {t('list.showingNearest', { cap: LIST_CAP, total: rows.length })}
          </p>
        )}
      </div>
    </div>
  )
}
