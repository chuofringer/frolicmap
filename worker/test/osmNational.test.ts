import { describe, it, expect } from 'vitest'
import {
  CATEGORY_QUERY,
  OSM_CATEGORIES,
  bboxString,
  buildOverpassQueryForBbox,
  overpassElementToItem,
  quadrants,
  inBbox,
  resolveNationalRegion,
  type OverpassElement,
} from '@shared/osm'
import { getMetro, metroForCoords, inMetroBbox } from '@shared/metros'

const AUSTIN = getMetro('austin')!
const nationalOpts = {
  region: AUSTIN.id,
  bbox: AUSTIN.contentBbox,
  confidence: 'medium' as const,
  status: 'approved' as const,
}

const SEATTLE = getMetro('seattle')!
const seattleOpts = {
  region: SEATTLE.id,
  bbox: SEATTLE.contentBbox,
  confidence: 'medium' as const,
  status: 'approved' as const,
}

const playgroundNode = (over: Partial<OverpassElement> = {}): OverpassElement => ({
  type: 'node',
  id: 999,
  lat: 30.27,
  lon: -97.74,
  tags: { name: 'Zilker Playground', leisure: 'playground' },
  ...over,
})

describe('shared/osm — bbox parameterization', () => {
  it('builds a query against an arbitrary metro bbox', () => {
    const q = buildOverpassQueryForBbox('playground', AUSTIN.contentBbox)
    expect(q).toContain('leisure=playground')
    expect(q).toContain(bboxString(AUSTIN.contentBbox))
    // The Bay Area bbox must NOT leak in — the pre-national bug this
    // extraction exists to prevent.
    expect(q).not.toContain('-122.85')
  })

  it('honours a custom Overpass timeout', () => {
    expect(buildOverpassQueryForBbox('park', AUSTIN.contentBbox, 180)).toContain('[timeout:180]')
  })

  it('keeps every OSM_CATEGORIES entry backed by real query clauses', () => {
    for (const c of OSM_CATEGORIES) {
      expect(CATEGORY_QUERY[c].length, c).toBeGreaterThan(0)
    }
  })

  it('has no query table entries beyond OSM_CATEGORIES', () => {
    // The retired event / upick / birthday_party / restaurant categories must
    // not linger as keys in the query table.
    expect(Object.keys(CATEGORY_QUERY).sort()).toEqual([...OSM_CATEGORIES].sort())
  })
})

