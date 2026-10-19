import { useMemo } from 'react'
import type { Category } from '@shared/types'
import { i18next } from '@/i18n'
import { categoryLabel, chipCategories } from '@/config/categories'
import { metroName } from '@/config/metroNames'
import { EVENTS_GATE_ENABLED } from '@/config/constants'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMapStore } from '@/stores/useMapStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useMetro, isCategoryLive } from '@/hooks/useMetro'
import { trackGoal } from '@/utils/analytics'

export interface CategoryChip {
  /** Has real data in the current metro (else it's a coming-soon chip). */
  live: boolean
  /** Toggle-on state (empty filter set = all on). */
  on: boolean
  /**
   * Events sign-in gate (2026-07-26 experiment): true on the live event chip
   * while the visitor hasn't unlocked — renderers show a small lock glyph.
   * The chip still filters normally (pins stay visible); only the detail
   * view is gated.
   */
  locked: boolean
  /** aria-label for the coming-soon variant. */
  comingSoonLabel: string
  /** Live-chip click: `trackGoal('filter_chip')` + `toggleCategory`. */
  activate: () => void
  /** Coming-soon click: `trackGoal('coming_soon_tap')` + arm the waitlist. */
  comingSoon: () => void
}

/**
 * Single source of truth for category-chip behavior — the live vs. coming-soon
 * branch, the #359 waitlist demand-signal wiring, and the `filter_chip` /
 * `coming_soon_tap` goals. Consumed by both `CategoryChips` (in the drawer) and
 * the consolidated bar's inline chip row so the two can't drift; each keeps its
 * own styling. Call once per component, then `chipFor(cat)` per category (avoids
 * calling hooks in a loop).
 */
export function useCategoryChipState() {
  const categories = useFiltersStore((s) => s.categories)
  const toggleCategoryGroup = useFiltersStore((s) => s.toggleCategoryGroup)
  const metro = useMetro()
  const openWaitlist = useMapStore((s) => s.openWaitlistForCategory)
  const signedIn = useAuthStore((s) => s.signedIn)

  return useMemo(() => ({
    metro,
    chipFor(cat: Category): CategoryChip {
      // A chip speaks for its whole display group (#323): the "Aquarium/Zoo"
      // chip is live if EITHER category has data in the metro, reads as on if
      // either is selected, and toggles both atomically. For ungrouped
      // categories `group` is just `[cat]` and this collapses to the old
      // single-category behavior.
      const group = chipCategories(cat)
      const live = group.some((c) => isCategoryLive(metro, c))
      return {
        live,
        on: categories.size === 0 || group.some((c) => categories.has(c)),
        locked: cat === 'event' && live && EVENTS_GATE_ENABLED && !signedIn,
        comingSoonLabel: i18next.t('filters.comingSoon', { category: categoryLabel(cat), metro: metroName(metro) }),
        activate: () => { trackGoal('filter_chip', cat); toggleCategoryGroup(group) },
        comingSoon: () => { trackGoal('coming_soon_tap', cat); openWaitlist({ category: cat, metro: metro.id }) },
      }
    },
  }), [categories, metro, toggleCategoryGroup, openWaitlist, signedIn])
}
