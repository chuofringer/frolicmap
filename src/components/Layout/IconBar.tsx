import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BasemapButton } from './BasemapButton'
import { FAQButton } from './FAQButton'
import { LanguageButton } from '@/components/I18n/LanguageButton'
import { FAQOverlay } from './FAQOverlay'
import { BASEMAPS, basemapLabel } from '@/config/mapStyle'
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery'
import { use3DToggle } from '@/hooks/use3DToggle'
import { useMapStore } from '@/stores/useMapStore'

const ICON_BTN = 'w-11 h-11 flex items-center justify-center backdrop-blur-md bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 hover:bg-white dark:hover:bg-gray-900 transition-colors'

// Top-right chrome. Desktop (md+): the inline icon row (basemap, FAQ,
// language), each driven by the shared overlay coordinator so only one popover
// is open at a time and opening one closes the detail panel. Mobile (< md): a
// top-right column. A single ⋯ button HORIZONTALLY EXPANDS a row of three 44px
// icons to its left — [map style][FAQ][3D] — sliding/fading in; the language
// toggle stacks standalone below it. The 3D control lives here on mobile
// (removed from the standalone MapControls < md).
export function IconBar() {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const overlay = useMapStore((s) => s.overlay)
  const openOverlay = useMapStore((s) => s.openOverlay)
  const closeOverlay = useMapStore((s) => s.closeOverlay)
  const detailOpen = useMapStore((s) => s.selectedId !== null)
  const viewMode = useMapStore((s) => s.viewMode)
  const basemap = useMapStore((s) => s.basemap)
  const setBasemap = useMapStore((s) => s.setBasemap)
  const { is3D, supports3D, toggle3D } = use3DToggle()
  // Whether the -392px detail-panel shift leaves room for the icon row to
  // clear the top-left brand column: brand (~190px) + row (3×44 + gaps ≈
  // 160px) + panel (380 + 12) + margins. Below this the shifted row lands on
  // the frolicmap logo, so the row stays put and yields to the panel.
  const shiftFits = useMediaQuery('(min-width: 900px)')
  const ref = useRef<HTMLDivElement>(null)

  const basemapOpen = overlay === 'basemap'
  const faqOpen = overlay === 'faq'
  const menuOpen = overlay === 'menu'

  // ESC closes whichever of this bar's surfaces is open.
  useEffect(() => {
    if (!(basemapOpen || faqOpen || menuOpen)) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [basemapOpen, faqOpen, menuOpen, closeOverlay])

  // Outside-click collapses the mobile ⋯ expander.
  useEffect(() => {
    if (!menuOpen) return
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeOverlay('menu')
    }
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [menuOpen, closeOverlay])

  if (isDesktop) {
    return (
      <>
        {/* With a detail panel open the row slides left of it — but only when
            the viewport has room (≥900px); on narrower windows it stays put at
            z-30 so the z-40 panel covers it instead of the row piling onto the
            brand box. */}
        <div className={`absolute top-3 right-3 flex items-center gap-2 transition-transform duration-200 ${detailOpen && !shiftFits ? 'z-30' : 'z-50'} ${detailOpen && shiftFits ? '-translate-x-[392px]' : ''}`}>
          <BasemapButton
            open={basemapOpen}
            onToggle={() => (basemapOpen ? closeOverlay('basemap') : openOverlay('basemap'))}
            onClose={() => closeOverlay('basemap')}
          />
          <FAQButton active={faqOpen} onClick={() => (faqOpen ? closeOverlay('faq') : openOverlay('faq'))} />
          <LanguageButton />
        </div>
        {faqOpen && <FAQOverlay onClose={() => closeOverlay('faq')} />}
      </>
    )
  }

  // Mobile: the list panel starts at 112px while this column runs
  // to 160px, so the column yields entirely there — same rule as the bottom
  // control bar. The detail sheet is different: at its peek/half snaps the
  // map (and the column's area) stays visible, so the column stays MOUNTED
  // and instead drops below the sheet's z-40 (see the wrapper class below) —
  // unmounting it here made the language/coffee icons vanish the moment any
  // card opened, even with the sheet only peeking at the bottom.
  if (viewMode !== 'map') return null

  // Mobile: ⋯ horizontal expander on top, standalone language toggle below it.
  return (
    <>
      {/* While the detail sheet is open the column drops to z-30 so the z-40
          sheet covers it at the full snap. At z-50 the buttons would float ON
          TOP of the card — overlapping its close ✕, and near-invisible on a
          dark basemap (gray-900/90 buttons on the gray-900 sheet).

          pointer-events-none on the column, auto on its children: the
          always-mounted (hidden) ⋯ expander row inflates the column's box to
          ~200px wide × 108px tall of mostly TRANSPARENT area, and at z-50 it
          renders after the metro picker in the DOM — so the invisible box sat
          on top of the picker dialog's close ✕ and swallowed the tap
          (operator repro 2026-08-25: outside-tap closed, ✕ didn't). */}
      <div className={`absolute top-3 right-3 flex flex-col items-end gap-2 pointer-events-none ${detailOpen ? 'z-30' : 'z-50'}`}>
        <div ref={ref} className="flex items-center gap-2">
          {/* The row is always mounted so it can slide/fade both ways; `inert`
              keeps it non-interactive + out of the tab order while collapsed.
              The open state sets pointer-events-auto explicitly because the
              column wrapper is pointer-events-none. */}
          <div
            inert={!menuOpen}
            className={`flex items-center gap-2 transition-all duration-200 ${menuOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-4 pointer-events-none'}`}
          >
            <button
              type="button"
              aria-label={t('map.mapStyleLabel')}
              onClick={() => openOverlay('basemap')}
              className={ICON_BTN}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2L2 7l10 5 10-5-10-5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 17l10 5 10-5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 12l10 5 10-5" />
              </svg>
            </button>
            <FAQButton active={faqOpen} onClick={() => openOverlay('faq')} />
            <button
              type="button"
              aria-label={t('map.toggle3DAriaLabel')}
              aria-pressed={is3D}
              title={supports3D ? t('map.toggle3DTitleSupported') : t('map.toggle3DTitleUnsupported')}
              onClick={toggle3D}
              className={`${is3D ? 'w-11 h-11 flex items-center justify-center rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 bg-amber-500 text-white hover:bg-amber-600 transition-colors' : ICON_BTN} font-bold text-sm leading-none tracking-tight`}
            >
              {t('map.threeDLabel')}
            </button>
          </div>
          <button
            type="button"
            aria-label={t('map.moreOptionsAriaLabel')}
            aria-expanded={menuOpen}
            onClick={() => (menuOpen ? closeOverlay('menu') : openOverlay('menu'))}
            className={`${ICON_BTN} pointer-events-auto`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </div>
        {/* Language toggle — standalone, never collapsed into ⋯. Someone
            reading Chinese who lands on the English map cannot be expected to
            open a ⋯ menu to discover the site speaks their language; that is
            the one control that has to be visible without exploration.
            Column bottom: 108px. */}
        <LanguageButton className="pointer-events-auto" />
      </div>

      {/* Independent mobile basemap popover (not anchored to the collapsing row).
          Opens below the standalone language button (bottom 108px + 8px gap)
          so it never sits under the top-right column. */}
      {basemapOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => closeOverlay('basemap')} aria-hidden />
          <div role="dialog" aria-label={t('map.mapStyleLabel')} className="fixed top-[116px] right-3 z-50 backdrop-blur-md bg-white/95 dark:bg-gray-900/95 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 overflow-hidden min-w-[180px] text-gray-700 dark:text-gray-200">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">{t('map.mapStyleLabel')}</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setBasemap(b.id); closeOverlay('basemap') }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <span>{basemapLabel(b.id)}</span>
                {basemap === b.id && (
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {faqOpen && <FAQOverlay onClose={() => closeOverlay('faq')} />}
    </>
  )
}
