import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Category } from '@shared/types'
import { CATEGORIES, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useItems } from '@/hooks/useItems'
import { matchesActivity } from '@/utils/searchMatch'
import { useGeocodeQuery } from '@/hooks/useGeocode'
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery'
import { useActiveFilterCount } from '@/hooks/useActiveFilterCount'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { trackGoal } from '@/utils/analytics'
import { openItemDetail } from '@/utils/openItem'
import { inlineTitle, titleHaystack } from '@/utils/displayTitle'
import { FiltersDrawer } from '@/components/Layout/FiltersDrawer'
import { ViewToggle } from './ViewToggle'
import { useCategoryChipState } from '@/components/Filters/useCategoryChipState'
import { ComingSoonChip } from '@/components/Filters/ComingSoonChip'

// Desktop inline chips — exactly FOUR (revision 3, item 2). Every other category
// lives in the All-filters drawer + the legend. Labels come from the legend
// vocabulary (categoryLabel).
const INLINE_CATEGORIES: Category[] = ['playground', 'park', 'museum', 'library']

const NEARBY_RADIUS_MILES = 10
// Obstacles the centered pill must clear. The brand column ends ~208px from
// the left. The top-right icon row (3 × 44px buttons + 2 × 8px gaps + the
// right-3 margin) overlays at z-50 and ends ~160px from the right — 220 leaves
// breathing room; when a detail panel is open the row shifts a further 392px
// left (panel 380 + margins), so the clearance grows to 612.
const BRAND_CLEARANCE = 208
const ICON_ROW_CLEARANCE = 220
const PANEL_SHIFT = 392
// Below these widths the full pill (~680px natural, search shrinks to ~150px
// minimum) can't fit between the clearances, so we drop to the compact
// stacked layout instead of sliding under the icon row.
// With a panel: 208 + pill + 220 + 392. Without: 208 + pill + 220.
const DESKTOP_PANEL_FIT = '(min-width: 1400px)'
const DESKTOP_BAR_FIT = '(min-width: 1024px)'

// Definite edges + elevation so the floating controls read as controls against
// the light basemap (revision 2, item 1).
const PILL_SURFACE = 'bg-white dark:bg-gray-900 shadow-xl ring-1 ring-black/15 dark:ring-white/25'

