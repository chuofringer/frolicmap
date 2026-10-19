import { useTranslation } from 'react-i18next'
import { CATEGORIES, CHIP_ORDER, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useCategoryChipState } from '@/components/Filters/useCategoryChipState'

/**
 * Category legend rows (color dot + emoji + label) — TAPPABLE category toggles
 * on ALL breakpoints (revision 6). Round 1 made the legend read-only because the
 * bar chips owned filtering, but round 3 removed the mobile chip row, leaving the
 * legend as the natural category-filter surface on mobile — and a legend that
 * looks tappable but isn't is a broken affordance. Behavior is the SAME as the
 * bar chips via the shared `useCategoryChipState` hook so the two can't drift:
 * live categories toggle `useFiltersStore.toggleCategory` + `trackGoal('filter_chip')`;
 * coming-soon categories fire `coming_soon_tap` + arm the metro-tagged waitlist
 * (#359) with the dashed/disabled treatment and the same aria-label copy.
 *
 * Toggled-off live categories dim (45% + gray text) so the legend doubles as a
 * live filter-state readout. Rows carry `aria-pressed` and stay full-row-tappable
 * but compact: 40px-min hit targets on touch (< md) and 32px on md+ (mouse), so
 * the popover keeps the pre-redesign density (revision 7).
 * Shared by the LegendButton popover (all sizes). Tapping a row never closes the
 * popover — users toggle several at once (the popover owns its own dismissal).
 */
/**
 * The list always lays out two-up (#643 follow-up): the single-column list
 * ran the full height of a phone screen, and the peek→open transition
 * jumping from a compact grid to a long column read as a bug. `peek` (the
 * first-mobile-visit auto-peek) additionally drops coming-soon rows — the
 * peek explains the dots actually on the map — and halves the row height;
 * the opened legend keeps full touch-height rows and its coming-soon
 * demand-signal rows (#359).
 */
export function LegendList({ peek = false }: { peek?: boolean } = {}) {
  const { t } = useTranslation()
  const chip = useCategoryChipState()
  const rowH = peek ? 'min-h-[28px]' : 'min-h-[40px] md:min-h-[32px]'
  return (
    <ul className="py-1 grid grid-cols-2 gap-x-1">
      {CHIP_ORDER.map((cat) => {
        const meta = CATEGORIES[cat]
        const c = chip.chipFor(cat)

        // Coming-soon: no data in this metro — dashed/disabled treatment; a tap
        // is the metro-tagged waitlist demand signal (#359).
        if (!c.live) {
          if (peek) return null
          return (
            <li key={cat}>
              <button
                type="button"
                onClick={c.comingSoon}
                aria-label={c.comingSoonLabel}
                className="w-full min-h-[40px] md:min-h-[32px] px-3 py-1 md:py-0.5 flex items-center gap-2 text-xs text-left text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] border border-dashed border-gray-300 dark:border-gray-600 opacity-60"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden
                >
                  {getCategoryEmoji(cat)}
                </span>
                <span>{categoryLabel(cat)}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide shrink-0">{t('legend.soon')}</span>
              </button>
            </li>
          )
        }

        // Live: tappable filter toggle. Off-state dims to 45% + gray text so the
        // legend reads out the current filter state.
        return (
          <li key={cat}>
            <button
              type="button"
              onClick={c.activate}
              aria-pressed={c.on}
              className={`w-full ${rowH} px-3 py-1 md:py-0.5 flex items-center gap-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all ${c.on ? '' : 'opacity-45'}`}
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] ring-1 ring-white"
                style={{ backgroundColor: meta.color }}
                aria-hidden
              >
                {getCategoryEmoji(cat)}
              </span>
              <span className={c.on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}>{categoryLabel(cat)}</span>
              {c.locked && (
                <span aria-hidden title={t('auth.signInToUnlock')} className="ml-auto text-[11px] opacity-60 shrink-0">🔒</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
