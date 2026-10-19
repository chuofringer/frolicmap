import { useMemo } from 'react'
import type { Category } from '@shared/types'
import { chipCategories } from '@/config/categories'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMetro } from '@/hooks/useMetro'
import { trackGoal } from '@/utils/analytics'

export interface CategoryChip {
  /** Toggle-on state (empty filter set = all on). */
  on: boolean
  /** Click handler: `trackGoal('filter_chip')` + `toggleCategoryGroup`. */
  activate: () => void
}

/**
 * Single source of truth for category-chip behavior. Consumed by both
 * `CategoryChips` (in the drawer), the legend and the consolidated bar's
 * inline chip row so they can't drift; each keeps its own styling. Call once
 * per component, then `chipFor(cat)` per category (avoids calling hooks in a
 * loop).
 */
export function useCategoryChipState() {
  const categories = useFiltersStore((s) => s.categories)
  const toggleCategoryGroup = useFiltersStore((s) => s.toggleCategoryGroup)
  const metro = useMetro()

  return useMemo(() => ({
    metro,
    chipFor(cat: Category): CategoryChip {
      // A chip speaks for its whole display group (#323): the "Aquarium/Zoo"
      // chip reads as on if either category is selected and toggles both
      // atomically. For ungrouped categories `group` is just `[cat]`.
      const group = chipCategories(cat)
      return {
        on: categories.size === 0 || group.some((c) => categories.has(c)),
        activate: () => { trackGoal('filter_chip'); toggleCategoryGroup(group) },
      }
    },
  }), [categories, metro, toggleCategoryGroup])
}
