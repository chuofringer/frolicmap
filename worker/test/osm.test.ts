import { describe, it, expect, vi, afterEach } from 'vitest'
import { overpassElementToItem, buildOverpassQuery, fetchOverpass } from '../src/ingest/osm'
import {
  haversineMeters,
  bboxAround,
  parseOverpassResponse,
  splitBboxNS,
  bboxHeightDeg,
  TALL_BBOX_SPLIT_THRESHOLD_DEG,
  resolvePhotoCandidateFromTags,
} from '@shared/osm'
import { CONTENT_BBOX } from '../src/utils/bbox'

describe('haversineMeters / bboxAround (#217 overlap-dedup geometry)', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters({ lat: 37.5, lng: -122.3 }, { lat: 37.5, lng: -122.3 })).toBeCloseTo(0, 3)
  })

  it('measures ~15m for a small lat offset', () => {
    // 0.00013° lat ≈ 14.5m at this latitude (111,320 m/degree).
    const d = haversineMeters({ lat: 37.5, lng: -122.3 }, { lat: 37.50013, lng: -122.3 })
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(20)
  })

  it('bboxAround contains a point known to be within the radius', () => {
    const box = bboxAround(37.5, -122.3, 30)
    const near = { lat: 37.50013, lng: -122.3 }
    expect(near.lat).toBeGreaterThanOrEqual(box.south)
    expect(near.lat).toBeLessThanOrEqual(box.north)
    expect(near.lng).toBeGreaterThanOrEqual(box.west)
    expect(near.lng).toBeLessThanOrEqual(box.east)
  })
})

