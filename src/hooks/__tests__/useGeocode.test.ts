import { describe, it, expect } from 'vitest'
import { metroViewbox, withinMetro } from '../useGeocode'
import { getMetro } from '@shared/metros'

const bay = getMetro('bay')!
const seattle = getMetro('seattle')!

describe('geocode scoping follows the current metro', () => {
  it('builds a viewbox from the metro, not a hardcoded California bbox', () => {
    // The bug: every metro searched inside CA, so address autocomplete
    // returned nothing at all on the 11 published non-CA metro pages.
    const box = metroViewbox(seattle).split(',').map(Number)
    const [[w, s], [e, n]] = seattle.viewportBounds
    expect(box[0]).toBeCloseTo(w - 0.15, 5)   // west
    expect(box[1]).toBeCloseTo(n + 0.15, 5)   // north
    expect(box[2]).toBeCloseTo(e + 0.15, 5)   // east
    expect(box[3]).toBeCloseTo(s - 0.15, 5)   // south
    expect(metroViewbox(bay)).not.toBe(metroViewbox(seattle))
  })

  it('accepts an in-metro address and rejects an out-of-metro one', () => {
    expect(withinMetro(seattle, 47.62, -122.35)).toBe(true)   // downtown Seattle
    expect(withinMetro(seattle, 37.77, -122.42)).toBe(false)  // San Francisco
    expect(withinMetro(bay, 37.77, -122.42)).toBe(true)
    expect(withinMetro(bay, 47.62, -122.35)).toBe(false)
  })

  it('does not reject a Washington address the old state filter would have dropped', () => {
    // Old post-filter required address.state === 'California'; every Seattle
    // result failed it regardless of coordinates.
    expect(withinMetro(seattle, 47.61, -122.20)).toBe(true)
  })
})
