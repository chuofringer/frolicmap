import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  bboxAround,
  parseOverpassResponse,
  splitBboxNS,
  bboxHeightDeg,
  TALL_BBOX_SPLIT_THRESHOLD_DEG,
  resolvePhotoCandidateFromTags,
} from '@shared/osm'

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

  it('confirms a metro-sized tall bbox is past the tall-bbox split threshold', () => {
    const tall = { south: 36.89, west: -122.85, north: 38.6, east: -121.57 }
    expect(bboxHeightDeg(tall)).toBeGreaterThan(TALL_BBOX_SPLIT_THRESHOLD_DEG)
  })
})
