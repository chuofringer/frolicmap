import { describe, it, expect } from 'vitest'
import {
  CATEGORY_FLOORS, DEDUP_RATE_MAX,
  checkCoordsInBbox, checkCentroidPileups, checkCategoryFloors, checkNameQuality,
  checkDedupRate, checkTierBCoverage, checkAttribution, checkPageThresholds, runQa,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/qaChecks.mjs'
import { getMetro } from '@shared/metros'

const SEATTLE = getMetro('seattle')!

type Row = Record<string, unknown>
const row = (over: Row = {}): Row => ({
  id: 'r1', name: 'Green Lake Park', category: 'park',
  lat: 47.68, lng: -122.33, confidence: 'medium',
  source_url: 'https://example.com', ...over,
})

/** A metro-shaped fixture that clears every floor. */
const healthy = () => [
  // A tenth of the parks are Tier B, clearing the coverage floor the way a
  // real deduped metro does (the shipped wave runs 25-35%).
  ...Array.from({ length: 400 }, (_, i) => row({
    id: `p${i}`, name: `Park ${i}`, lat: 47.3 + i * 0.001,
    confidence: i % 10 === 0 ? 'high' : 'medium',
  })),
  ...Array.from({ length: 50 }, (_, i) => row({ id: `l${i}`, name: `Library ${i}`, category: 'library', lat: 47.4 + i * 0.001 })),
  ...Array.from({ length: 20 }, (_, i) => row({ id: `m${i}`, name: `Museum ${i}`, category: 'museum', lat: 47.5 + i * 0.001, confidence: 'high' })),
]

describe('coordinate checks', () => {
  it('passes when every row is inside the metro bbox', () => {
    expect(checkCoordsInBbox(SEATTLE, [row()]).status).toBe('pass')
  })

  it('fails on a row outside the bbox and names it', () => {
    const r = checkCoordsInBbox(SEATTLE, [row(), row({ id: 'stray', lat: 30.2, lng: -97.7 })])
    expect(r.status).toBe('fail')
    expect(r.evidence[0]).toContain('stray')
  })

  it('fails on a coordinate pile-up — the geocoder-centroid failure', () => {
    // The 2026-04 aggregator cleanup rejected 89 rows that had all been
    // geocoded to a city centre. Detected generically rather than from a
    // hardcoded list, so it works in metros nobody has hand-audited.
    const pile = Array.from({ length: 20 }, (_, i) => row({ id: `c${i}`, lat: 47.6062, lng: -122.3321 }))
    const r = checkCentroidPileups(SEATTLE, pile)
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/geocoder centroid/)
  })

  it('tolerates a handful of rows sharing a coordinate', () => {
    const few = Array.from({ length: 5 }, (_, i) => row({ id: `c${i}`, lat: 47.6062, lng: -122.3321 }))
    expect(checkCentroidPileups(SEATTLE, few).status).toBe('pass')
  })
})

describe('category floors', () => {
  it('passes a healthy metro', () => {
    expect(checkCategoryFloors(SEATTLE, healthy()).status).toBe('pass')
  })

  it('fails when an importer clearly dropped a category', () => {
    const noLibraries = healthy().filter((r) => r.category !== 'library')
    const res = checkCategoryFloors(SEATTLE, noLibraries)
    expect(res.status).toBe('fail')
    expect(res.detail).toContain('library 0/40')
  })

  it('sets no playground floor, because the gap is upstream not ours', () => {
    // OSM drops ~95% of playgrounds for having no name (#354). A floor would
    // fail every metro for a known upstream gap rather than a pipeline fault.
    expect(CATEGORY_FLOORS.playground).toBeUndefined()
  })
})

describe('name quality', () => {
  it('fails on a missing name', () => {
    expect(checkNameQuality(SEATTLE, [row({ name: '' })]).status).toBe('fail')
  })

  it('warns on embedded newlines — they break SQL comments, titles and JSON-LD', () => {
    // Exactly what ParkServe shipped: "Sullivan Oval Park And Playground\n\nPark".
    const r = checkNameQuality(SEATTLE, [row({ name: 'Sullivan Oval Park\n\nPark' })])
    expect(r.status).toBe('warn')
  })

  it('passes clean names', () => {
    expect(checkNameQuality(SEATTLE, [row()]).status).toBe('pass')
  })
})

describe('dedup + tier checks', () => {
  it('warns when the dedup rate is implausibly low', () => {
    expect(checkDedupRate(SEATTLE, healthy(), 0).status).toBe('warn')
  })

  it('fails when the matcher is over-merging', () => {
    const rows = healthy()
    const archived = Math.ceil(rows.length * (DEDUP_RATE_MAX + 0.1) / (1 - DEDUP_RATE_MAX - 0.1))
    expect(checkDedupRate(SEATTLE, rows, archived).status).toBe('fail')
  })

  it('passes a realistic rate', () => {
    expect(checkDedupRate(SEATTLE, healthy(), 150).status).toBe('pass')
  })

  it('warns when almost nothing reached Tier B', () => {
    // The page generator only gives standalone pages to multi-source-confirmed
    // places, so a metro with none produces a near-empty site.
    const noTierB = healthy().map((r) => ({ ...r, confidence: 'medium' }))
    expect(checkTierBCoverage(SEATTLE, noTierB).status).toBe('warn')
  })
})

describe('attribution + page thresholds', () => {
  it('fails a row with no source_url (ODbL requires OSM attribution)', () => {
    expect(checkAttribution(SEATTLE, [row({ source_url: null })]).status).toBe('fail')
  })

  it('fails a metro too small for a hub page', () => {
    expect(checkPageThresholds(SEATTLE, [row(), row({ id: 'b' })]).status).toBe('fail')
  })

  it('passes a metro with enough places and an eligible category', () => {
    expect(checkPageThresholds(SEATTLE, healthy()).status).toBe('pass')
  })
})

describe('roll-up verdict', () => {
  it('passes a healthy metro and allows publish', () => {
    const r = runQa(SEATTLE, healthy(), { archivedCount: 150 })
    expect(r.canPublish).toBe(true)
    expect(r.verdict).toBe('PASS')
  })

  it('blocks publish on any failure', () => {
    const r = runQa(SEATTLE, [...healthy(), row({ id: 'stray', lat: 30.2, lng: -97.7 })], { archivedCount: 150 })
    expect(r.canPublish).toBe(false)
    expect(r.verdict).toBe('FAIL')
  })

  it('lets warnings through — they inform the human signing the report', () => {
    // Plan §4A.3: a human signs off on the report, not on rows. A warning is
    // information for that signature, not a gate.
    const r = runQa(SEATTLE, healthy(), { archivedCount: 0 })
    expect(r.warned).toBeGreaterThan(0)
    expect(r.canPublish).toBe(true)
    expect(r.verdict).toBe('PASS (with warnings)')
  })
})
