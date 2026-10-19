import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_FILTERS, type Item } from '@shared/types'
import { CATEGORY_ORDER, CHIP_ORDER, chipCategories } from '@/config/categories'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { applyFilters } from '@/utils/filters'

// The combined "Aquarium/Zoo" chip (#323): zoo is a real DB category but has
// no chip of its own — the aquarium chip speaks for both. These tests pin the
// three pieces that make that work: the render order, the group expansion,
// and the all-or-nothing group toggle feeding applyFilters.

describe('combined Aquarium/Zoo chip (#323)', () => {
  beforeEach(() => {
    useFiltersStore.getState().reset()
  })

  it('zoo is in the vocabulary but not in the chip/legend order', () => {
    expect(CATEGORY_ORDER).toContain('zoo')
    expect(CHIP_ORDER).not.toContain('zoo')
    expect(CHIP_ORDER).toContain('aquarium')
  })

  it('parked categories (#199/#200) stay in the vocabulary but out of the chip/legend order', () => {
    expect(CATEGORY_ORDER).toContain('birthday_party')
    expect(CATEGORY_ORDER).toContain('restaurant')
    expect(CHIP_ORDER).not.toContain('birthday_party')
    expect(CHIP_ORDER).not.toContain('restaurant')
  })

  it('the group resolves the same from either member', () => {
    expect(chipCategories('aquarium')).toEqual(['aquarium', 'zoo'])
    expect(chipCategories('zoo')).toEqual(['aquarium', 'zoo'])
    // Ungrouped categories collapse to themselves.
    expect(chipCategories('park')).toEqual(['park'])
  })

  it('toggling the group selects and deselects both categories together', () => {
    const store = useFiltersStore.getState()
    store.toggleCategoryGroup(chipCategories('aquarium'))
    expect([...useFiltersStore.getState().categories].sort()).toEqual(['aquarium', 'zoo'])
    useFiltersStore.getState().toggleCategoryGroup(chipCategories('aquarium'))
    expect(useFiltersStore.getState().categories.size).toBe(0)
  })

  it('a partially selected group (e.g. ?cat=zoo deep link) clears fully on one tap', () => {
    useFiltersStore.getState().setCategories(new Set(['zoo']))
    useFiltersStore.getState().toggleCategoryGroup(chipCategories('aquarium'))
    expect(useFiltersStore.getState().categories.size).toBe(0)
  })

  it('selecting the chip filters BOTH aquarium and zoo items', () => {
    const base: Omit<Item, 'id' | 'name' | 'category'> = {
      type: 'place', description: null, lat: 37.7, lng: -122.4, address: null,
      age_min: null, age_max: null, cost: null, price_usd: null, indoor: null,
      opening_hours: null, start_time: null, end_time: null, rrule: null, exdates: null,
      photo_url: null, photo_attribution: null, has_playground: null, name_zh: null, website: null, source_url: 's', source_type: 'osm', confidence: 'high',
      status: 'approved', last_verified: '2026-01-01', created_at: '2026-01-01', updated_at: '2026-01-01',
      crops: null, crops_state: null, in_season_now: null,
      region: 'bay', city: null, attributes: null, slug: null,
    }
    const items: Item[] = [
      { ...base, id: 'aq', name: 'Aquarium of the Bay', category: 'aquarium' },
      { ...base, id: 'zoo', name: 'Oakland Zoo', category: 'zoo' },
      { ...base, id: 'park', name: 'Some Park', category: 'park' },
    ]
    const f = { ...DEFAULT_FILTERS, categories: new Set(chipCategories('aquarium')) }
    expect(applyFilters(items, f).map((i) => i.id)).toEqual(['aq', 'zoo'])
  })
})