// ── Search (item matches + Nominatim geocode) ─────────────────────────────────
// The dropdown opens downward from the top-bar placements; `dropUp` flips it
// for the mobile bottom overlay, where a downward dropdown starts ~84px above
// the viewport bottom and disappears under the on-screen keyboard (the input
// autofocuses there, so the keyboard is always up).
function SearchField({ desktop, autoFocus, dropUp, onCollapse }: { desktop: boolean; autoFocus?: boolean; dropUp?: boolean; onCollapse?: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  // -1 = no option active (combobox pattern: aria-activedescendant tracks the
  // active row within the input's own focus, not DOM focus). Resets whenever
  // the query changes so a stale index never survives into a new result set.
  const [activeIndex, setActiveIndex] = useState(-1)
  const { data: itemsData } = useItems()
  // The address (Nominatim) lookup runs only for a query the user SUBMITTED
  // with Enter: the public Nominatim policy forbids auto-complete, so the live
  // text never reaches it. Place/activity matching below stays live per key.
  const [submittedQ, setSubmittedQ] = useState('')
  const { data: geo } = useGeocodeQuery(submittedQ)
  const { setFlyTo, setSearchMarker } = useMapStore()
  const setNearby = useFiltersStore((s) => s.setNearby)
  const listboxId = useId()
  const optionId = (idx: number) => `${listboxId}-option-${idx}`
  const listRef = useRef<HTMLDivElement>(null)

  const items = itemsData?.items ?? []
  // Places: name-substring match, as before — but across BOTH titles (#692).
  // A bilingual reader types whichever name comes to mind, and the English one
  // is what's printed on the building, so matching only the displayed string
  // would make a venue findable in one language and invisible in the other.
  const itemMatches = items
    .filter((i) => q.length >= 2 && titleHaystack(i).some((n) => n.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 4)
  const itemMatchIds = new Set(itemMatches.map((i) => i.id))
  // Activities (issue #212): category/type/synonym keyword matches — "trampoline",
  // "storytime", "free indoor" — for items that didn't already surface as a
  // Place (a literal name hit). Fuzzy matching stays over the already-loaded
  // `ListItem` fields only (no `description` — it isn't in this payload).
  const activityMatches = items
    .filter((i) => q.length >= 2 && !itemMatchIds.has(i.id) && matchesActivity(i, q, categoryLabel))
    .slice(0, 3)
  // Address results belong to the submitted text; once the user edits the
  // field they no longer describe it, so hide them until Enter is pressed again.
  const geoMatches = submittedQ === q.trim() ? (geo ?? []).slice(0, 3) : []
  // One flat navigable list in visual order — Activities, then Places, then
  // Addresses — the combobox pattern moves aria-activedescendant through all
  // three groups as a single sequence. Group headers below are NOT options
  // and don't enter this count.
  const optionCount = activityMatches.length + itemMatches.length + geoMatches.length
  const showDropdown = open && q.length >= 2 && optionCount > 0

  // Primitive deps only — itemsData/geo are new object references on every
  // fetch (even unchanged data), which would reset the active option on
  // every render and fight the arrow-key handler.
  useEffect(() => { setActiveIndex(-1) }, [q, activityMatches.length, itemMatches.length, geoMatches.length])

  const selectItem = (i: (typeof itemMatches)[number]) => {
    setFlyTo({ longitude: i.lng, latitude: i.lat, zoom: 15 })
    openItemDetail(i)
    setSearchMarker(null)
    setOpen(false)
    onCollapse?.()
  }
  const selectGeo = (g: NonNullable<typeof geo>[number]) => {
    setFlyTo({ longitude: g.lng, latitude: g.lat, zoom: 14 })
    setSearchMarker([g.lng, g.lat])
    setNearby(null)
    setOpen(false)
    onCollapse?.()
  }
  // Flat index order matches render order: Activities, then Places, then
  // Addresses — see `optionCount` above.
  const selectIndex = (idx: number) => {
    if (idx < activityMatches.length) { selectItem(activityMatches[idx]); return }
    idx -= activityMatches.length
    if (idx < itemMatches.length) { selectItem(itemMatches[idx]); return }
    idx -= itemMatches.length
    const g = geoMatches[idx]
    if (g) selectGeo(g)
  }

  useEffect(() => {
    if (activeIndex < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`)
    el?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // During IME composition (Chinese/Japanese input) the arrow/Enter keys
    // drive the candidate window — intercepting them would fight the IME
    // (Enter meant to commit the composition would select a suggestion).
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { setOpen(false); onCollapse?.(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (optionCount === 0) return
      setActiveIndex((prev) => (prev + 1) % optionCount)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open || optionCount === 0) return
      // APG: ArrowUp with no active option lands on the LAST option.
      setActiveIndex((prev) => (prev < 0 ? optionCount - 1 : (prev - 1 + optionCount) % optionCount))
      return
    }
    if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < optionCount) {
        e.preventDefault()
        selectIndex(activeIndex)
        return
      }
      // No option highlighted: Enter is the explicit "search this address"
      // action (too-short text is ignored by the geocode hook's min length).
      e.preventDefault()
      setSubmittedQ(q.trim())
      setOpen(true)
    }
  }

  return (
    <div className="relative flex-1 min-w-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <svg className="w-[17px] h-[17px] flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          // Intentional autofocus: the mobile search expands on demand, so the
          // input should take focus immediately when it mounts.
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && activeIndex < optionCount ? optionId(activeIndex) : undefined}
          className={`min-w-0 flex-1 bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 ${desktop ? 'text-sm w-[290px]' : 'text-base'}`}
          enterKeyHint="search"
          placeholder={t('bar.searchPlaceholder')}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); onCollapse?.() }, 150)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showDropdown && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('bar.searchResults')}
          className={`absolute left-0 w-72 max-w-[calc(100vw-40px)] bg-white dark:bg-gray-900 rounded-xl shadow-lg ring-1 ring-black/20 dark:ring-white/10 max-h-72 overflow-auto text-sm z-10 ${dropUp ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {activityMatches.length > 0 && (
            <div aria-hidden className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('bar.searchGroupActivities')}
            </div>
          )}
          {activityMatches.map((i, aIdx) => (
            <button
              key={i.id}
              id={optionId(aIdx)}
              role="option"
              aria-selected={aIdx === activeIndex}
              className={`block w-full text-left px-3 py-2 text-gray-900 dark:text-gray-100 ${aIdx === activeIndex ? 'bg-gray-50 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              onMouseDown={() => selectItem(i)}
            >{getCategoryEmoji(i.category)} {inlineTitle(i)}</button>
          ))}
          {itemMatches.length > 0 && (
            <div aria-hidden className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('bar.searchGroupPlaces')}
            </div>
          )}
          {itemMatches.map((i, iIdx) => {
            const idx = activityMatches.length + iIdx
            return (
              <button
                key={i.id}
                id={optionId(idx)}
                role="option"
                aria-selected={idx === activeIndex}
                className={`block w-full text-left px-3 py-2 text-gray-900 dark:text-gray-100 ${idx === activeIndex ? 'bg-gray-50 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                onMouseDown={() => selectItem(i)}
              >📍 {inlineTitle(i)}</button>
            )
          })}
          {geoMatches.length > 0 && (
            <div aria-hidden className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('bar.searchGroupAddresses')}
            </div>
          )}
          {geoMatches.map((g, gIdx) => {
            const idx = activityMatches.length + itemMatches.length + gIdx
            return (
              <button
                key={gIdx}
                id={optionId(idx)}
                role="option"
                aria-selected={idx === activeIndex}
                className={`block w-full text-left px-3 py-2 text-gray-700 dark:text-gray-200 ${idx === activeIndex ? 'bg-gray-50 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                onMouseDown={() => selectGeo(g)}
              >🏠 {g.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Near me (absorbs NearbyBox, incl. its error surfacing) ───────────────────
function NearMeButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const nearbyCenter = useFiltersStore((s) => s.nearbyCenter)
  const setNearby = useFiltersStore((s) => s.setNearby)
  const setFlyTo = useMapStore((s) => s.setFlyTo)
  const setSearchMarker = useMapStore((s) => s.setSearchMarker)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The mobile bar unmounts whenever a detail opens or the view switches to
  // list, so the 3s error timer and the async geolocation callbacks can
  // outlive the component — clear the timer and drop late callbacks.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (errorTimer.current) clearTimeout(errorTimer.current)
    }
  }, [])
  const active = nearbyCenter !== null

  const flashError = (msg: string) => {
    setError(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 3000)
  }

  const onClick = () => {
    if (active) { setNearby(null); return }
    // Parity with the retired NearbyBox: surface the failure instead of
    // silently flipping the label back (reads as "the button is broken",
    // especially on iOS where a denied permission errors instantly).
    if (!navigator.geolocation) { flashError(t('bar.geolocationNotSupported')); return }
    setBusy(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const center: [number, number] = [pos.coords.longitude, pos.coords.latitude]
        // Store + map updates are safe (and wanted) even if the button
        // unmounted while the position lookup ran; only local state is gated.
        setNearby(center, NEARBY_RADIUS_MILES)
        setSearchMarker(null)
        setFlyTo({ longitude: center[0], latitude: center[1], zoom: 11 })
        if (alive.current) setBusy(false)
        trackGoal('near_me')
      },
      (err) => {
        if (!alive.current) return
        setBusy(false)
        flashError(err.code === 1 ? t('bar.permissionDenied') : t('bar.couldNotGetLocation'))
      },
      { timeout: 8000, enableHighAccuracy: false },
    )
  }

  const label = busy ? t('bar.locating') : error ? error : t('bar.nearMe')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={t('bar.nearMe')}
      className={`flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap px-2 py-1 rounded-full transition-colors flex-shrink-0 ${error ? 'text-red-600 dark:text-red-400' : active ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white'}`}
    >
      <svg className="w-[15px] h-[15px] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
      {/* aria-live announces the transient error; the label hides only in the
          desktop-narrow compact stacked layout (where space is tight). */}
      <span aria-live="polite" className={compact && !error ? 'sr-only' : ''}>
        {label}{active && !error && !busy ? ' ✓' : ''}
      </span>
    </button>
  )
}

// Exported so the mobile list panel header (issue #483) can offer the same
// entry point — the bottom bar hides while the list owns the screen.
export function FiltersButton({ onOpenFilters, filterCount }: { onOpenFilters: () => void; filterCount: number }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
     
      onClick={onOpenFilters}
      aria-label={t('bar.allFilters')}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold text-gray-700 dark:text-gray-200 flex-shrink-0"
    >
      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M10 18h4" /></svg>
      {t('bar.filters')}
      {filterCount > 0 && (
        <span className="rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">{filterCount}</span>
      )}
    </button>
  )
}

// ── Desktop category chip row + Free-only + All filters ──────────────────────
function ChipRow({ onOpenFilters, filterCount }: { onOpenFilters: () => void; filterCount: number }) {
  const { t } = useTranslation()
  const chip = useCategoryChipState()
  const freeOnly = useFiltersStore((s) => s.freeOnly)
  const setFreeOnly = useFiltersStore((s) => s.setFreeOnly)

  return (
    <>
      {INLINE_CATEGORIES.map((cat) => {
        const meta = CATEGORIES[cat]
        const c = chip.chipFor(cat)
        return (
          <button
            key={cat}
            type="button"
            onClick={c.activate}
            aria-pressed={c.on}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 dark:border-white/25 px-3 py-1.5 text-xs font-semibold transition-colors flex-shrink-0 ${c.on ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100' : 'bg-white/95 dark:bg-gray-800/95 text-gray-600 dark:text-gray-300 shadow-sm'}`}
            style={c.on ? { boxShadow: `0 1px 3px rgba(0,0,0,0.12), inset 0 -3px 0 ${meta.color}` } : undefined}
          >
            <span aria-hidden>{getCategoryEmoji(cat)}</span>
            {categoryLabel(cat)}
          </button>
        )
      })}

      <ComingSoonChip variant="inline" />

      {freeOnly && (
        <button
          type="button"
          onClick={() => setFreeOnly(false)}
          aria-pressed
          className="flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 shadow-sm flex-shrink-0"
        >
          {t('bar.freeOnlyActive')}
        </button>
      )}

      <button
        type="button"
       
        onClick={onOpenFilters}
        aria-label={t('bar.allFilters')}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 dark:border-white/25 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-sm flex-shrink-0"
      >
        {t('bar.allFilters')}
        {filterCount > 0 && (
          <span className="rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">{filterCount}</span>
        )}
      </button>
    </>
  )
}

// ── Mobile bottom control bar (revision 3, item 3c — thumb zone) ─────────────
// [🔍 search][📍 Near me labeled][Map | List][Filters (N)]. Fixed bottom-center
// above the safe-area inset; the search icon expands an overlay input above the
// bar. No category chips (item 3b — the legend covers categories); filtering is
// in the drawer. Only rendered when neither the detail sheet nor the list panel
// owns the screen (see the caller).
function MobileBottomBar({ onOpenFilters, filterCount }: { onOpenFilters: () => void; filterCount: number }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      {expanded && (
        <div className={`md:hidden fixed left-3 right-3 bottom-[76px] z-30 flex items-center gap-2 h-12 rounded-full ${PILL_SURFACE} px-4`}>
          <SearchField desktop={false} autoFocus dropUp onCollapse={() => setExpanded(false)} />
          <button
            type="button"
            aria-label={t('bar.closeSearch')}
            onClick={() => setExpanded(false)}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      {/* A full-width centering track, with the pill hugging its content
          inside it. The pill used to position itself with `left-1/2
          -translate-x-1/2`, which caps a shrink-to-fit box's available width
          at 50vw during layout — `max-w` cannot expand it past that, so wide
          content overflowed instead of using the room it appeared to have.
          Latin labels stayed under the cap; two-character CJK labels (附近 /
          地图 / 列表 / 筛选) did not, and clipped "筛选" at 375px. */}
      <div className="md:hidden fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex justify-center pointer-events-none">
      <div className={`flex items-center gap-1 h-12 max-w-full rounded-full ${PILL_SURFACE} px-2 pointer-events-auto`}>
        <button
          type="button"
          aria-label={t('bar.search')}
          onClick={() => setExpanded(true)}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </button>
        <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
        <NearMeButton />
        <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
        <ViewToggle compact />
        <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
        <FiltersButton onOpenFilters={onOpenFilters} filterCount={filterCount} />
      </div>
      </div>
    </>
  )
}

/**
 * Consolidated search & filter bar.
 * - **Desktop**: top-center pill (search + Near me + Map/List) with a 4-chip row
 *   below; centered between the brand column and the top-right icon row (plus
 *   an open detail panel, which also shifts the icon row left); drops to a
 *   compact stacked layout when the pill can't fit between those obstacles
 *   (below 1440px with a panel open, below 1024px without).
 * - **Mobile**: a bottom control bar in the thumb zone (search icon, labeled Near
 *   me, Map/List, Filters) — no top chip row. It hides while the detail sheet or
 *   the list panel owns the screen.
 */
export function SearchFilterBar() {
  const isDesktop = useIsDesktop()
  const roomForPill = useMediaQuery(DESKTOP_PANEL_FIT)
  const roomForBar = useMediaQuery(DESKTOP_BAR_FIT)
  const detailOpen = useMapStore((s) => s.selectedId !== null)
  const viewMode = useMapStore((s) => s.viewMode)
  const overlay = useMapStore((s) => s.overlay)
  const openOverlay = useMapStore((s) => s.openOverlay)
  const closeOverlay = useMapStore((s) => s.closeOverlay)

  // "All filters (N)" counts the active drawer-scoped facets. freeOnly is
  // counted here AND rendered as its own "Free only ✓" chip — free is
  // deliberately double-signalled (the shipped decision).
  const filterCount = useActiveFilterCount()

  const openFilters = () => openOverlay('filters')
  const drawer = overlay === 'filters' && <FiltersDrawer onClose={() => closeOverlay('filters')} />

  if (!isDesktop) {
    // The bottom bar yields the screen to the detail sheet / list panel
    // (any non-map view owns the screen on mobile).
    const barHidden = detailOpen || viewMode !== 'map'
    return (
      <>
        {!barHidden && <MobileBottomBar onOpenFilters={openFilters} filterCount={filterCount} />}
        {drawer}
      </>
    )
  }

  // Desktop too narrow for the centered pill (the fit threshold depends on
  // whether a detail panel + the shifted icon row eat into the width) →
  // compact stacked layout below the brand column and clear of the panel.
  if (detailOpen ? !roomForPill : !roomForBar) {
    return (
      <>
        <div className={`absolute top-[116px] left-3 z-30 flex flex-col gap-2 ${detailOpen ? 'right-[396px]' : 'right-3'}`}>
          <div className={`flex items-center gap-2 h-[46px] rounded-full ${PILL_SURFACE} px-3.5`}>
            <SearchField desktop={false} />
            <NearMeButton compact />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <ViewToggle compact />
            <ChipRow onOpenFilters={openFilters} filterCount={filterCount} />
          </div>
        </div>
        {drawer}
      </>
    )
  }

  return (
    <>
      <div
        className="absolute top-3 z-30 flex flex-col items-center gap-2 pointer-events-none"
        style={{ left: BRAND_CLEARANCE, right: ICON_ROW_CLEARANCE + (detailOpen ? PANEL_SHIFT : 0) }}
      >
        <div className={`pointer-events-auto flex items-center h-[50px] max-w-full rounded-full ${PILL_SURFACE} pl-[18px] pr-1.5 gap-3`}>
          <SearchField desktop />
          <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
          <NearMeButton />
          <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
          <ViewToggle />
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5 max-w-full overflow-x-auto no-scrollbar">
          <ChipRow onOpenFilters={openFilters} filterCount={filterCount} />
        </div>
      </div>
      {drawer}
    </>
  )
}
