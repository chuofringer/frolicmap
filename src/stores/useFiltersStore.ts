import { create } from 'zustand'
import type { Category, Filters } from '@shared/types'
import { DEFAULT_FILTERS } from '@shared/types'

type FiltersStore = Filters & {
  toggleCategory: (c: Category) => void
  toggleCategoryGroup: (cats: readonly Category[]) => void
  setCategories: (categories: Set<Category>) => void
  setTime: (t: Filters['timeWindow']) => void
  setIndoorOutdoor: (io: 'indoor' | 'outdoor' | 'any') => void
  setAge: (min: number, max: number) => void
  setFreeOnly: (b: boolean) => void
  toggleInSeasonNow: () => void
  setNearby: (center: [number, number] | null, radiusMiles?: number) => void
  reset: () => void
}

export const useFiltersStore = create<FiltersStore>((set) => ({
  ...DEFAULT_FILTERS,
  toggleCategory: (c) => set((s) => {
    const next = new Set(s.categories)
    if (next.has(c)) next.delete(c); else next.add(c)
    return { categories: next }
  }),
  // Combined-chip toggle (#323): all-or-nothing over the group so a partially
  // selected group (e.g. `?cat=zoo` deep link left only `zoo` in the set)
  // still turns fully OFF on the first tap instead of flipping members
  // individually and leaving the chip stuck on.
  toggleCategoryGroup: (cats) => set((s) => {
    const next = new Set(s.categories)
    if (cats.some((c) => next.has(c))) cats.forEach((c) => next.delete(c))
    else cats.forEach((c) => next.add(c))
    return { categories: next }
  }),
  setCategories: (categories) => set({ categories }),
  setTime: (timeWindow) => set({ timeWindow }),
  setIndoorOutdoor: (io) => set({ indoorOnly: io === 'indoor', outdoorOnly: io === 'outdoor' }),
  setAge: (ageMin, ageMax) => set({ ageMin, ageMax }),
  setFreeOnly: (freeOnly) => set({ freeOnly }),
  toggleInSeasonNow: () => set((s) => ({ inSeasonNow: !s.inSeasonNow })),
  setNearby: (center, radiusMiles) => set({
    nearbyCenter: center,
    nearbyRadiusMiles: radiusMiles ?? 5,
  }),
  reset: () => set({ ...DEFAULT_FILTERS }),
}))
