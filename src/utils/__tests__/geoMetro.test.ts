import { describe, it, expect } from 'vitest'
import { getMetro } from '@shared/metros'
import { resolveGeoAction } from '../geoMetro'

const BAY = getMetro('bay')!
const SEATTLE = getMetro('seattle')!

// Real coordinates inside each metro's bbox — exercised against the real
// registry so the test tracks the actual published set, not a fixture.
const BAY_COORDS = { lat: 37.55, lng: -122.33 } // downtown-ish SF
const SEATTLE_COORDS = { lat: 47.6, lng: -122.33 }
const OPEN_OCEAN = { lat: 25.0, lng: -140.0 } // inside no metro bbox

describe('resolveGeoAction', () => {
  it('returns "here" when the coordinate is inside the current metro', () => {
    expect(resolveGeoAction(BAY, BAY_COORDS.lat, BAY_COORDS.lng)).toEqual({ kind: 'here' })
  })

  it('navigates to /cities/{slug} for a published metro that is not the current one', () => {
    // Bay is the only published metro today, so the navigate branch is only
    // reachable when the *current* metro isn't Bay. Using the (unpublished)
    // Seattle entry purely as the synthetic "current" exercises the branch
    // against the real registry — this is the path that goes live the moment a
    // second metro publishes.
    expect(resolveGeoAction(SEATTLE, BAY_COORDS.lat, BAY_COORDS.lng)).toEqual({
      kind: 'navigate',
      href: '/cities/bay-area',
    })
  })

  it('falls back when the coordinate lands in an unpublished metro', () => {
    // Detroit has data but has not passed promote-metro (#371) — surfacing it
    // would be its one leak. metroForCoords still claims the point, so the
    // published gate, not bbox membership, is what routes it to the fallback.
    // (Seattle graduated from this fixture at the wave launch, #362.)
    const detroit = getMetro('detroit')!
    expect(detroit.published).toBe(false)
    expect(resolveGeoAction(BAY, 42.33, -83.05)).toEqual({ kind: 'fallback' })
  })

  it('navigates to a wave metro now that it is published (#362)', () => {
    expect(SEATTLE.published).toBe(true)
    expect(resolveGeoAction(BAY, SEATTLE_COORDS.lat, SEATTLE_COORDS.lng)).toEqual({
      kind: 'navigate',
      href: '/cities/seattle',
    })
  })

  it('falls back when the coordinate is outside every metro bbox', () => {
    expect(resolveGeoAction(BAY, OPEN_OCEAN.lat, OPEN_OCEAN.lng)).toEqual({ kind: 'fallback' })
  })
})
