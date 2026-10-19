import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { publishedMetros } from '@shared/metros'
import { useMetro } from '@/hooks/useMetro'
import { useMapStore } from '@/stores/useMapStore'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { resolveGeoAction } from '@/utils/geoMetro'
import { metroName, metroShortName } from '@/config/metroNames'
import { localizedPath } from '@/i18n/locale'

// Metro switcher (issue #386). The `/` overlay half of the multi-region work:
// an unobtrusive trigger on the map showing the CURRENT metro's name (so after
// switching, the box tells you where you are), opening a panel that lists the
// published metros and offers opt-in geolocation. The trigger shows
// `shortLabel ?? label` with `truncate` as a safety net for the box width; the
// full current metro is also carried in the aria-label for screen readers, and
// `title` keeps the "Choose your city" affordance hint. The trigger is
// positioned by App.tsx's top-left flex container (shared with Brand) so it
// renders at exactly the brand box's width; the dialog panel below stays
// fixed-positioned.
//
// Two invariants the issue is explicit about:
//   - Links to a metro's page are plain <a href="/cities/{slug}"> full-page
//     navigations, NOT react-router <Link>. A client-side route gets swallowed
//     by the SPA catch-all and boots the map instead of the prerendered page.
//   - Only publishedMetros() are ever listed. An unpublished metro is API-gated
//     (#371) and sitemap-excluded; surfacing it here would be its one leak.
//
// It only ever opens on a click, so there's no nag and no dismissal flag to
// persist — closing just re-hides the panel.
//
// i18n (#208): English keeps the pre-existing shortLabel/label behavior from
// `shared/metros.ts` untouched (byte-identical for the test suite). Chinese
// looks up a translated name via `t('metro.names.<id>', { defaultValue })`,
// falling back to the plain English label for any metro not yet in
// `zh/metro.ts`'s `names` map.

export function MetroPicker() {
  const { t } = useTranslation()
  const current = useMetro()
  const metros = publishedMetros()
  // Open state is the shared overlay coordinator (item 1b) so opening the picker
  // closes the detail panel and any other popover; it renders at z-50.
  const overlay = useMapStore((s) => s.overlay)
  const openOverlay = useMapStore((s) => s.openOverlay)
  const closeOverlay = useMapStore((s) => s.closeOverlay)
  const open = overlay === 'metro'
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMessage, setGeoMessage] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Both names resolve through the shared helper so the picker and the rest
  // of the UI can never disagree about what a city is called.
  const longName = metroName
  const shortName = metroShortName


  const close = () => {
    closeOverlay('metro')
    setGeoBusy(false)
    setGeoMessage(null)
  }

  // Focus the panel on open (screen-reader + keyboard entry point), wire ESC
  // to close, and keep Tab/Shift+Tab inside the panel instead of walking out
  // to the map behind it — same contract as FAQOverlay / LegendButton.
  useFocusTrap(panelRef, open, close)

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoMessage(t('metro.geoNotAvailable'))
      return
    }
    setGeoBusy(true)
    setGeoMessage(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false)
        const action = resolveGeoAction(current, pos.coords.latitude, pos.coords.longitude)
        if (action.kind === 'navigate') {
          window.location.assign(localizedPath(action.href))
        } else if (action.kind === 'here') {
          close()
        } else {
          setGeoMessage(t('metro.geoNoMatch'))
        }
      },
      (err) => {
        setGeoBusy(false)
        setGeoMessage(
          err.code === err.PERMISSION_DENIED
            ? t('metro.geoPermissionDenied')
            : t('metro.geoGenericError'),
        )
      },
      { timeout: 8000, enableHighAccuracy: false },
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? close() : openOverlay('metro'))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('metro.currentCityAriaLabel', { label: longName(current) })}
        title={t('metro.chooseYourCity')}
        className="w-full self-stretch backdrop-blur-md bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 px-3 h-11 flex items-center justify-between gap-1.5 hover:bg-white dark:hover:bg-gray-900 transition-colors text-sm font-medium"
      >
        <span className="truncate">{shortName(current)}</span>
        <span aria-hidden className="text-gray-400 dark:text-gray-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={close} aria-hidden />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('metro.chooseYourCity')}
            // Height cap: the old calc(100dvh-84px) accounted only for the
            // top offset, so on phones the panel ran underneath the floating
            // bottom bar (search/near-me/toggle at bottom-3, ~48px tall) and
            // the pinned "Browse all cities" footer was hidden behind it
            // with 15 metros in the list. Mobile now also reserves the
            // bottom-bar band (~72px incl. gap); md+ keeps the old cap (the
            // bar docks at the top on desktop).
            className="fixed top-[68px] left-3 z-50 w-80 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-156px)] md:max-h-[calc(100dvh-84px)] flex flex-col backdrop-blur-md bg-white dark:bg-gray-900 rounded-lg shadow-xl ring-1 ring-black/20 dark:ring-white/10 overflow-hidden focus:outline-none"
          >
            <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('metro.chooseYourCity')}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t('metro.closePickerAriaLabel')}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-3 flex flex-col min-h-0 flex-1">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={geoBusy}
                className="shrink-0 w-full flex items-center gap-2 justify-center rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 dark:disabled:bg-amber-800 text-white text-sm font-medium px-3 py-2 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                {geoBusy ? t('metro.locating') : t('metro.useMyLocation')}
              </button>

              {geoMessage && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-300" role="status">{geoMessage}</p>
              )}

              {/* Only the metro list scrolls; the geo button above and the
                  browse-all footer below stay pinned inside the capped panel
                  (13+ metros overflow common desktop heights — issue: the
                  footer link fell below the fold with no page scroll). */}
              <ul className="mt-3 flex flex-col gap-1 overflow-y-auto min-h-0 flex-1">
                {metros.map((m) => {
                  const isCurrent = m.id === current.id
                  return (
                    <li key={m.id}>
                      <a
                        href={localizedPath(`/cities/${m.slug}`)}
                        aria-current={isCurrent ? 'true' : undefined}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                          isCurrent
                            ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200'
                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="truncate">{longName(m)}</span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 shrink-0">{t('metro.current')}</span>
                        )}
                      </a>
                    </li>
                  )
                })}
              </ul>

              <div className="shrink-0 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <a
                  href={localizedPath('/cities')}
                  className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {t('metro.browseAllCities')}
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
