import { useFiltersStore } from '@/stores/useFiltersStore'

/**
 * Count of active drawer-scoped filter facets, for the "Filters (N)" badge
 * shared by the mobile bottom bar's Filters button, the desktop "All
 * filters" chip, and the mobile list panel's Filters entry point. freeOnly
 * counts here AND renders as its own "Free only ✓" chip on desktop — free is
 * deliberately double-signalled (the shipped decision).
 */
export function useActiveFilterCount(): number {
  const { freeOnly, timeWindow, indoorOnly, outdoorOnly, ageMin, ageMax, inSeasonNow } = useFiltersStore()
  return (
    (freeOnly ? 1 : 0) +
    (timeWindow ? 1 : 0) +
    (indoorOnly || outdoorOnly ? 1 : 0) +
    (ageMin !== 0 || ageMax !== 18 ? 1 : 0) +
    (inSeasonNow ? 1 : 0)
  )
}
