import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { useDetailData } from './useDetailData'
import { ReportModal } from './ReportModal'
import { UpickSeasonStrip } from './UpickSeasonStrip'
import { SiblingDatesStrip } from './SiblingDatesStrip'
import { EventUnlockCard } from './EventUnlockCard'
import { ItemPopupSignupCTA } from './ItemPopupSignupCTA'
import { trackGoal, trackOutboundClick } from '@/utils/analytics'
import { displayTitle } from '@/utils/displayTitle'

/**
 * Desktop (md:+) detail side panel — replaces the anchored MapLibre
 * `ItemPopup` render. Fixed top-3 right-3 bottom-3 w-[380px] overlay with a
 * photo header (or a compact badge row when no photo), scrollable content, and
 * a sticky footer whose single primary action is Directions. See the design
 * handoff screen 1a.
 */
export function DetailPanel() {
  const { t } = useTranslation()
  const id = useMapStore((s) => s.selectedId)
  const setId = useMapStore((s) => s.setSelectedId)
  const lastStacked = useMapStore((s) => s.lastStackedFeatures)
  const setStacked = useMapStore((s) => s.setStackedFeatures)
  const d = useDetailData(id)

  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [copied, setCopied] = useState(false)
  // A dead/expired external photo URL (Commons churn, a curator paste typo)
  // must fall back to the no-photo compact layout, never a browser's broken-
  // image icon inside a 200px header. Resets for free on a sibling switch —
  // DetailOverlay keys this whole component on the selected id.
  const [photoFailed, setPhotoFailed] = useState(false)

  // Slide-in: mount hidden (translateX 24px + fade), then reveal on the next
  // frame so the transition runs (200ms ease-out).
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(r)
  }, [])

  // Move focus to the panel on open (a11y entry point) — mirrors MetroPicker.
  // DetailOverlay keys this component on the selected id, so a sibling switch
  // remounts it and resets scroll/menu/copied without an id-change effect.
  useEffect(() => { panelRef.current?.focus() }, [])

  // ESC closes the Report modal first (so a half-typed note isn't discarded —
  // ReportModal has no keydown of its own), then the panel itself.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showReport) { setShowReport(false); return }
      setId(null)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [showReport, setId])

  if (!d) return null

  const { title, subtitle } = displayTitle(d.listItem)

  const share = () => {
    trackGoal('share', d.id)
    navigator.clipboard?.writeText(d.shareUrl)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) })
      .catch(() => { /* older Safari — silent no-op */ })
  }

  const outbound = (url: string) => { trackGoal('outbound_click'); trackOutboundClick(d.id, url) }

  const badge = (
    <span className="inline-flex items-center gap-1 bg-white/95 dark:bg-gray-900/95 text-amber-800 dark:text-amber-300 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm">
      <span aria-hidden>{d.emoji}</span>
      <span>{d.categoryName}</span>
    </span>
  )

  const closeBtn = (
    <button
      type="button"
      aria-label={t('detail.close')}
      onClick={() => setId(null)}
      className="w-[30px] h-[30px] flex-shrink-0 flex items-center justify-center rounded-full bg-white/95 dark:bg-gray-800/95 text-gray-600 dark:text-gray-300 shadow-sm hover:bg-white dark:hover:bg-gray-700 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
  )

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={d.gated ? 'Event — sign in to unlock' : title}
        tabIndex={-1}
        className={`fixed top-3 right-3 bottom-3 w-[380px] max-w-[calc(100vw-24px)] z-40 flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.24)] ring-1 ring-black/10 dark:ring-white/10 text-gray-900 dark:text-gray-100 transition-[transform,opacity] duration-200 ease-out focus:outline-none ${shown ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
      >
        {/* Photo header (200px) only when a photo exists; otherwise a compact
            44px badge + close row — no empty placeholder in production. */}
        {d.detail?.photo_url && !photoFailed ? (
          <div className="relative h-[200px] flex-shrink-0 bg-gray-100 dark:bg-gray-800">
            <img
              src={d.detail.photo_url}
              alt=""
              loading="lazy"
              onError={() => setPhotoFailed(true)}
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2.5 left-2.5">{badge}</div>
            <div className="absolute top-2 right-2">{closeBtn}</div>
            {d.detail.photo_attribution && (
              <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] leading-tight text-white/90 bg-gradient-to-t from-black/60 to-transparent">
                {t('detail.photoAttribution', { attribution: d.detail.photo_attribution })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-shrink-0 h-11 px-3 flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800">
            {badge}
            {closeBtn}
          </div>
        )}

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[18px] pt-4 pb-4 flex flex-col gap-2.5">
          {lastStacked && (
            <button
              type="button"
              onClick={() => setStacked(lastStacked)}
              className="self-start flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1"
            >
              <span aria-hidden>←</span>
              <span>{t('detail.backToList', { count: lastStacked.features.length })}</span>
            </button>
          )}

          {/* Gated events blur the identifying teaser (title, badges, WHEN —
              operator call 2026-07-26): the pin's category said "event",
              the specifics are what sign-in unlocks. CSS-only blur —
              presentational; the curated fields are withheld server-side. */}
          <div className={d.gated ? 'blur-[6px] select-none pointer-events-none' : ''} aria-hidden={d.gated || undefined}>
            <h2 className="text-[19px] font-bold leading-[1.25]">{title}</h2>
            {/* English name under a Chinese title (#692). This panel is where a
                parent acts on the row — directions, website, telling someone
                where they're going — so it is the surface that most needs the
                name actually printed on the building. Null in English. */}
            {subtitle && (
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>
            )}
            {(d.address || d.distanceLabel) && (
              // The address truncates; the distance does NOT. They used to
              // share one `truncate` line, which clipped the distance first on
              // narrow screens — losing the exact label this panel states so
              // the mileage can be read at all.
              <p className="mt-1 flex items-baseline gap-1 text-xs text-gray-500 dark:text-gray-400">
                {d.address && <span className="truncate">{d.address}</span>}
                {d.address && d.distanceLabel && <span aria-hidden>·</span>}
                {d.distanceLabel && <span className="flex-shrink-0">{d.distanceLabel}</span>}
              </p>
            )}
          </div>

          <div className={`flex flex-wrap gap-1.5 ${d.gated ? 'blur-[6px] select-none pointer-events-none' : ''}`} aria-hidden={d.gated || undefined}>
            {d.isFree && <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.free')}</span>}
            {d.indoor === 0 && <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.outdoor')}</span>}
            {d.indoor === 1 && <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{t('detail.indoor')}</span>}
            {!d.isFree && d.priceUsd != null && <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">${d.priceUsd.toFixed(0)}</span>}
            {d.ageLabel && <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[11px] font-semibold px-2 py-0.5 rounded-md">{d.ageLabel}</span>}
          </div>

          {d.description && (
            <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-[1.5]">{d.description}</p>
          )}

          {d.isUpick && <UpickSeasonStrip listItem={d.listItem} detail={d.detail ?? undefined} />}

          {d.hoursLabel && d.hoursValue && (
            <div className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-2.5 py-2 ${d.gated ? 'blur-[6px] select-none pointer-events-none' : ''}`} aria-hidden={d.gated || undefined}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-0.5">{t(d.hoursLabel === 'WHEN' ? 'detail.when' : 'detail.hours')}</div>
              <div className="text-xs text-gray-700 dark:text-gray-200">{d.hoursValue}</div>
            </div>
          )}

          {/* #645: places with no hours on file say so explicitly — a missing
              section reads as broken, "unknown" is honest and sends the
              parent to the website button below. */}
          {d.hoursUnknown && (
            <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('detail.hours')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">{t('detail.hoursUnknown')}</div>
            </div>
          )}

          {/* Events sign-in gate: the WHEN box above stays as the teaser
              (list-item fields); everything curated is behind the unlock.
              description/goodToKnow/detailFailed self-gate — the detail fetch
              is held back while gated — but the sibling-dates strip must be
              hidden explicitly (it reads the free list payload). */}
          {d.gated && <EventUnlockCard itemId={d.id} onDismiss={() => setId(null)} />}

          {!d.gated && <SiblingDatesStrip siblings={d.siblings} currentId={d.id} onSelect={setId} />}

          {d.goodToKnow.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{t('detail.goodToKnow')}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-gray-700 dark:text-gray-200">
                {d.goodToKnow.map((f) => (
                  <span key={f.label}>
                    <span aria-hidden className="mr-1">{f.state === 'yes' ? '✓' : '◐'}</span>{f.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {d.detailFailed && (
            <div className="text-xs text-gray-400 dark:text-gray-500 italic">
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
            </div>
          )}
        </div>

        {/* Sticky footer — two map buttons up front (curator preference over the
            single-Directions pattern) + Website + Share; Report is a visible text
            button on the source line. Hidden while the event gate is up: the
            actions (directions, share URL) would leak the value the unlock
            card is withholding. */}
        {!d.gated && (
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-[18px] pt-3.5 pb-3 flex flex-col gap-2 relative">
          <div className="flex items-stretch gap-2">
            <a
              href={d.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => outbound(d.googleMapsUrl)}
              className="flex-1 text-center bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-bold py-2.5 rounded-[10px] shadow-[0_4px_12px_rgba(245,158,11,0.35)] transition-colors"
            >
              {t('detail.googleMaps')}
            </a>
            <a
              href={d.appleMapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => outbound(d.appleMapsUrl)}
              className="flex-1 text-center bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[13px] font-semibold py-2.5 rounded-[10px] hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
            >
              {t('detail.appleMaps')}
            </a>
          </div>
          <div className="flex items-stretch gap-2">
            {d.website && (
              <a
                href={d.website}
                target="_blank"
                rel="noreferrer"
                onClick={() => outbound(d.website!)}
                className="flex-1 text-center bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[13px] font-semibold py-2.5 rounded-[10px] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {t('detail.website')}
              </a>
            )}
            <button
              type="button"
              onClick={share}
              className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[13px] font-semibold py-2.5 rounded-[10px] hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {t('detail.share')}
            </button>
          </div>

          {copied && (
            <div role="status" className="absolute -top-7 right-[18px] bg-gray-900 dark:bg-gray-700 text-white text-xs px-2.5 py-1 rounded-md shadow-lg">{t('detail.copied')}</div>
          )}

          {/* FTC affiliate disclosure (#254) — renders only when the worker
              actually swapped an outbound URL for an affiliate-tagged one, so
              the footnote never claims affiliate links that aren't there. */}
          {d.affiliateTagged && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500">
              {t('detail.affiliateDisclosure')}
            </div>
          )}

          <div className="text-[11px] text-gray-400 dark:text-gray-500">
            {d.sourceUrl && d.sourceHost && (
              <>
                {t('detail.source')} <a href={d.sourceUrl} target="_blank" rel="noreferrer" onClick={() => outbound(d.sourceUrl!)} className="text-amber-600 dark:text-amber-400 hover:underline">{d.sourceHost}</a>
                {d.lastVerified && <> · {t('detail.verified', { date: d.lastVerified.slice(0, 10) })}</>}
                {' · '}
              </>
            )}
            <button type="button" onClick={() => setShowReport(true)} className="text-amber-600 dark:text-amber-400 hover:underline">{t('detail.reportAnIssue')}</button>
          </div>

          {/* Third conversion surface (#251) — below every primary action so
              it never competes with Directions/Website/Source for the tap. */}
          <ItemPopupSignupCTA itemId={d.id} />
        </div>
        )}
      </div>

      {showReport && <ReportModal itemId={d.id} onClose={() => setShowReport(false)} />}
    </>
  )
}