describe('OSM ingestion', () => {
  it('builds a query for playgrounds in the content bbox', () => {
    const q = buildOverpassQuery('playground')
    expect(q).toContain('leisure=playground')
    expect(q).toContain('36.89,-122.85,38.6,-121.57')
  })

  it('parses a playground node into an Item with correct defaults', () => {
    const element = {
      type: 'node' as const,
      id: 12345,
      lat: 37.77,
      lon: -122.42,
      tags: {
        name: 'Mission Dolores Playground',
        leisure: 'playground',
        'addr:street': '19th St',
        'addr:city': 'San Francisco',
      },
    }
    const item = overpassElementToItem(element, 'playground')
    expect(item).toMatchObject({
      type: 'place',
      category: 'playground',
      name: 'Mission Dolores Playground',
      lat: 37.77,
      lng: -122.42,
      source_type: 'osm',
      status: 'pending',
      confidence: 'medium',
    })
    expect(item!.id).toMatch(/^osm-node-12345$/)
    expect(item!.source_url).toBe('https://www.openstreetmap.org/node/12345')
  })

  it('parses a "way" with a center-point (returned by out center)', () => {
    const element = {
      type: 'way' as const,
      id: 999,
      center: { lat: 37.5, lon: -122.3 },
      tags: { name: 'Burlingame Library', amenity: 'library' },
    }
    const item = overpassElementToItem(element, 'library')
    expect(item?.lat).toBe(37.5)
    expect(item?.lng).toBe(-122.3)
    expect(item?.id).toBe('osm-way-999')
  })

  it('queries zoos + petting zoos on the zoo leg, and keeps them OFF the aquarium leg (#323)', () => {
    const zoo = buildOverpassQuery('zoo')
    expect(zoo).toContain('tourism=zoo')
    expect(zoo).toContain('zoo=petting_zoo')
    // tourism=zoo used to live on the aquarium leg (the Barron Park Donkeys
    // mis-categorization) — the split must be total or re-ingest would keep
    // flipping the same rows back and forth between the two categories.
    const aquarium = buildOverpassQuery('aquarium')
    expect(aquarium).toContain('tourism=aquarium')
    expect(aquarium).not.toContain('tourism=zoo')
  })

  it('parses a petting zoo as an outdoor zoo Item (zoo is not indoor-by-default)', () => {
    const element = {
      type: 'node' as const,
      id: 2869144130,
      lat: 37.4,
      lon: -122.13,
      tags: { name: 'Barron Park Donkeys', tourism: 'zoo', zoo: 'petting_zoo' },
    }
    const item = overpassElementToItem(element, 'zoo')
    expect(item).toMatchObject({
      category: 'zoo',
      indoor: 0,
      status: 'pending',
      source_type: 'osm',
    })
    expect(item!.id).toBe('osm-node-2869144130')
  })

  it('rejects elements without a name', () => {
    const element = { type: 'node' as const, id: 1, lat: 37, lon: -122, tags: { leisure: 'playground' } }
    expect(overpassElementToItem(element, 'playground')).toBeNull()
  })

  it('rejects elements outside the content bbox', () => {
    const element = { type: 'node' as const, id: 1, lat: 40.7, lon: -74.0, tags: { name: 'NYC park', leisure: 'park' } }
    expect(overpassElementToItem(element, 'park')).toBeNull()
  })

  // #220: park rows flagged has_playground=1 from an on-site `playground=yes`
  // tag are how the playground filter finds parks whose playground was never
  // separately mapped as its own leisure=playground node.
  it('flags a park with playground=yes as has_playground', () => {
    const element = {
      type: 'way' as const,
      id: 42,
      center: { lat: 37.4, lon: -122.1 },
      tags: { name: 'Mitchell Park', leisure: 'park', playground: 'yes' },
    }
    const item = overpassElementToItem(element, 'park')
    expect(item?.has_playground).toBe(1)
  })

  it('leaves has_playground null for a park with no playground tag', () => {
    const element = {
      type: 'way' as const,
      id: 43,
      center: { lat: 37.4, lon: -122.1 },
      tags: { name: 'Rinconada Park', leisure: 'park' },
    }
    const item = overpassElementToItem(element, 'park')
    expect(item?.has_playground).toBeNull()
  })

  it('leaves has_playground null for a standalone playground node (attribute is park-only)', () => {
    const element = {
      type: 'node' as const,
      id: 44,
      lat: 37.4,
      lon: -122.1,
      tags: { name: 'Some Playground', leisure: 'playground', playground: 'yes' },
    }
    const item = overpassElementToItem(element, 'playground')
    expect(item?.has_playground).toBeNull()
  })
})

