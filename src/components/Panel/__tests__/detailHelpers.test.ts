import { describe, it, expect } from 'vitest'
import { deriveGoodToKnow, parseOpenUntil, formatDistanceMi, websiteFor, venueWallNow, reportMailto } from '../detailHelpers'

describe('deriveGoodToKnow', () => {
  it('returns nothing for null/empty attributes (never invents facts)', () => {
    expect(deriveGoodToKnow(null)).toEqual([])
    expect(deriveGoodToKnow({})).toEqual([])
  })

  it('maps recognised positive keys to ✓ facts', () => {
    const facts = deriveGoodToKnow({ restrooms: true, stroller_friendly: 'yes', picnic_tables: 1 })
    expect(facts).toEqual([
      { label: 'Restrooms nearby', state: 'yes' },
      { label: 'Stroller friendly', state: 'yes' },
      { label: 'Picnic tables', state: 'yes' },
    ])
  })

  it('marks partial/limited values as ◐', () => {
    expect(deriveGoodToKnow({ shade: 'partial' })).toEqual([{ label: 'Shade', state: 'partial' }])
  })

  it('skips negative and unrecognised values', () => {
    expect(deriveGoodToKnow({ restrooms: false, stroller: 'no', picnic_tables: 0, foo: 'bar' })).toEqual([])
  })
})

describe('parseOpenUntil', () => {
  const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

  it('parses a daily 12-hour range and returns the closing time when open', () => {
    expect(parseOpenUntil('Open daily · 7:00 AM – 6:00 PM', at(12))).toBe('6 PM')
  })

  it('parses a bare 24-hour range when currently open', () => {
    expect(parseOpenUntil('07:00-18:00', at(9))).toBe('6 PM')
  })

  it('returns null when currently closed', () => {
    expect(parseOpenUntil('07:00-18:00', at(20))).toBeNull()
  })

  it('returns null for per-day schedules it cannot confidently reduce to one range', () => {
    expect(parseOpenUntil('Mo-Fr 09:00-17:00; Sa 10:00-14:00', at(12))).toBeNull()
  })

  it('returns null for missing / unparseable hours', () => {
    expect(parseOpenUntil(null, at(12))).toBeNull()
    expect(parseOpenUntil('by appointment', at(12))).toBeNull()
  })
})

describe('formatDistanceMi', () => {
  it('returns null without an origin', () => {
    expect(formatDistanceMi(null, -122, 37)).toBeNull()
  })

  // #645: this helper only formats the Near-me case now — the map-center
  // origin renders the venue's city instead (useDetailData), never a
  // "from map center" distance.
  it('formats to one decimal as a from-you distance', () => {
    expect(formatDistanceMi([-122.4, 37.77], -122.4, 37.77)).toBe('0.0 mi from you')
  })
})

describe('websiteFor', () => {
  it('prefers the curated website when set', () => {
    expect(websiteFor({ website: 'https://hiller.org', source_url: 'https://x.example', source_type: 'nps' }))
      .toBe('https://hiller.org')
  })

  it('falls back to source_url for canonical-source rows (manual, NPS)', () => {
    expect(websiteFor({ website: null, source_url: 'https://www.hiller.org/event', source_type: 'nps' }))
      .toBe('https://www.hiller.org/event')
    expect(websiteFor({ website: null, source_url: 'https://venue.example', source_type: 'manual' }))
      .toBe('https://venue.example')
  })

  it('never promotes a data-catalog source_url (OSM, IMLS, ParkServe)', () => {
    expect(websiteFor({ website: null, source_url: 'https://www.openstreetmap.org/node/1', source_type: 'osm' })).toBeNull()
    expect(websiteFor({ website: null, source_url: 'https://www.imls.gov/x', source_type: 'imls' })).toBeNull()
    expect(websiteFor({ website: null, source_url: 'https://www.tpl.org/parkserve', source_type: 'parkserve' })).toBeNull()
  })

  it('still shows an OSM website tag when the mapper provided one', () => {
    expect(websiteFor({ website: 'https://parks.smcgov.org', source_url: 'https://www.openstreetmap.org/way/2', source_type: 'osm' }))
      .toBe('https://parks.smcgov.org')
  })

  it('returns null with no detail or no urls at all', () => {
    expect(websiteFor(null)).toBeNull()
    expect(websiteFor(undefined)).toBeNull()
    expect(websiteFor({ website: null, source_url: null, source_type: 'manual' })).toBeNull()
  })
})

describe('venueWallNow', () => {
  it('reads the venue clock, not the viewer clock', () => {
    // 2026-07-01T20:00:00Z is 13:00 in San Francisco (PDT) and 16:00 in New York.
    const instant = new Date('2026-07-01T20:00:00Z')
    expect(venueWallNow(37.77, -122.42, instant).getHours()).toBe(13)
    expect(venueWallNow(40.71, -74.0, instant).getHours()).toBe(16)
  })

  it('falls back to the viewer clock outside every metro', () => {
    const instant = new Date('2026-07-01T20:00:00Z')
    expect(venueWallNow(0, 0, instant).getTime()).toBe(instant.getTime())
  })
})

describe('reportMailto', () => {
  it('builds a mailto with the item id in the subject and name + URL in the body', () => {
    const href = reportMailto('osm-node-1', "Koret Children's Playground", 'https://frolicmap.app/?item=osm-node-1')
    expect(href.startsWith('mailto:frolicmap.official@gmail.com?')).toBe(true)
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(params.get('subject')).toBe('frolicmap report: osm-node-1')
    const body = params.get('body') ?? ''
    expect(body).toContain("Koret Children's Playground")
    expect(body).toContain('https://frolicmap.app/?item=osm-node-1')
  })

  it('percent-encodes characters that would break the query string', () => {
    const href = reportMailto('a&b', 'Fish & Chips #1', 'https://frolicmap.app/?item=a&b')
    expect(href).not.toContain(' ')
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('subject')).toBe('frolicmap report: a&b')
  })
})
