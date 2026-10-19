import { CATEGORIES, CHIP_ORDER, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useCategoryChipState } from '@/components/Filters/useCategoryChipState'

/**
 * Category legend rows (color dot + emoji + label) — TAPPABLE category toggles
 * on ALL breakpoints. Behavior is the SAME as the bar chips via the shared
 * `useCategoryChipState` hook so the two can't drift: a row toggles
 * `useFiltersStore.toggleCategoryGroup` + `trackGoal('filter_chip')`.
 *
 * Toggled-off categories dim (45% + gray text) so the legend doubles as a
 * live filter-state readout. Rows carry `aria-pressed` and stay full-row-tappable
 * but compact: 40px-min hit targets on touch (< md) and 32px on md+ (mouse).
 * Shared by the LegendButton popover (all sizes). Tapping a row never closes the
 * popover — users toggle several at once (the popover owns its own dismissal).
 *
 * The list always lays out two-up; `peek` (the first-mobile-visit auto-peek)
 * halves the row height.
 */
export function LegendList({ peek = false }: { peek?: boolean } = {}) {
  const chip = useCategoryChipState()
  const rowH = peek ? 'min-h-[28px]' : 'min-h-[40px] md:min-h-[32px]'
  return (
    <ul className="py-1 grid grid-cols-2 gap-x-1">
      {CHIP_ORDER.map((cat) => {
        const meta = CATEGORIES[cat]
        const c = chip.chipFor(cat)

        // Off-state dims to 45% + gray text so the legend reads out the
        // current filter state.
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
            </button>
          </li>
        )
      })}
    </ul>
  )
}