describe('resolvePhotoCandidateFromTags (#299 ingest pass-through)', () => {
  it('accepts a wikimedia_commons File: tag', () => {
    expect(resolvePhotoCandidateFromTags({ wikimedia_commons: 'File:Some Park.jpg' }))
      .toEqual({ kind: 'commons', title: 'File:Some Park.jpg' })
  })

  it('rejects a wikimedia_commons Category: tag (ambiguous which photo)', () => {
    expect(resolvePhotoCandidateFromTags({ wikimedia_commons: 'Category:Some Park' })).toBeNull()
  })

  it('accepts an image= Commons file-page URL', () => {
    expect(resolvePhotoCandidateFromTags({ image: 'https://commons.wikimedia.org/wiki/File:Some_Park.jpg' }))
      .toEqual({ kind: 'commons', title: 'File:Some_Park.jpg' })
  })

  it('accepts an image= raw upload.wikimedia.org URL', () => {
    expect(resolvePhotoCandidateFromTags({ image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg' }))
      .toEqual({ kind: 'commons', title: 'File:Some_Park.jpg' })
  })

  it('rejects an image= tag pointing at a non-Commons host', () => {
    expect(resolvePhotoCandidateFromTags({ image: 'https://example.com/photo.jpg' })).toBeNull()
  })

  it('returns null with no relevant tags', () => {
    expect(resolvePhotoCandidateFromTags({ name: 'X' })).toBeNull()
    expect(resolvePhotoCandidateFromTags(undefined)).toBeNull()
  })
})

describe('overpassElementToItem photo candidate pass-through (#299)', () => {
  it('never writes photo_url directly — stashes the candidate in attributes instead', () => {
    const element = {
      type: 'node' as const,
      id: 501,
      lat: 37.77,
      lon: -122.42,
      tags: { name: 'Dolores Park', leisure: 'park', wikimedia_commons: 'File:Dolores Park.jpg' },
    }
    const item = overpassElementToItem(element, 'park')
    expect(item?.photo_url).toBeNull()
    expect(item?.photo_attribution).toBeNull()
    expect(item?.attributes).toEqual({ photo_candidate: { kind: 'commons', title: 'File:Dolores Park.jpg' } })
  })

  it('leaves attributes null when no license-safe photo tag is present', () => {
    const element = {
      type: 'node' as const,
      id: 502,
      lat: 37.77,
      lon: -122.42,
      tags: { name: 'Some Park', leisure: 'park', image: 'https://example.com/photo.jpg' },
    }
    const item = overpassElementToItem(element, 'park')
    expect(item?.attributes).toBeNull()
  })
})

// #253 ("North Bay data coverage gap"): the Bay cron used to trust ANY
// HTTP-200 Overpass body as a complete result. Overpass answers 200 with a
// `remark` field (partial or empty `elements`) when a query timed out or ran
// out of memory mid-execution — a truncated run can silently drop elements
// anywhere in the box, with no guarantee the north edge (Sonoma/Napa/Solano/
// Marin) survives. These tests cover the detection + one-level N/S-split
// retry added to close that gap.
describe('parseOverpassResponse (#253 truncation detection)', () => {
  it('reports no remark for a normal complete response', () => {
    const parsed = parseOverpassResponse({
      version: 0.6,
      elements: [{ type: 'node', id: 1, lat: 37, lon: -122, tags: {} }],
    })
    expect(parsed.remark).toBeNull()
    expect(parsed.elements).toHaveLength(1)
  })

  it('flags a remark field as a truncated/partial response', () => {
    const parsed = parseOverpassResponse({
      version: 0.6,
      remark: 'runtime error: Query timed out in "query" at line 4 after 25 seconds.',
      elements: [{ type: 'node', id: 1, lat: 37, lon: -122, tags: {} }],
    })
    expect(parsed.remark).toMatch(/timed out/)
    // The partial elements are still surfaced to the caller — it's the
    // caller's job to decide whether to trust them (it doesn't, here).
    expect(parsed.elements).toHaveLength(1)
  })

  it('treats a missing `elements` array as empty, not a crash', () => {
    const parsed = parseOverpassResponse({ version: 0.6, remark: 'out of memory' })
    expect(parsed.elements).toEqual([])
    expect(parsed.remark).toBe('out of memory')
  })

  it('tolerates a non-object body', () => {
    expect(parseOverpassResponse(null)).toEqual({ elements: [], remark: null })
    expect(parseOverpassResponse(undefined)).toEqual({ elements: [], remark: null })
  })
})

describe('splitBboxNS / bboxHeightDeg (#253)', () => {
  it('splits a bbox into a north half and a south half with no gap or overlap', () => {
    const bbox = { south: 36.89, west: -122.85, north: 38.6, east: -121.57 }
    const [north, south] = splitBboxNS(bbox)
    expect(north.south).toBe(south.north)
    expect(north.north).toBe(bbox.north)
    expect(south.south).toBe(bbox.south)
    // East/west untouched — this is a north/south split only.
    expect(north.west).toBe(bbox.west)
    expect(north.east).toBe(bbox.east)
    expect(south.west).toBe(bbox.west)
    expect(south.east).toBe(bbox.east)
  })

  it('confirms the Bay Area content bbox is past the tall-bbox split threshold', () => {
    expect(bboxHeightDeg(CONTENT_BBOX)).toBeGreaterThan(TALL_BBOX_SPLIT_THRESHOLD_DEG)
  })
})

describe('fetchOverpass (#253 truncation → N/S split retry)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns elements straight through on a normal complete response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: 0.6,
      elements: [{ type: 'node', id: 1, lat: 37.5, lon: -122.3, tags: { name: 'X', leisure: 'playground' } }],
    }))))
    const elements = await fetchOverpass('playground')
    expect(elements).toHaveLength(1)
  })

  it('retries as two N/S queries when the full-bbox query is truncated, and merges the halves', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) {
        // The single full-height query comes back truncated.
        return new Response(JSON.stringify({
          version: 0.6,
          remark: 'runtime error: Query timed out in "query" at line 4 after 25 seconds.',
          elements: [],
        }))
      }
      // Both split halves succeed — one node each, distinguishable by id.
      return new Response(JSON.stringify({
        version: 0.6,
        elements: [{
          type: 'node', id: call, lat: 37.5, lon: -122.3,
          tags: { name: `Node ${call}`, leisure: 'playground' },
        }],
      }))
    }))
    const elements = await fetchOverpass('playground')
    expect(elements).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(3) // 1 full-bbox attempt + 2 split halves
  })

  it('throws (surfacing the remark) when a split half is STILL truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: 0.6,
      remark: 'runtime error: Query ran out of memory in "query" at line 4.',
      elements: [],
    }))))
    await expect(fetchOverpass('playground')).rejects.toThrow(/truncated/i)
  })

  // Overpass's public instance usage policy asks clients not to hammer it
  // with parallel requests — and a remark that just fired is itself a sign
  // the instance may be under load, so the split retry is exactly the wrong
  // moment to add concurrency. Assert the two split-half fetches never
  // overlap in flight, rather than only checking the total call count.
  it('fetches the two split halves sequentially, never overlapping in flight', async () => {
    let call = 0
    let inFlight = 0
    let maxInFlight = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) {
        return new Response(JSON.stringify({
          version: 0.6,
          remark: 'runtime error: Query timed out in "query" at line 4 after 25 seconds.',
          elements: [],
        }))
      }
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return new Response(JSON.stringify({
        version: 0.6,
        elements: [{
          type: 'node', id: call, lat: 37.5, lon: -122.3,
          tags: { name: `Node ${call}`, leisure: 'playground' },
        }],
      }))
    }))
    const elements = await fetchOverpass('playground')
    expect(elements).toHaveLength(2)
    expect(maxInFlight).toBe(1)
  })
})

