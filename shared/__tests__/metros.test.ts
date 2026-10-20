import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import {
  METROS,
  RESERVED_SLUGS,
  DEFAULT_REGION,
  getMetro,
  getMetroBySlug,
  isValidRegion,
  isPublishedRegion,
  publishedMetros,
  waveMetros,
  inMetroBbox,
  metroForCoords,
  nearestPublishedMetro,
  haversineKm,
  NEAREST_METRO_MAX_KM,
  overpassBboxFor,
  timezoneForCoords,
  timezoneForRegion,
} from '../metros'

describe('metro registry', () => {
  it('has 50 metros', () => {
    expect(METROS).toHaveLength(50)
  })

  it('has unique ids and unique slugs', () => {
    const ids = METROS.map((m) => m.id)
    const slugs = METROS.map((m) => m.slug)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('flags exactly the 12 September wave metros', () => {
    expect(waveMetros().map((m) => m.id).sort()).toEqual(
      [
        'atlanta', 'boston', 'chicago', 'dallas', 'houston', 'los-angeles',
        'miami', 'new-york', 'philadelphia', 'phoenix', 'seattle', 'washington',
      ].sort(),
    )
  })

  it('publishes the Bay Area + the 12-metro wave + austin and orlando', () => {
    // Expansion is PAUSED (2026-10, #675): do not add a metro here until the
    // pause is lifted.
    // This assertion is the publish ledger: promote-metro edits land here
    // deliberately, so an accidental flag flip fails CI. Wave launched via
    // promote-metro --wave after all 12 passed the QA harness (#362).
    // austin + orlando published 2026-07-25 (#498/#502) after their
    // same-day static-places bootstraps passed qa-metro (#506).
    expect(publishedMetros().map((m) => m.id).sort()).toEqual(
      [
        'bay',
        'atlanta', 'boston', 'chicago', 'dallas', 'houston', 'los-angeles',
        'miami', 'new-york', 'philadelphia', 'phoenix', 'seattle', 'washington',
        'austin', 'orlando',
      ].sort(),
    )
  })
})

// The reserved-namespace guard. A metro slug that collides with a top-level
// path would shadow it at the edge, where a static file always beats the SPA
// catch-all (plan §3.2) — a metro slugged `terms` would take over the legal
// page on deploy. This fails CI instead.
describe('slug safety', () => {
  it('never collides with a reserved top-level namespace', () => {
    const reserved = new Set<string>(RESERVED_SLUGS)
    const collisions = METROS.filter((m) => reserved.has(m.slug)).map((m) => m.slug)
    expect(collisions).toEqual([])
  })

  it('never collides with a filename in public/ (read from disk, so the list cannot drift)', () => {
    // Both the bare name and the extensionless stem matter: Pages serves
    // `robots.txt` at `/robots.txt`, and a metro slugged `robots` would
    // still be a confusing neighbour, so both forms are treated as taken.
    const publicDir = path.resolve(__dirname, '../../public')
    const taken = new Set<string>()
    for (const entry of readdirSync(publicDir)) {
      taken.add(entry.toLowerCase())
      taken.add(entry.replace(/\.[^.]+$/, '').toLowerCase())
    }
    const collisions = METROS.filter((m) => taken.has(m.slug)).map((m) => m.slug)
    expect(collisions).toEqual([])
  })

  it('uses lowercase hyphenated form with no slashes or trailing punctuation', () => {
    const bad = METROS.filter((m) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(m.slug)).map((m) => m.slug)
    expect(bad).toEqual([])
  })

  it('keeps id and slug identical everywhere except the Bay Area', () => {
    const diverging = METROS.filter((m) => m.id !== m.slug)
    expect(diverging.map((m) => [m.id, m.slug])).toEqual([['bay', 'bay-area']])
  })
})

describe('bbox sanity', () => {
  it('orders every content bbox south<north and west<east', () => {
    for (const m of METROS) {
      const { south, west, north, east } = m.contentBbox
      expect(south, `${m.id} south<north`).toBeLessThan(north)
      expect(west, `${m.id} west<east`).toBeLessThan(east)
    }
  })

  it('keeps every content bbox within continental-US-plus bounds', () => {
    for (const m of METROS) {
      const { south, west, north, east } = m.contentBbox
      expect(south, `${m.id} south`).toBeGreaterThan(18)
      expect(north, `${m.id} north`).toBeLessThan(50)
      expect(west, `${m.id} west`).toBeGreaterThan(-160)
      expect(east, `${m.id} east`).toBeLessThan(-66)
    }
  })

  it('contains each metro initial view inside its own content bbox', () => {
    for (const m of METROS) {
      expect(inMetroBbox(m, m.initialView.latitude, m.initialView.longitude), m.id).toBe(true)
    }
  })

  it('pads every viewport to at least the content bbox', () => {
    for (const m of METROS) {
      const [[west, south], [east, north]] = m.viewportBounds
      expect(west, `${m.id} viewport west`).toBeLessThanOrEqual(m.contentBbox.west)
      expect(south, `${m.id} viewport south`).toBeLessThanOrEqual(m.contentBbox.south)
      expect(east, `${m.id} viewport east`).toBeGreaterThanOrEqual(m.contentBbox.east)
      expect(north, `${m.id} viewport north`).toBeGreaterThanOrEqual(m.contentBbox.north)
    }
  })
})

// #351 ships "zero visible change" to production. The Bay Area's three
// geometry values moved out of `src/config/constants.ts` and
// `worker/src/utils/bbox.ts` into the registry — if any digit shifted in the
// move, the production map would pan or zoom differently on next deploy.
// These are the pre-national values, pinned.
describe('Bay Area geometry is byte-identical to the pre-national constants', () => {
  const bay = getMetro('bay')!

  it('keeps the content bbox', () => {
    expect(bay.contentBbox).toEqual({ south: 36.89, west: -122.85, north: 38.6, east: -121.57 })
  })

  it('keeps the viewport bounds', () => {
    expect(bay.viewportBounds).toEqual([
      [-123.5, 36.5],
      [-121.0, 38.6],
    ])
  })

  it('keeps the initial view state', () => {
    expect(bay.initialView).toEqual({ longitude: -122.33, latitude: 37.55, zoom: 10 })
  })

  it('is the region every pre-national row defaults to', () => {
    expect(DEFAULT_REGION).toBe('bay')
    expect(getMetro(DEFAULT_REGION)).toBeDefined()
  })
})

describe('lookups', () => {
  it('resolves by id and by slug', () => {
    expect(getMetro('dallas')?.label).toBe('Dallas–Fort Worth')
    expect(getMetroBySlug('bay-area')?.id).toBe('bay')
    // The Bay Area's id is not a slug and its slug is not an id — the one
    // place the two namespaces diverge, so check both directions miss.
    expect(getMetroBySlug('bay')).toBeUndefined()
    expect(getMetro('bay-area')).toBeUndefined()
  })

  it('validates region ids for untrusted input', () => {
    expect(isValidRegion('bay')).toBe(true)
    expect(isValidRegion('new-york')).toBe(true)
    expect(isValidRegion('bay-area')).toBe(false)
    expect(isValidRegion('atlantis')).toBe(false)
    expect(isValidRegion('')).toBe(false)
  })

  it('separates "is a real metro" from "is live to the public"', () => {
    // The gap between these two is the entire state promote-metro (#357)
    // transitions out of: data imported, pages generated, not yet launched.
    expect(isValidRegion('detroit')).toBe(true)
    expect(isPublishedRegion('detroit')).toBe(false)
    expect(isPublishedRegion('bay')).toBe(true)
    expect(isPublishedRegion('new-york')).toBe(true)
    expect(isPublishedRegion('atlantis')).toBe(false)
  })

  it('maps coordinates to a metro, and outside-everything to undefined', () => {
    // Ferry Building, SF.
    expect(metroForCoords(37.7955, -122.3937)?.id).toBe('bay')
    // Central Park, NYC.
    expect(metroForCoords(40.7829, -73.9654)?.id).toBe('new-york')
    // Mid-Atlantic ocean — inside no metro.
    expect(metroForCoords(35.0, -40.0)).toBeUndefined()
    // Rural Nebraska — inside the US, inside no metro bbox.
    expect(metroForCoords(41.5, -99.5)).toBeUndefined()
  })

  it('emits Overpass bbox strings in south,west,north,east order', () => {
    expect(overpassBboxFor(getMetro('bay')!)).toBe('36.89,-122.85,38.6,-121.57')
  })

  it('every metro carries an IANA timezone Intl can resolve', () => {
    for (const m of METROS) {
      expect(m.timezone, `${m.id} needs a timezone`).toBeTruthy()
      // Throws (failing the test with the metro named) on a bad zone id.
      expect(
        () => new Intl.DateTimeFormat('en-US', { timeZone: m.timezone }),
        `${m.id}: '${m.timezone}' is not a resolvable zone`,
      ).not.toThrow()
    }
  })

  it('assigns the expected zone per metro (spot checks across all five zones)', () => {
    expect(getMetro('bay')?.timezone).toBe('America/Los_Angeles')
    expect(getMetro('seattle')?.timezone).toBe('America/Los_Angeles')
    expect(getMetro('new-york')?.timezone).toBe('America/New_York')
    expect(getMetro('chicago')?.timezone).toBe('America/Chicago')
    expect(getMetro('phoenix')?.timezone).toBe('America/Phoenix')
    expect(getMetro('denver')?.timezone).toBe('America/Denver')
    // The classic gotchas: Eastern-time Indiana/Kentucky/Michigan metros,
    // Central-time Tennessee.
    expect(getMetro('indianapolis')?.timezone).toBe('America/New_York')
    expect(getMetro('louisville')?.timezone).toBe('America/New_York')
    expect(getMetro('detroit')?.timezone).toBe('America/New_York')
    expect(getMetro('nashville')?.timezone).toBe('America/Chicago')
  })

  it('resolves timezones by region id and by coordinate', () => {
    expect(timezoneForRegion('new-york')).toBe('America/New_York')
    expect(timezoneForRegion('atlantis')).toBeUndefined()
    expect(timezoneForCoords(40.7829, -73.9654)).toBe('America/New_York') // Central Park
    expect(timezoneForCoords(37.7955, -122.3937)).toBe('America/Los_Angeles') // Ferry Building
    expect(timezoneForCoords(35.0, -40.0)).toBeUndefined() // open ocean
  })
})

describe('nearestPublishedMetro', () => {
  it('returns the published metro whose contentBbox contains the point', () => {
    // Ferry Building, SF.
    expect(nearestPublishedMetro(37.7955, -122.3937)?.id).toBe('bay')
    // Tacoma sits inside Seattle's bbox.
    expect(nearestPublishedMetro(47.25, -122.44)?.id).toBe('seattle')
  })

  it('falls back to the nearest published centre within 150 km', () => {
    // Baltimore is outside Washington's bbox but ~55 km from its centre.
    expect(inMetroBbox(getMetro('washington')!, 39.29, -76.61)).toBe(false)
    expect(nearestPublishedMetro(39.29, -76.61)?.id).toBe('washington')
  })

  it('returns null beyond 150 km of every published centre', () => {
    // Rural Nebraska, mid-Atlantic, and the equator/prime meridian.
    expect(nearestPublishedMetro(41.5, -99.5)).toBeNull()
    expect(nearestPublishedMetro(35.0, -40.0)).toBeNull()
    expect(nearestPublishedMetro(0, 0)).toBeNull()
  })

  it('never returns an unpublished metro, even when the point is inside its bbox', () => {
    expect(getMetro('detroit')?.published).toBe(false)
    // Downtown Detroit: inside Detroit's bbox, >150 km from any published centre.
    expect(nearestPublishedMetro(42.33, -83.05)).toBeNull()
  })

  it('rejects non-finite input', () => {
    expect(nearestPublishedMetro(NaN, -122)).toBeNull()
    expect(nearestPublishedMetro(37, Infinity)).toBeNull()
  })

  it('haversineKm is sane and the radius is 150', () => {
    expect(NEAREST_METRO_MAX_KM).toBe(150)
    expect(haversineKm(37, -122, 37, -122)).toBe(0)
    // One degree of latitude is ~111 km.
    expect(haversineKm(37, -122, 38, -122)).toBeGreaterThan(110)
    expect(haversineKm(37, -122, 38, -122)).toBeLessThan(112)
  })
})
