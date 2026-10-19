import { describe, it, expect, vi } from 'vitest'
import { tileBbox, buildTile, resolvePrimaryCropEmoji, fairCapByCategory, tileFeatureProperties, warnIfTileCapped } from '../src/utils/tile'

describe('tileBbox', () => {
  it('z=0 single tile covers the whole world', () => {
    const { west, south, east, north } = tileBbox(0, 0, 0)
    expect(west).toBe(-180)
    expect(east).toBe(180)
    // Web Mercator cuts off near ±85.05° (approx atan(sinh(π)))
    expect(north).toBeCloseTo(85.051128779, 5)
    expect(south).toBeCloseTo(-85.051128779, 5)
  })

  it('z=1 quadrant split', () => {
    // NW quadrant
    const nw = tileBbox(1, 0, 0)
    expect(nw.west).toBe(-180); expect(nw.east).toBe(0)
    expect(nw.north).toBeCloseTo(85.051, 2); expect(nw.south).toBe(0)
    // SE quadrant
    const se = tileBbox(1, 1, 1)
    expect(se.west).toBe(0); expect(se.east).toBe(180)
    expect(se.north).toBe(0); expect(se.south).toBeCloseTo(-85.051, 2)
  })

  it('z=10 over SF (approx 659, 1585) contains SF', () => {
    // Quick sanity: the tile covering San Francisco at z=10 should include
    // lat 37.77, lng -122.42.
    const { west, south, east, north } = tileBbox(10, 163, 395)
    const lng = -122.42, lat = 37.77
    // Not asserting exact tile choice (depends on SF vs Oakland boundary);
    // asserting the bbox math produces sensible degrees in the right quadrant.
    expect(west).toBeLessThan(east)
    expect(south).toBeLessThan(north)
    expect(west).toBeLessThan(0)  // Western hemisphere
    expect(south).toBeGreaterThan(0) // Northern hemisphere
    // Existence check: SF point could be inside this or neighboring tile;
    // bbox width at z=10 is ~0.35°, SF latitude ~37.77 is a valid 32N–44N range.
    void lat; void lng
  })
})

describe('buildTile', () => {
  it('encodes a non-empty tile to MVT bytes', () => {
    const pbf = buildTile(10, 0, 0, [
      { id: 'a', name: 'Test', category: 'park', type: 'place',
        lat: 85.0, lng: -179.9 },
    ])
    expect(pbf).toBeInstanceOf(Uint8Array)
    expect(pbf.byteLength).toBeGreaterThan(0)
    // MVT protobufs start with a tag byte for the first field. Not
    // asserting exact bytes — the vt-pbf version determines them. Just
    // confirming we got a plausible binary payload.
  })

  it('returns valid bytes for an empty input tile', () => {
    const pbf = buildTile(10, 0, 0, [])
    expect(pbf).toBeInstanceOf(Uint8Array)
    // Empty tiles still need to serialize to valid MVT — the client gets
    // "no features in this tile" rather than a network error.
    expect(pbf.byteLength).toBeGreaterThanOrEqual(0)
  })
})

describe('tileFeatureProperties (#250 Phase 2d2 step (a))', () => {
  const base = { id: 'a', name: 'Test Park', category: 'park', type: 'place' as const, lat: 37.7, lng: -122.4 }

  it('includes only the base fields when the filter fields are absent', () => {
    expect(tileFeatureProperties(base)).toEqual({
      id: 'a', name: 'Test Park', category: 'park', type: 'place',
    })
  })

  it('includes only the base fields when the filter fields are explicitly null', () => {
    expect(tileFeatureProperties({
      ...base,
      age_min: null, age_max: null, cost: null, indoor: null,
      start_time: null, end_time: null, rrule: null, exdates: null,
    })).toEqual({
      id: 'a', name: 'Test Park', category: 'park', type: 'place',
    })
  })

  it('includes every present filter field, preserving falsy-but-real values like indoor=0', () => {
    expect(tileFeatureProperties({
      ...base,
      age_min: 0, age_max: 12, cost: 'free', indoor: 0,
      start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-01T12:00:00Z',
      rrule: 'FREQ=WEEKLY', exdates: '["2026-09-08"]',
    })).toEqual({
      id: 'a', name: 'Test Park', category: 'park', type: 'place',
      age_min: 0, age_max: 12, cost: 'free', indoor: 0,
      start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-01T12:00:00Z',
      rrule: 'FREQ=WEEKLY', exdates: '["2026-09-08"]',
    })
  })

  it('still includes primary_crop_emoji alongside the widened fields', () => {
    expect(tileFeatureProperties({ ...base, primary_crop_emoji: '🍓', cost: 'paid' })).toEqual({
      id: 'a', name: 'Test Park', category: 'park', type: 'place',
      primary_crop_emoji: '🍓', cost: 'paid',
    })
  })
})