describe('fetchOverpass backoff on 429/504 (#686)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const ok = () => new Response(JSON.stringify({ version: 0.6, elements: [] }))

  it('backs off on 429 (honouring Retry-After, capped) then succeeds', async () => {
    const sleep = vi.fn(async () => {})
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) return new Response('', { status: 429, headers: { 'retry-after': '7' } })
      if (call === 2) return new Response('', { status: 429, headers: { 'retry-after': '600' } })
      return ok()
    }))
    await expect(fetchOverpass('playground', { sleep })).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([7000, 20000])
  })

  it('uses exponential delay without Retry-After and gives up after bounded attempts on 504', async () => {
    const sleep = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 504 })))
    await expect(fetchOverpass('playground', { sleep })).rejects.toMatchObject({
      message: 'Overpass 504',
      kind: 'http',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10000])
  })

  it('does not retry other HTTP errors', async () => {
    const sleep = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })))
    await expect(fetchOverpass('playground', { sleep })).rejects.toThrow('Overpass 400')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails fast once the shared run budget cannot cover the next delay', async () => {
    const sleep = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    const budget = { backoffMs: 7_000 }
    await expect(fetchOverpass('playground', { sleep, budget })).rejects.toMatchObject({
      message: 'Overpass 429',
      kind: 'http',
    })
    // 5s fits, 10s does not: one sleep, two requests, budget debited.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(budget.backoffMs).toBe(2_000)
  })
})
