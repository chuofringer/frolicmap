import { useTranslation } from 'react-i18next'
import { CATEGORIES, CHIP_ORDER, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useCategoryChipState } from './useCategoryChipState'

export function CategoryChips() {
  // Live/coming-soon branch + waitlist/trackGoal wiring is shared with the
  // consolidated bar's inline chip row via useCategoryChipState (styling stays
  // local to each). See src/components/Filters/useCategoryChipState.ts.
  const chip = useCategoryChipState()
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-2">
      {CHIP_ORDER.map((cat) => {
        const meta = CATEGORIES[cat]
        const c = chip.chipFor(cat)

        // Coming-soon (#359): a category without data in this metro renders
        // disabled with a badge rather than disappearing. Keeping it visible
        // makes the roadmap legible, and a tap is the metro-tagged demand
        // signal that decides which metro earns depth next (plan §4B).
        if (!c.live) {
          return (
            <button
              key={cat}
              type="button"
              onClick={c.comingSoon}
              aria-label={c.comingSoonLabel}
              className="px-3 py-2 rounded-lg text-sm whitespace-nowrap border border-dashed
                         border-gray-300 dark:border-gray-600 bg-transparent
                         text-gray-400 dark:text-gray-500 flex items-center gap-2 justify-start"
            >
              <span className="text-base opacity-60">{getCategoryEmoji(cat)}</span>
              <span className="truncate">{categoryLabel(cat)}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide
                               text-gray-400 dark:text-gray-500 shrink-0">
                {t('filters.soon')}
              </span>
            </button>
          )
        }

        return (
          <button
            key={cat}
            onClick={c.activate}
            className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap border flex items-center gap-2 justify-start transition-colors ${
              c.on
                ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-600'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-transparent'
            }`}
            style={c.on ? { boxShadow: `inset 0 -3px 0 ${meta.color}` } : undefined}
          >
            <span className="text-base">{getCategoryEmoji(cat)}</span>
            <span>{categoryLabel(cat)}</span>
            {c.locked && (
              <span aria-hidden title={t('auth.signInToUnlock')} className="ml-auto text-xs opacity-60">🔒</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
