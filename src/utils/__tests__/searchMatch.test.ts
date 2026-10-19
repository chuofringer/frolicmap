import { describe, it, expect } from 'vitest'
import type { Category } from '@shared/types'
import { matchesActivity, type MatchableItem } from '../searchMatch'

// Mirrors src/i18n/en/categories.ts without pulling in i18next — matchesActivity
// takes categoryLabel as a plain function so it stays testable in isolation.
const LABELS: Record<Category, string> = {
  playground: 'Playground', museum: 'Museum', library: 'Library', park: 'Park',
  aquarium: 'Aquarium/Zoo', zoo: 'Zoo', beach: 'Beach', waterplay: 'Water Play', hiking: 'Hiking',
  campground: 'Campground', event: 'Event', upick: 'U-Pick Farm',
  birthday_party: 'Birthday Party',
  restaurant: 'Restaurant',
}
const label = (c: Category) => LABELS[c]

const item = (over: Partial<MatchableItem>): MatchableItem => ({
  category: 'playground', type: 'place', indoor: 0, cost: 'paid', ...over,
})

describe('matchesActivity (issue #212)', () => {
  it('still requires at least 2 characters', () => {
    expect(matchesActivity(item({}), 'p', label)).toBe(false)
  })

  it('matches a category label substring beyond the name', () => {
    expect(matchesActivity(item({ category: 'playground' }), 'playground', label)).toBe(true)
    expect(matchesActivity(item({ category: 'park' }), 'playground', label)).toBe(false)
  })

  it('matches the category slug (the shared search-term vocabulary)', () => {
    expect(matchesActivity(item({ category: 'waterplay' }), 'splash-pads', label)).toBe(true)
    expect(matchesActivity(item({ category: 'upick' }), 'u-pick-farms', label)).toBe(true)
  })

  it('matches the event type keyword', () => {
    expect(matchesActivity(item({ type: 'event', category: 'event' }), 'event', label)).toBe(true)
    expect(matchesActivity(item({ type: 'place', category: 'park' }), 'event', label)).toBe(false)
  })

  // The issue's own example queries.
  it('"trampoline" surfaces playground rows via the synonym table', () => {
    expect(matchesActivity(item({ category: 'playground' }), 'trampoline', label)).toBe(true)
    expect(matchesActivity(item({ category: 'museum' }), 'trampoline', label)).toBe(false)
  })

  it('"farm" surfaces u-pick rows', () => {
    expect(matchesActivity(item({ category: 'upick' }), 'farm', label)).toBe(true)
  })

  it('"storytime" surfaces both library and event rows', () => {
    expect(matchesActivity(item({ category: 'library' }), 'storytime', label)).toBe(true)
    expect(matchesActivity(item({ category: 'event', type: 'event' }), 'storytime', label)).toBe(true)
    expect(matchesActivity(item({ category: 'beach' }), 'storytime', label)).toBe(false)
  })

  it('"climbing" surfaces playground and park rows', () => {
    expect(matchesActivity(item({ category: 'playground' }), 'climbing', label)).toBe(true)
    expect(matchesActivity(item({ category: 'park' }), 'climbing', label)).toBe(true)
    expect(matchesActivity(item({ category: 'library' }), 'climbing', label)).toBe(false)
  })

  it('"free indoor" ANDs both predicates — neither alone is enough', () => {
    expect(matchesActivity(item({ cost: 'free', indoor: 1 }), 'free indoor', label)).toBe(true)
    expect(matchesActivity(item({ cost: 'free', indoor: 0 }), 'free indoor', label)).toBe(false)
    expect(matchesActivity(item({ cost: 'paid', indoor: 1 }), 'free indoor', label)).toBe(false)
  })

  it('"free" alone matches only free items, across any category', () => {
    expect(matchesActivity(item({ cost: 'free', category: 'museum' }), 'free', label)).toBe(true)
    expect(matchesActivity(item({ cost: 'paid', category: 'museum' }), 'free', label)).toBe(false)
  })

  it('"indoor" alone (and "rainy") match only indoor items', () => {
    expect(matchesActivity(item({ indoor: 1 }), 'indoor', label)).toBe(true)
    expect(matchesActivity(item({ indoor: 0 }), 'indoor', label)).toBe(false)
    expect(matchesActivity(item({ indoor: 1 }), 'rainy', label)).toBe(true)
  })

  it('an unrecognized query with no field match returns false', () => {
    expect(matchesActivity(item({}), 'xyzzy', label)).toBe(false)
  })
})
