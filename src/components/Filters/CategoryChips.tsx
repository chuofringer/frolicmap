import { CATEGORIES, CHIP_ORDER, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { useCategoryChipState } from './useCategoryChipState'
import { ComingSoonChip } from './ComingSoonChip'

export function CategoryChips() {
  // Toggle wiring is shared with the legend and the consolidated bar's inline
  // chip row via useCategoryChipState (styling stays local to each).
  const chip = useCategoryChipState()

  return (
    <div className="grid grid-cols-2 gap-2">
      {CHIP_ORDER.map((cat) => {
        const meta = CATEGORIES[cat]
        const c = chip.chipFor(cat)

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
          </button>
        )
      })}
      <ComingSoonChip />
    </div>
  )
}
