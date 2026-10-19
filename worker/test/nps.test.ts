import { describe, it, expect } from 'vitest'
import {
  DESIGNATION_CATEGORY, npsId, parseCoord, truncateDescription, physicalAddress,
  npsParkToItem, collect,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/nps.mjs'
import {
  buildImportSql, buildUpsertSet, PRESERVE_CURATOR_STATUS, IMPORT_COLUMNS,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/seedSql.mjs'
import { metroForCoords } from '@shared/metros'
import fixture from './fixtures/nps-parks.json'

const TIER = { status: 'approved' as const, confidence: 'medium' as const }
type Park = Record<string, unknown>
const PARKS = (fixture as { data: Park[] }).data
const park = (code: string): Park => {
  const p = PARKS.find((x) => x.parkCode === code)
  if (!p) throw new Error(`fixture missing parkCode ${code}`)
  return p
}
// Skip Bay by default, matching every other importer.
const DEFAULT = { ...TIER, skipRegions: new Set(['bay']) }

describe('NPS field mapping', () => {
  it('maps a park unit into an Item with a deterministic nps-<parkCode> id', () => {
    const { row } = npsParkToItem(park('gate'), metroForCoords, DEFAULT)
    expect(row).toMatchObject({
      id: 'nps-gate',
      type: 'place',
      category: 'park',
      source_type: 'nps',
      region: 'new-york',
      city: 'Staten Island',
      indoor: 0,
      confidence: 'medium',
      status: 'approved',
    })
    expect(row.name).toBe('Gateway National Recreation Area')
  })

  it('points website and source_url at the park\'s official nps.gov page (canonical-source policy)', () => {
    const { row } = npsParkToItem(park('gate'), metroForCoords, DEFAULT)
    expect(row.website).toBe('https://www.nps.gov/gate/index.htm')
    expect(row.source_url).toBe('https://www.nps.gov/gate/index.htm')
  })

  it('falls back to the deterministic canonical URL when the payload omits url', () => {
    const noUrl = { ...park('gate'), url: '' }
    const { row } = npsParkToItem(noUrl, metroForCoords, DEFAULT)
    expect(row.source_url).toBe('https://www.nps.gov/gate/index.htm')
  })

  it('builds the address from the Physical address, never the Mailing PO box', () => {
    const { row } = npsParkToItem(park('gate'), metroForCoords, DEFAULT)
    expect(row.address).toBe('210 New York Avenue, Staten Island, NY, 10305')
    expect(row.address).not.toContain('PO Box')
  })

  it('carries designation and states into attributes', () => {
    const { row } = npsParkToItem(park('gate'), metroForCoords, DEFAULT)
    expect(row.attributes).toEqual({ designation: 'National Recreation Area', states: 'NJ,NY' })
  })

  it('keeps a description and truncates long ones at a word boundary', () => {
    const short = npsParkToItem(park('goga'), metroForCoords, { ...TIER, skipRegions: new Set() }).row
    expect(short.description).toContain('Golden Gate')

    const long = npsParkToItem(park('gate'), metroForCoords, { ...DEFAULT, descMaxLen: 40 }).row
    expect(long.description.length).toBeLessThanOrEqual(41) // 40 + ellipsis
    expect(long.description.endsWith('…')).toBe(true)
    expect(truncateDescription('one two three', 100)).toBe('one two three')
    expect(truncateDescription('', 100)).toBeNull()
  })

  it('normalises parkCode into the same id shape as the other importers', () => {
    expect(npsId('gate')).toBe('nps-gate')
    expect(npsId('WRST')).toBe('nps-wrst')
    expect(npsId('  odd / code!  ')).toBe('nps-odd-code')
    expect(npsId('')).toBeNull()
    expect(npsId(null)).toBeNull()
  })
})

describe('NPS category mapping + conservative skips', () => {
  it('maps only the unambiguous park designations to park', () => {
    for (const d of ['National Park', 'National Recreation Area', 'National Seashore',
      'National Lakeshore', 'National Preserve', 'National Park & Preserve']) {
      expect(DESIGNATION_CATEGORY[d.toLowerCase()]).toBe('park')
    }
  })

  it('maps a scenic trail unit to hiking', () => {
    expect(DESIGNATION_CATEGORY['national scenic trail']).toBe('hiking')
    const { row } = npsParkToItem(park('appa'), metroForCoords, DEFAULT)
    expect(row).toMatchObject({ id: 'nps-appa', category: 'hiking', region: 'boston' })
  })

  it('skips historic sites, monuments and historic trails — tallied by designation', () => {
    // Skipping is correct per #383, not a bug. A National Historic Trail is a
    // commemorative route, not one hikeable path, so it is NOT mapped to hiking.
    expect(npsParkToItem(park('stli'), metroForCoords, DEFAULT).skipped).toBe('designation: National Monument')
    expect(npsParkToItem(park('frdo'), metroForCoords, DEFAULT).skipped).toBe('designation: National Historic Site')
    expect(npsParkToItem(park('trte'), metroForCoords, DEFAULT).skipped).toBe('designation: National Historic Trail')
    // These skips fire on designation before the bbox check, even though stli
    // (NYC), frdo (DC) and trte (Memphis) all sit inside a metro bbox.
    expect(DESIGNATION_CATEGORY['national monument']).toBeUndefined()
    expect(DESIGNATION_CATEGORY['national historical park']).toBeUndefined()
    expect(DESIGNATION_CATEGORY['national historic trail']).toBeUndefined()
  })

  it('skips a blank designation with a legible reason', () => {
    expect(npsParkToItem({ ...park('gate'), designation: '' }, metroForCoords, DEFAULT).skipped)
      .toBe('designation: (blank)')
  })
})

describe('NPS bbox filtering + contested-coord ceding', () => {
  it('defers a unit outside every metro bbox (plan §1.1)', () => {
    expect(npsParkToItem(park('yell'), metroForCoords, DEFAULT).skipped).toBe('outside every metro bbox')
  })

  it('cedes a contested coordinate to the higher-population metro via metroForCoords', () => {
    // (39.15, -76.82) sits inside BOTH the Washington and Baltimore bboxes.
    // Washington is earlier in the population-ordered registry, so it wins —
    // no by-hand reassignment here.
    const { row } = npsParkToItem(park('cont'), metroForCoords, DEFAULT)
    expect(row.region).toBe('washington')
  })

  it('skips the Bay region by default so the curated Bay park layer is not double-pinned', () => {
    expect(npsParkToItem(park('goga'), metroForCoords, DEFAULT).skipped).toBe('bay region (curated separately)')
  })

  it('emits Bay rows when the skip set is cleared (--include-bay)', () => {
    const { row } = npsParkToItem(park('goga'), metroForCoords, { ...TIER, skipRegions: new Set() })
    expect(row).toMatchObject({ id: 'nps-goga', region: 'bay', category: 'park' })
  })

  it('skips a unit with no point coordinate', () => {
    expect(npsParkToItem(park('noco'), metroForCoords, DEFAULT).skipped).toBe('no coordinates')
    expect(parseCoord('')).toBeNull()
    expect(parseCoord('0')).toBeNull()
    expect(parseCoord('40.5')).toBe(40.5)
  })

  it('rejects an out-of-range coordinate loudly', () => {
    const bad = { ...park('gate'), latitude: '999', longitude: '-73.9' }
    expect(npsParkToItem(bad, metroForCoords, DEFAULT).skipped).toBe('coordinates out of range')
  })

  it('picks a Physical address only when present', () => {
    expect(physicalAddress([{ type: 'Mailing', line1: 'PO Box 1', city: 'X' }])).toEqual({ line: null, city: null })
    expect(physicalAddress(undefined)).toEqual({ line: null, city: null })
  })
})

describe('NPS end-to-end over the fixture', () => {
  const { rows, skipped } = collect(
    PARKS.map((p) => npsParkToItem(p, metroForCoords, DEFAULT)),
  )

  it('emits exactly the park/trail units inside a non-Bay metro bbox', () => {
    expect(rows.map((r: { id: string }) => r.id).sort())
      .toEqual(['nps-appa', 'nps-cont', 'nps-fiis', 'nps-gate'])
  })

  it('tallies skips by reason, including per-designation counts', () => {
    expect(skipped).toMatchObject({
      'designation: National Monument': 1,
      'designation: National Historic Site': 1,
      'designation: National Historic Trail': 1,
      'outside every metro bbox': 1,
      'no coordinates': 1,
      'bay region (curated separately)': 1,
    })
  })
})

describe('NPS SQL emission (shared seedSql shape)', () => {
  const { rows } = collect(PARKS.map((p) => npsParkToItem(p, metroForCoords, DEFAULT)))
  const sql = buildImportSql(rows, { setClause: buildUpsertSet(), headerLines: ['-- NPS import (#383)'] })

  it('emits the shared column order and one INSERT for a small set', () => {
    expect(sql).toContain(`INSERT INTO items (${IMPORT_COLUMNS.join(',')}) VALUES`)
    expect((sql.match(/INSERT INTO items/g) ?? []).length).toBe(1)
  })

  it('UPSERTs on id and preserves curator status (approved/rejected/archived survive)', () => {
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET')
    expect(sql).toContain(PRESERVE_CURATOR_STATUS)
    expect(sql).toContain("items.status IN ('rejected','archived','approved')")
  })

  it('writes source_type nps and no SQL-level transaction', () => {
    expect(sql).toContain("'nps'")
    expect(sql).toContain("'nps-gate'")
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/)
  })
})
