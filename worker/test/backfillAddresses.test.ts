import { describe, it, expect } from 'vitest'
import {
  cacheKey, formatAddress, buildUpdateStatement, chunk, assertInputRows,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/backfillAddresses.mjs'

// Fixtures modelled on the documented Nominatim `reverse` (jsonv2,
// addressdetails=1) response shape. NEVER call the live service.
const resp = (address: Record<string, unknown>) => ({
  place_id: 1,
  licence: 'Data © OpenStreetMap contributors, ODbL 1.0.',
  osm_type: 'way',
  lat: '37.76890',
  lon: '-122.48690',
  address,
})

describe('formatAddress', () => {
  it('composes a full "house_number road, city" address', () => {
    const out = formatAddress(resp({
      house_number: '501',
      road: 'Stanyan Street',
      city: 'San Francisco',
      state: 'California',
      postcode: '94117',
    }))
    expect(out).toBe('501 Stanyan Street, San Francisco')
  })

  it('composes "road, city" when there is no house number', () => {
    const out = formatAddress(resp({ road: 'John F Kennedy Drive', city: 'San Francisco' }))
    expect(out).toBe('John F Kennedy Drive, San Francisco')
  })

  it('returns just the street when there is no locality of any kind', () => {
    const out = formatAddress(resp({ house_number: '1', road: 'Main Street' }))
    expect(out).toBe('1 Main Street')
  })

  it('returns null (SKIP) when the response has no road — never fabricates', () => {
    expect(formatAddress(resp({ city: 'San Francisco', county: 'San Francisco County' }))).toBeNull()
    expect(formatAddress(resp({ road: '   ' }))).toBeNull()
    expect(formatAddress({})).toBeNull()
    expect(formatAddress(null)).toBeNull()
    expect(formatAddress({ address: null })).toBeNull()
  })

  it('falls back through the city hierarchy: city → town → village → suburb', () => {
    expect(formatAddress(resp({ road: 'A St', city: 'Cityton', town: 'Townton' }))).toBe('A St, Cityton')
    expect(formatAddress(resp({ road: 'A St', town: 'Townton', village: 'Vilton' }))).toBe('A St, Townton')
    expect(formatAddress(resp({ road: 'A St', village: 'Vilton', suburb: 'Subton' }))).toBe('A St, Vilton')
    expect(formatAddress(resp({ road: 'A St', suburb: 'Subton' }))).toBe('A St, Subton')
  })

  it('trims stray whitespace on the parts', () => {
    expect(formatAddress(resp({ house_number: ' 22 ', road: ' Elm St ', city: ' Ada ' }))).toBe('22 Elm St, Ada')
  })
})

describe('buildUpdateStatement', () => {
  it('emits an idempotent UPDATE that only touches address + updated_at', () => {
    const sql = buildUpdateStatement('osm-node-42', '1 Main St, Ada', '2026-07-19T00:00:00.000Z')
    expect(sql).toBe(
      "UPDATE items SET address='1 Main St, Ada', updated_at='2026-07-19T00:00:00.000Z' " +
      "WHERE id='osm-node-42' AND (address IS NULL OR address='');",
    )
  })

  it('carries the idempotent WHERE guard so a curated address is never clobbered', () => {
    const sql = buildUpdateStatement('id-1', 'X', 'T')
    expect(sql).toContain("(address IS NULL OR address='')")
  })

  it("touches no column other than address and updated_at", () => {
    const sql = buildUpdateStatement('id-1', 'X St', 'T')
    // The SET clause is exactly these two assignments.
    expect(sql.match(/SET (.*?) WHERE/)?.[1]).toBe("address='X St', updated_at='T'")
  })

  it('escapes single quotes in street names so the statement cannot break out', () => {
    const sql = buildUpdateStatement("osm-1", "1 O'Farrell Street, San Francisco", 'T')
    expect(sql).toContain("address='1 O''Farrell Street, San Francisco'")
  })

  it('escapes single quotes in the id too', () => {
    const sql = buildUpdateStatement("weird'id", 'X', 'T')
    expect(sql).toContain("WHERE id='weird''id'")
  })
})

describe('cacheKey', () => {
  it('rounds lat,lng to 5 decimal places', () => {
    expect(cacheKey(37.768901234, -122.486899999)).toBe('37.76890,-122.48690')
  })

  it('accepts string coords (as exported from D1) and still rounds', () => {
    expect(cacheKey('37.1', '-122.2')).toBe('37.10000,-122.20000')
  })

  it('two nearby coords collapse to the same key (free repeat lookups)', () => {
    expect(cacheKey(37.123456, -122.5)).toBe(cacheKey(37.123457, -122.5))
  })
})

describe('chunk', () => {
  it('splits into fixed-size batches with a possibly-short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('returns [] for an empty array', () => {
    expect(chunk([], 500)).toEqual([])
  })
  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow()
  })
})

describe('assertInputRows', () => {
  it('accepts well-formed national rows', () => {
    const rows = [{ id: 'osm-1', lat: 37.7, lng: -122.4, region: 'sf' }]
    expect(assertInputRows(rows)).toBe(rows)
  })

  it("rejects any region='bay' row — the national job must never touch the Bay metro", () => {
    expect(() => assertInputRows([{ id: 'osm-1', lat: 37, lng: -122, region: 'bay' }]))
      .toThrow(/bay/)
  })

  it('rejects rows missing an id', () => {
    expect(() => assertInputRows([{ lat: 37, lng: -122 }])).toThrow(/id/)
  })

  it('rejects rows with non-numeric coords', () => {
    expect(() => assertInputRows([{ id: 'x', lat: 'nope', lng: -122 }])).toThrow(/lat\/lng/)
  })

  it('rejects a non-array input', () => {
    expect(() => assertInputRows({} as never)).toThrow(/array/)
  })
})