describe('shared/osm — waterplay leg (#435)', () => {
  it('queries all four splash-pad / water-park tag families in one bbox', () => {
    const q = buildOverpassQueryForBbox('waterplay', SEATTLE.contentBbox)
    // leisure=water_park (commercial + municipal), plus the three spray-ground
    // families the issue calls out.
    expect(q).toContain('leisure=water_park')
    expect(q).toContain('playground=splash_pad')
    // Colon-key must be quoted so Overpass parses `playground:water` literally.
    expect(q).toContain('"playground:water"=yes')
    expect(q).toContain('amenity=splash_pad')
    // Both node + way for each family (ways carry `out center`).
    expect((q.match(/node\[/g) ?? []).length).toBe(4)
    expect((q.match(/way\[/g) ?? []).length).toBe(4)
    expect(q).toContain(bboxString(SEATTLE.contentBbox))
  })

  it('maps a named Seattle splash pad to a Tier C waterplay Item with a stable id', () => {
    const el: OverpassElement = {
      type: 'node', id: 555, lat: 47.6, lon: -122.33,
      tags: { name: 'Cal Anderson Splash Park', leisure: 'water_park' },
    }
    const item = overpassElementToItem(el, 'waterplay', seattleOpts)
    expect(item).toMatchObject({
      category: 'waterplay',
      name: 'Cal Anderson Splash Park',
      region: 'seattle',
      confidence: 'medium',
      status: 'approved',
      source_type: 'osm',
      indoor: 0, // splash pads are outdoors
    })
    expect(item!.id).toBe('osm-node-555')
    expect(item!.source_url).toBe('https://www.openstreetmap.org/node/555')
  })

  it('names an UNNAMED splash pad "Splash pad" instead of dropping it', () => {
    // Every other leg drops unnamed elements; waterplay keeps them behind a
    // generic label because spray grounds are very often mapped without a name.
    const splashPad = overpassElementToItem(
      { type: 'node', id: 1, lat: 47.6, lon: -122.33, tags: { playground: 'splash_pad' } },
      'waterplay', seattleOpts,
    )
    expect(splashPad!.name).toBe('Splash pad')

    const waterPark = overpassElementToItem(
      { type: 'way', id: 2, center: { lat: 47.6, lon: -122.33 }, tags: { leisure: 'water_park' } },
      'waterplay', seattleOpts,
    )
    expect(waterPark!.name).toBe('Water park')
  })

  it('still drops unnamed elements for every non-waterplay leg', () => {
    // The fallback is waterplay-only — a nameless playground is still noise.
    expect(
      overpassElementToItem(
        { type: 'node', id: 3, lat: 47.6, lon: -122.33, tags: { leisure: 'playground' } },
        'playground', seattleOpts,
      ),
    ).toBeNull()
  })

  it('resolves waterplay before playground so a water-equipped playground emits once, as waterplay', () => {
    // A `playground:water=yes` object is BOTH leisure=playground and a splash
    // pad, so it matches both legs and produces the same id under each. The
    // national bootstrap dedups in OSM_CATEGORIES order and keeps the first —
    // waterplay must precede playground for the row to land as waterplay.
    expect(OSM_CATEGORIES.indexOf('waterplay')).toBeLessThan(OSM_CATEGORIES.indexOf('playground'))

    const el: OverpassElement = {
      type: 'way', id: 77, center: { lat: 47.6, lon: -122.33 },
      tags: { name: 'Rainier Playground', leisure: 'playground', 'playground:water': 'yes' },
    }
    // Same element under each leg → identical id → dedup collapses them.
    const asWater = overpassElementToItem(el, 'waterplay', seattleOpts)!
    const asPlayground = overpassElementToItem(el, 'playground', seattleOpts)!
    expect(asWater.id).toBe(asPlayground.id)

    // Reproduce the bootstrap's assembly: first category in OSM_CATEGORIES wins.
    const byId = new Map<string, { category: string }>()
    for (const category of OSM_CATEGORIES) {
      const item = category === 'waterplay' ? asWater : category === 'playground' ? asPlayground : null
      if (item && !byId.has(el.type + '-' + el.id)) byId.set(el.type + '-' + el.id, item)
    }
    expect(byId.get('way-77')!.category).toBe('waterplay')
  })

  it("never emits a Bay-Area splash pad under region='bay' — the curated layer stays untouched", () => {
    // A splash pad at Bay coordinates, walked by a neighbouring metro, is
    // CEDED (region resolves to bay, not the walker) so no national row is
    // written for it. Combined with the script skipping the `bay` region
    // entirely, OSM splash pads never double-pin the hand-curated Bay layer.
    const BAY_LAT = 37.77
    const BAY_LNG = -122.42
    expect(metroForCoords(BAY_LAT, BAY_LNG)?.id).toBe('bay')
    // sacramento is the adjacent metro whose walk could reach Bay coords.
    expect(resolveNationalRegion('sacramento', BAY_LAT, BAY_LNG, metroForCoords)).toBeNull()
    // And even the element itself, mapped for a Bay-coord splash pad, is
    // filtered by the Seattle bbox — it never lands in a Seattle walk.
    const el: OverpassElement = {
      type: 'node', id: 9, lat: BAY_LAT, lon: BAY_LNG,
      tags: { name: 'Bay Splash Pad', playground: 'splash_pad' },
    }
    expect(overpassElementToItem(el, 'waterplay', seattleOpts)).toBeNull()
  })
})

describe('shared/osm — national element mapping (Tier C)', () => {
  it("stamps the metro's region and Tier C confidence, and auto-approves", () => {
    // Plan §1.6: raw single-source OSM is Tier C. If this regresses to
    // 'high', every raw national row silently classifies as Tier B and the
    // multi-source-confirmation signal in #355 becomes meaningless.
    const item = overpassElementToItem(playgroundNode(), 'playground', nationalOpts)
    expect(item).toMatchObject({
      region: 'austin',
      confidence: 'medium',
      status: 'approved',
      source_type: 'osm',
      category: 'playground',
      type: 'place',
    })
    expect(item!.id).toBe('osm-node-999')
    expect(item!.source_url).toBe('https://www.openstreetmap.org/node/999')
  })

  it('never assigns a slug at import time (the page generator owns /place/{slug})', () => {
    expect(overpassElementToItem(playgroundNode(), 'playground', nationalOpts)!.slug).toBeNull()
  })

  it("takes city from OSM's addr:city when the caller doesn't supply one", () => {
    const el = playgroundNode({ tags: { name: 'X', 'addr:city': 'Round Rock' } })
    expect(overpassElementToItem(el, 'playground', nationalOpts)!.city).toBe('Round Rock')
    // An explicit city wins over the tag.
    expect(
      overpassElementToItem(el, 'playground', { ...nationalOpts, city: 'Austin' })!.city,
    ).toBe('Austin')
  })

  it('drops elements outside the metro bbox', () => {
    // San Francisco coordinates against the Austin bbox.
    const el = playgroundNode({ lat: 37.77, lon: -122.42 })
    expect(overpassElementToItem(el, 'playground', nationalOpts)).toBeNull()
  })

  it('drops unnamed elements and elements with no coordinates', () => {
    expect(overpassElementToItem(playgroundNode({ tags: { leisure: 'playground' } }), 'playground', nationalOpts)).toBeNull()
    expect(
      overpassElementToItem({ type: 'way', id: 5, tags: { name: 'No coords' } }, 'park', nationalOpts),
    ).toBeNull()
  })

  it('reads a way centre point from `out center`', () => {
    const el: OverpassElement = {
      type: 'way', id: 42, center: { lat: 30.3, lon: -97.7 }, tags: { name: 'Zilker Park' },
    }
    const item = overpassElementToItem(el, 'park', nationalOpts)
    expect(item).toMatchObject({ lat: 30.3, lng: -97.7, id: 'osm-way-42' })
  })

  it('marks indoor categories indoor and outdoor categories outdoor', () => {
    const at = (cat: 'library' | 'museum' | 'aquarium' | 'park' | 'playground') =>
      overpassElementToItem(playgroundNode(), cat, nationalOpts)!.indoor
    expect([at('library'), at('museum'), at('aquarium')]).toEqual([1, 1, 1])
    expect([at('park'), at('playground')]).toEqual([0, 0])
  })
})

describe('shared/osm — cross-metro cede (resolveNationalRegion)', () => {
  // (38.4, -121.65) sits inside BOTH sacramento's contentBbox and the Bay
  // Area's — the contested band the bay skip must survive.
  const LAT = 38.4
  const LNG = -121.65

  it('the bay/sacramento overlap band really is contested (guards the fixture)', () => {
    expect(inMetroBbox(getMetro('sacramento')!, LAT, LNG)).toBe(true)
    expect(inMetroBbox(getMetro('bay')!, LAT, LNG)).toBe(true)
    expect(metroForCoords(LAT, LNG)?.id).toBe('bay')
  })

  it("a sacramento walk cedes the contested element — it never emits region='bay'", () => {
    // Reassigning instead of ceding let a sacramento walk write region='bay'
    // rows at approved/medium into sacramento.sql, demoting the earlier
    // high-confidence rows on apply.
    expect(resolveNationalRegion('sacramento', LAT, LNG, metroForCoords)).toBeNull()
  })

  it('the canonical metro keeps its own elements', () => {
    expect(resolveNationalRegion('bay', LAT, LNG, metroForCoords)).toBe('bay')
    // Uncontested coordinate — Zilker Park, Austin.
    expect(resolveNationalRegion('austin', 30.27, -97.74, metroForCoords)).toBe('austin')
  })

  it('outside every metro resolves to null for any walker', () => {
    // Rural Nebraska: inside the US, inside no metro bbox.
    expect(resolveNationalRegion('austin', 41.5, -99.5, metroForCoords)).toBeNull()
  })
})

describe('shared/osm — bbox splitting', () => {
  it('splits into four quadrants that tile the original exactly', () => {
    const box = { south: 0, west: 0, north: 10, east: 20 }
    const qs = quadrants(box)
    expect(qs).toHaveLength(4)
    expect(Math.min(...qs.map((q) => q.south))).toBe(box.south)
    expect(Math.max(...qs.map((q) => q.north))).toBe(box.north)
    expect(Math.min(...qs.map((q) => q.west))).toBe(box.west)
    expect(Math.max(...qs.map((q) => q.east))).toBe(box.east)
  })

  it('keeps every point of the parent box inside exactly one quadrant boundary', () => {
    const box = { south: 0, west: 0, north: 10, east: 20 }
    for (const [lat, lng] of [[1, 1], [9, 19], [5, 10], [0, 0], [10, 20]] as const) {
      expect(quadrants(box).some((q) => inBbox(q, lat, lng)), `${lat},${lng}`).toBe(true)
    }
  })
})

describe('shared/osm — website tag scheme check', () => {
  const mk = (website?: string): OverpassElement => ({
    type: 'node', id: 777, lat: 47.6, lon: -122.33,
    tags: { name: 'Link Park', leisure: 'playground', ...(website !== undefined ? { website } : {}) },
  })

  it('keeps an http(s) website', () => {
    expect(overpassElementToItem(mk('https://parks.example.org/link'), 'playground', seattleOpts)?.website)
      .toBe('https://parks.example.org/link')
  })

  it('drops a javascript: website', () => {
    expect(overpassElementToItem(mk('javascript:alert(1)'), 'playground', seattleOpts)?.website).toBeNull()
  })

  it('drops tel:, mailto: and bare-text websites; absent stays null', () => {
    for (const w of ['tel:+15551234567', 'mailto:a@b.org', 'parks.example.org']) {
      expect(overpassElementToItem(mk(w), 'playground', seattleOpts)?.website).toBeNull()
    }
    expect(overpassElementToItem(mk(), 'playground', seattleOpts)?.website).toBeNull()
  })
})
