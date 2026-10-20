import { describe, it, expect } from 'vitest'
import { applyFilters } from '../filters'
import { DEFAULT_FILTERS, type Item } from '@shared/types'

const base: Omit<Item, 'id' | 'name' | 'category'> = {
  type: 'place', description: null, lat: 37.7, lng: -122.4, address: null,
  age_min: null, age_max: null, cost: null, price_usd: null, indoor: null,
  opening_hours: null,
  photo_url: null, photo_attribution: null, website: null, source_url: 's', source_type: 'manual', confidence: 'high',
  status: 'approved', last_verified: '2026-01-01', created_at: '2026-01-01', updated_at: '2026-01-01',
  region: 'bay', city: null, attributes: null, slug: null, has_playground: null, name_zh: null,
}
const makePlace = (id: string, cat: Item['category'], o: Partial<Item> = {}): Item =>
  ({ ...base, id, name: id, category: cat, ...o } as Item)

describe('applyFilters', () => {
  const items = [
    makePlace('pg', 'playground', { indoor: 0, cost: 'free' }),
    makePlace('m', 'museum', { indoor: 1, cost: 'paid' }),
    makePlace('lib', 'library', { indoor: 1, cost: 'free' }),
  ]

  it('shows all with defaults', () => {
    expect(applyFilters(items, DEFAULT_FILTERS).length).toBe(3)
  })

  it('filters by category', () => {
    const f = { ...DEFAULT_FILTERS, categories: new Set(['museum' as const]) }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['m'])
  })

  // #220: the Playground chip also matches a park with an on-site playground
  // that was never separately mapped as its own leisure=playground node.
  it('filters by category: playground chip also matches a flagged park', () => {
    const withParks = [
      ...items,
      makePlace('park-flagged', 'park', { has_playground: 1 }),
      makePlace('park-plain', 'park', { has_playground: null }),
    ]
    const f = { ...DEFAULT_FILTERS, categories: new Set(['playground' as const]) }
    expect(applyFilters(withParks, f).map(i => i.id).sort()).toEqual(['park-flagged', 'pg'])
  })

  it('filters freeOnly', () => {
    const f = { ...DEFAULT_FILTERS, freeOnly: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['pg', 'lib'])
  })

  it('filters indoorOnly', () => {
    const f = { ...DEFAULT_FILTERS, indoorOnly: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['m', 'lib'])
  })

  it('filters outdoorOnly', () => {
    const f = { ...DEFAULT_FILTERS, outdoorOnly: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['pg'])
  })

  it('filters by age range, keeping rows with no age bounds', () => {
    const aged = [
      makePlace('toddler', 'playground', { age_min: 0, age_max: 4 }),
      makePlace('teen', 'museum', { age_min: 13, age_max: 18 }),
      makePlace('any', 'park'),
    ]
    const f = { ...DEFAULT_FILTERS, ageMin: 0, ageMax: 5 }
    expect(applyFilters(aged, f).map(i => i.id)).toEqual(['toddler', 'any'])
  })

  it('filters by nearby radius around a center', () => {
    const spread = [
      makePlace('near', 'park', { lat: 37.7, lng: -122.4 }),
      makePlace('far', 'park', { lat: 38.5, lng: -121.5 }),
    ]
    const f = { ...DEFAULT_FILTERS, nearbyCenter: [-122.4, 37.7] as [number, number], nearbyRadiusMiles: 5 }
    expect(applyFilters(spread, f).map(i => i.id)).toEqual(['near'])
  })
})
