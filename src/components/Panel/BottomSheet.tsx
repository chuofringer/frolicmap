import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { useDetailData } from './useDetailData'
import { reportMailto } from './detailHelpers'
import { trackGoal } from '@/utils/analytics'
import { displayTitle } from '@/utils/displayTitle'
import { PhotoCredit } from './PhotoCredit'

type Snap = 'peek' | 'half' | 'full'

const SHEET_FRACTION = 0.88 // sheet height as a fraction of the viewport

/**
 * Mobile (< md) bottom sheet — replaces the anchored MapLibre `ItemPopup` on
 * small screens. Snap points peek / half / full, dragged via the grabber with
 * plain pointer events (transform + transition, no external gesture lib). See
 * the design handoff screen 1b.
 */
export function BottomSheet() {
  const { t } = useTranslation()
  const id = useMapStore((s) => s.selectedId)
  const setId = useMapStore((s) => s.setSelectedId)
  const lastStacked = useMapStore((s) => s.lastStackedFeatures)
  const setStacked = useMapStore((s) => s.setStackedFeatures)
  const d = useDetailData(id)

  const sheetRef = useRef<HTMLDivElement>(null)
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const [safeBottom, setSafeBottom] = useState(0)
  const [snap, setSnap] = useState<Snap>('half')
  const [dragging, setDragging] = useState(false)
  const [dragTranslate, setDragTranslate] = useState<number | null>(null)
  // Same fallback as DetailPanel's: a dead/expired photo URL must collapse
  // the block, not show a broken-image icon. Resets for free — DetailOverlay
  // keys this whole component on the selected id.
  const [photoFailed, setPhotoFailed] = useState(false)
  // Ref mirror of dragTranslate: on a fast flick the final pointermove's
  // setState may not have rendered before pointerup fires, so reading the
  // state there is short by the last move delta (missed dismiss / wrong
  // snap). Same pattern as useDragToDismiss's offsetRef.
  const dragTranslateRef = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)
  const dragStart = useRef<{ y: number; translate: number } | null>(null)

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Measure the home-indicator safe-area inset once (index.html sets
  // viewport-fit=cover). Folded into the peek snap height and the action-row
  // padding so the sticky row and the peek snap both clear the indicator.
  useEffect(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;bottom:0;left:0;width:0;pointer-events:none;height:env(safe-area-inset-bottom);'
    document.body.appendChild(probe)
    const raf = requestAnimationFrame(() => { setSafeBottom(probe.offsetHeight); probe.remove() })
    return () => { cancelAnimationFrame(raf); probe.remove() }
  }, [])

  // Focus the sheet on open (a11y entry point). DetailOverlay keys this
  // component on the selected id, so a new pin remounts it — snap resets to the
  // 'half' default and copied/drag state reset — without an id-change effect.
  useEffect(() => { sheetRef.current?.focus() }, [])

  // Collapse to peek when the user starts a map gesture. At the half snap the
  // sheet owns the bottom ~52% of the screen, so a natural pinch often lands
  // one finger on the sheet and never zooms — yielding to peek returns that
  // room the moment the user shows map intent. `originalEvent` filters to
  // user-initiated camera moves; programmatic flyTo/easeTo (deep links,
  // search) must not shrink a sheet the user just opened.
  const mapRef = useMapStore((s) => s.mapInstance)
  useEffect(() => {
    if (!mapRef) return
    const map = mapRef.getMap()
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return
      setSnap('peek')
    }
    map.on('movestart', onMoveStart)
    return () => { map.off('movestart', onMoveStart) }
  }, [mapRef])

  // ESC closes the sheet.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setId(null)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [setId])

  const sheetH = Math.round(vh * SHEET_FRACTION)
  const visibleFor = useCallback((s: Snap): number => {
    // peek must fit grabber + header (~90px) plus the pinned action row
    // (~130px incl. safe-area padding) — the row counter-translates to the
    // viewport bottom at every snap, so it always occupies the lowest band.
    // Clamped below half: on short viewports (landscape phones) a fixed
    // 240px peek can exceed the vh-derived half, inverting the snap order.
    const half = Math.min(440, Math.round(vh * 0.55))
    if (s === 'peek') return Math.min(240 + safeBottom, half - 40)
    if (s === 'half') return half
    return sheetH
  }, [vh, sheetH, safeBottom])
  const translateFor = useCallback((s: Snap) => sheetH - visibleFor(s), [sheetH, visibleFor])

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = { y: e.clientY, translate: translateFor(snap) }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return
    const next = dragStart.current.translate + (e.clientY - dragStart.current.y)
    const clamped = Math.max(translateFor('full'), Math.min(sheetH - 60, next))
    dragTranslateRef.current = clamped
    setDragTranslate(clamped)
  }
  const onPointerUp = () => {
    if (!dragStart.current) return
    const current = dragTranslateRef.current ?? dragStart.current.translate
    dragStart.current = null
    dragTranslateRef.current = null
    setDragging(false)
    // Dragged well below the peek line → dismiss.
    if (current > translateFor('peek') + 80) { setId(null); return }
    // Otherwise snap to the nearest of the three points.
    const nearest = (['full', 'half', 'peek'] as Snap[])
      .reduce((best, s) =>
        Math.abs(translateFor(s) - current) < Math.abs(translateFor(best) - current) ? s : best,
      'half')
    setSnap(nearest)
    setDragTranslate(null)
  }

  if (!d) return null

  const { title, subtitle } = displayTitle(d.listItem)

  const translate = dragging && dragTranslate != null ? dragTranslate : translateFor(snap)

  const share = () => {
    trackGoal('share')
    navigator.clipboard?.writeText(d.shareUrl)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) })
      .catch(() => { /* older Safari — silent no-op */ })
  }
  const outbound = () => trackGoal('outbound_click')

  return (
    <>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        tabIndex={-1}
        style={{ height: sheetH, transform: `translateY(${translate}px)`, transition: dragging ? 'none' : 'transform 200ms ease-out' }}
        className="fixed left-0 right-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-[22px] bg-white dark:bg-gray-900 shadow-[0_-10px_40px_rgba(0,0,0,0.25)] text-gray-900 dark:text-gray-100 focus:outline-none"
      >
        {/* Grabber — drag handle */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex-shrink-0 flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
          role="separator"
          aria-label={t('detail.dragToResize')}
        >
          <span className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* paddingBottom compensates for the sheet translating DOWN at
            peek/half: the container's bottom `translate` px sit below the
            viewport and the pinned action row (~140px) overlays the visible
            bottom band, so without the padding the content tail (Source /
            Report an issue) could never be scrolled into view short of full. */}
        <div
          style={{ paddingBottom: translate > 0 ? translate + 140 : 0 }}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        >
          {lastStacked && (
            <div className="px-[18px] pt-0.5 pb-1">
              <button
                type="button"
                onClick={() => setStacked(lastStacked)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1"
              >
                <span aria-hidden>←</span>
                <span>{t('detail.backToList', { count: lastStacked.features.length })}</span>
              </button>
            </div>
          )}
          <div className="px-[18px] pt-0.5 pb-2.5 flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-0.5">
                <span aria-hidden>{d.emoji}</span> {d.categoryName}{d.distanceLabel ? ` · ${d.distanceLabel}` : ''}
              </div>
              <div>
                <h2 className="text-[18px] font-bold leading-[1.25]">{title}</h2>
                {/* English name under a Chinese title (#692) — same reasoning
                    as the desktop panel: this is where the row gets acted on. */}
                {subtitle && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 truncate">{subtitle}</p>
                )}
                {d.address && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">{d.address}</p>}
              </div>
            </div>
            <button
              type="button"
              aria-label={t('detail.close')}
              onClick={() => setId(null)}
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {d.detail?.photo_url && !photoFailed && (
            <div className="relative mx-[18px] h-[140px] flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
              <img
                src={d.detail.photo_url}
                alt=""
                loading="lazy"
                onError={() => setPhotoFailed(true)}
                className="w-full h-full object-cover"
              />
              {d.detail.photo_attribution && (
                <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] leading-tight text-white/90 bg-gradient-to-t from-black/60 to-transparent">
                  <PhotoCredit attribution={d.detail.photo_attribution} />
                </div>
              )}
            </div>
          )}

          <div className="px-[18px] py-2.5 flex flex-wrap gap-1.5">
            {d.isFree && <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.free')}</span>}
            {d.indoor === 0 && <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.outdoor')}</span>}
            {d.indoor === 1 && <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.indoor')}</span>}
            {d.ageLabel && <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{d.ageLabel}</span>}
            {d.openUntil && <span className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.openUntilChip', { time: d.openUntil })}</span>}
          </div>

          {d.description && (
            <p className="px-[18px] text-[13px] text-gray-700 dark:text-gray-300 leading-[1.5]">{d.description}</p>
          )}

          {d.hoursValue && (
            <div className="mx-[18px] mt-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-2.5 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-0.5">{t('detail.hours')}</div>
              <div className="text-xs text-gray-700 dark:text-gray-200">{d.hoursValue}</div>
            </div>
          )}

          {/* #645: places with no hours on file say so explicitly — a missing
              section reads as broken, "unknown" is honest and sends the
              parent to the website button below. */}
          {d.hoursUnknown && (
            <div className="mx-[18px] mt-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('detail.hours')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">{t('detail.hoursUnknown')}</div>
            </div>
          )}

          {d.goodToKnow.length > 0 && (
            <div className="px-[18px] mt-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{t('detail.goodToKnow')}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-gray-700 dark:text-gray-200">
                {d.goodToKnow.map((f) => (
                  <span key={f.label}><span aria-hidden className="mr-1">{f.state === 'yes' ? '✓' : '◐'}</span>{f.label}</span>
                ))}
              </div>
            </div>
          )}

          {d.detailFailed && (
            <p className="px-[18px] mt-2.5 text-xs text-gray-400 dark:text-gray-500 italic">
              {d.detailRetryable ? t('detail.detailsLoadFailed') : t('detail.detailsUnavailable')}
              {d.detailRetryable && (
                <button
                  type="button"
                  onClick={d.retryDetail}
                  disabled={d.detailRetrying}
                  aria-busy={d.detailRetrying}
                  className="ml-1.5 not-italic font-semibold underline text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-wait"
                >
                  {t('detail.tryAgain')}
                </button>
              )}
            </p>
          )}

          {/* Source attribution + Report path (parity with the desktop panel;
              Report is always reachable even when there's no source line). */}
          <div className="px-[18px] mt-3 text-[11px] text-gray-400 dark:text-gray-500">
            {d.sourceUrl && d.sourceHost && (
              <>
                {t('detail.source')} <a href={d.sourceUrl} target="_blank" rel="noreferrer" onClick={outbound} className="text-amber-600 dark:text-amber-400">{d.sourceHost}</a>
                {d.lastVerified && <> · {t('detail.verified', { date: d.lastVerified.slice(0, 10) })}</>}
                {' · '}
              </>
            )}
            <a href={reportMailto(d.id, d.listItem.name, d.shareUrl)} className="text-amber-600 dark:text-amber-400">{t('detail.reportAnIssue')}</a>
          </div>

          <div className="h-2" />
        </div>

        {/* Sticky action row — two map buttons + Website/Share (parity with the
            desktop footer). The sheet snaps by translating DOWN (its height is
            constant), so this row sits below the viewport at peek/half unless
            it counter-translates by the sheet's own offset — that keeps the
            maps buttons pinned to the visible bottom edge at every snap. Needs
            an opaque bg since it overlays scrolling content at lower snaps.
            Bottom padding clears the home-indicator inset. */}
        <div
          style={{ transform: `translateY(${-translate}px)`, transition: dragging ? 'none' : 'transform 200ms ease-out' }}
          className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-[18px] pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col gap-2 relative"
        >
          <div className="flex gap-2">
            <a
              href={d.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={outbound}
              className="flex-1 text-center bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-3 rounded-xl shadow-[0_4px_12px_rgba(245,158,11,0.35)]"
            >
              {t('detail.googleMaps')}
            </a>
            <a
              href={d.appleMapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={outbound}
              className="flex-1 text-center bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-sm font-semibold py-3 rounded-xl"
            >
              {t('detail.appleMaps')}
            </a>
          </div>
          <div className="flex gap-2">
            {d.website && (
              <a href={d.website} target="_blank" rel="noreferrer" onClick={outbound} className="flex-1 text-center bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold py-3 rounded-xl">{t('detail.website')}</a>
            )}
            <button type="button" onClick={share} className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold py-3 rounded-xl">{t('detail.share')}</button>
          </div>

          {copied && (
            <div role="status" className="absolute -top-7 right-[18px] bg-gray-900 dark:bg-gray-700 text-white text-xs px-2.5 py-1 rounded-md shadow-lg">{t('detail.copied')}</div>
          )}
        </div>
      </div>
    </>
  )
}