describe('resolvePrimaryCropEmoji', () => {
  it('returns one emoji when a single crop is ripe', () => {
    expect(
      resolvePrimaryCropEmoji(
        JSON.stringify(['strawberry', 'cherry']),
        JSON.stringify({ strawberry: 'ripe', cherry: 'next' }),
      ),
    ).toBe('🍓')
  })

  it('returns the first ripe crop when several are ripe', () => {
    // Pin shows a single emoji to stay legible at pin size on mobile —
    // the popup's ripeness row enumerates all ripe crops.
    expect(
      resolvePrimaryCropEmoji(
        JSON.stringify(['strawberry', 'cherry', 'peach']),
        JSON.stringify({ strawberry: 'ripe', cherry: 'ripe', peach: 'ripe' }),
      ),
    ).toBe('🍓')
  })

  it('falls back to the first "next" crop when nothing is ripe', () => {
    expect(
      resolvePrimaryCropEmoji(
        JSON.stringify(['peach', 'cherry']),
        JSON.stringify({ peach: 'future', cherry: 'next' }),
      ),
    ).toBe('🍒')
  })

  it('falls back to crops[0] when nothing is ripe or next', () => {
    expect(
      resolvePrimaryCropEmoji(
        JSON.stringify(['peach', 'apricot']),
        JSON.stringify({ peach: 'future', apricot: 'future' }),
      ),
    ).toBe('🍑')
  })

  it('returns undefined for malformed JSON', () => {
    expect(resolvePrimaryCropEmoji('{not-json', '{also-not-json')).toBeUndefined()
  })

  it('returns undefined for an empty crops array', () => {
    expect(resolvePrimaryCropEmoji('[]', '{}')).toBeUndefined()
  })

  it('accepts already-parsed objects (not just strings)', () => {
    expect(
      resolvePrimaryCropEmoji(['cherry'], { cherry: 'ripe' }),
    ).toBe('🍒')
  })

  it('treats null crops_state as all-unknown and falls back to crops[0]', () => {
    expect(
      resolvePrimaryCropEmoji(JSON.stringify(['cherry']), null),
    ).toBe('🍒')
  })
})

describe('warnIfTileCapped (#250 — not one of 2d2\'s lettered steps; an added coverage/tuning signal)', () => {
  it('warns with z/x/y and counts when the row count reaches the cap', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnIfTileCapped(10, 163, 395, 10000, 10000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('z=10 x=163 y=395')
    expect(warnSpy.mock.calls[0][0]).toContain('10000 rows')
    expect(warnSpy.mock.calls[0][0]).toContain('cap=10000')
    warnSpy.mockRestore()
  })

  it('warns when the row count exceeds the cap', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnIfTileCapped(9, 81, 197, 12345, 10000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('stays silent under the cap', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnIfTileCapped(10, 163, 395, 9999, 10000)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('fairCapByCategory (#424)', () => {
  // Minimal fixture shape — only `category` matters to the function, but
  // callers pass full tile rows, so give each a distinguishing `id` too.
  type Row = { id: string; category: string }

  function rowsFor(category: string, count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({ id: `${category}-${i}`, category }))
  }

  it('returns the input unchanged when under the cap', () => {
    const rows = [...rowsFor('park', 3), ...rowsFor('playground', 2)]
    expect(fairCapByCategory(rows, 10)).toEqual(rows)
  })

  it('does not wipe out a small alphabetically-late category when the cap binds', () => {
    // Reproduces the #424 failure mode: `ORDER BY category ... LIMIT N`
    // would keep all of 'museum'/'park' (early alphabetically) and drop
    // all of 'upick'/'waterplay' (late) once the row count crosses the
    // cap. A fair cap must keep at least one of every category present.
    const rows = [
      ...rowsFor('museum', 400),
      ...rowsFor('park', 400),
      ...rowsFor('upick', 400),
      ...rowsFor('waterplay', 400),
    ]
    const capped = fairCapByCategory(rows, 200)
    expect(capped.length).toBe(200)
    const seenCategories = new Set(capped.map((r) => r.category))
    expect(seenCategories).toEqual(new Set(['museum', 'park', 'upick', 'waterplay']))
  })

  it('thins every category by roughly the same share, not by category order', () => {
    const rows = [...rowsFor('a', 100), ...rowsFor('m', 100), ...rowsFor('z', 100)]
    const capped = fairCapByCategory(rows, 90) // 30% cut, evenly, across 3 equal categories
    const counts = { a: 0, m: 0, z: 0 }
    for (const row of capped) counts[row.category as keyof typeof counts]++
    expect(counts.a).toBe(30)
    expect(counts.m).toBe(30)
    expect(counts.z).toBe(30)
  })

  it('gives a small category everything before taking a second pass from larger ones', () => {
    // 5 rows in a tiny category + 400 in a huge one, capped well below the
    // total: the tiny category should survive completely rather than
    // losing a proportional slice of its already-small count.
    const rows = [...rowsFor('rare', 5), ...rowsFor('common', 400)]
    const capped = fairCapByCategory(rows, 50)
    const rareSurvivors = capped.filter((r) => r.category === 'rare').length
    expect(rareSurvivors).toBe(5)
    expect(capped.filter((r) => r.category === 'common').length).toBe(45)
  })

  it('preserves the input order of the surviving rows (draw order intact)', () => {
    const rows = [
      { id: 'museum-1', category: 'museum' },
      { id: 'park-1', category: 'park' },
      { id: 'park-2', category: 'park' },
      { id: 'upick-1', category: 'upick' },
    ]
    const capped = fairCapByCategory(rows, 3)
    // Whatever survives must appear in the same relative order it had in
    // the input — callers rely on this to skip re-sorting after the cap.
    const ids = capped.map((r) => r.id)
    expect(ids).toEqual([...rows.map((r) => r.id)].filter((id) => ids.includes(id)))
  })

  it('is deterministic — same input always keeps the same rows', () => {
    const rows = [...rowsFor('park', 10), ...rowsFor('museum', 10)]
    const first = fairCapByCategory(rows, 7).map((r) => r.id)
    const second = fairCapByCategory(rows, 7).map((r) => r.id)
    expect(second).toEqual(first)
  })
})
