import type { ListItem, Filters } from '@shared/types'
import { haversineMiles } from './distance'

/**
 * Does an item satisfy the category chip selection?
 *
 * A plain `categories.has(item.category)` misses the real-world case #220
 * fixes: a neighborhood park with an on-site playground that was never
 * separately OSM-tagged `leisure=playground`, so it has no standalone
 * playground pin to filter for. Checking "Playground" now ALSO matches a
 * `category='park'` row flagged `has_playground=1` — an attribute of that
 * park, not a second legend category (the legend/pin styling is untouched;
 * this only widens which rows the Playground chip includes).
 */
function matchesCategoryFilter(item: ListItem, categories: Filters['categories']): boolean {
  if (categories.has(item.category)) return true
  return categories.has('playground') && item.category === 'park' && item.has_playground === 1
}

// Generic over the specific shape of items so both full `Item` (admin
// contexts) and redacted `ListItem` (public list payload) can flow through
// the same filter pipeline. All fields referenced below exist on both.
export function applyFilters<T extends ListItem>(items: T[], filters: Filters): T[] {
  return items.filter((item) => {
    if (filters.categories.size > 0 && !matchesCategoryFilter(item, filters.categories)) return false
    if (filters.freeOnly && item.cost !== 'free') return false
    if (filters.indoorOnly && item.indoor !== 1) return false
    if (filters.outdoorOnly && item.indoor !== 0) return false
    if (
      (item.age_min != null && item.age_min > filters.ageMax) ||
      (item.age_max != null && item.age_max < filters.ageMin)
    ) return false
    if (filters.nearbyCenter) {
      const d = haversineMiles(filters.nearbyCenter, [item.lng, item.lat])
      if (d > filters.nearbyRadiusMiles) return false
    }
    return true
  })
}
