import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain-JS script libs, no type declarations by design.
import { parseCsv } from '../scripts/lib/csv.mjs'
import {
  PLS_COLUMNS, MDF_COLUMNS, MDF_CATEGORY_BY_DISCIPLINE, PLS_VISITABLE_OUTLET_TYPES,
  assertColumns, cleanSentinel, parseCoord, libraryRowToItem, museumRowToItem,
  buildSeedSql, collect, normalizeWebsite,
  // @ts-expect-error — plain-JS script libs, no type declarations by design.
} from '../scripts/lib/imls.mjs'
import { metroForCoords } from '@shared/metros'

const TIER = { status: 'approved', confidence: 'medium' }

// Austin coordinates — inside the austin metro bbox.
const AUSTIN_LAT = 30.2672
const AUSTIN_LNG = -97.7431

const libRec = (over: Record<string, string> = {}) => ({
  [PLS_COLUMNS.fscskey]: 'TX0015',
  [PLS_COLUMNS.seq]: '002',
  [PLS_COLUMNS.name]: 'FAULK CENTRAL LIBRARY',
  [PLS_COLUMNS.address]: '800 Guadalupe St',
  [PLS_COLUMNS.city]: 'AUSTIN',
  [PLS_COLUMNS.state]: 'TX',
  [PLS_COLUMNS.zip]: '78701',
  [PLS_COLUMNS.phone]: '5129747400',
  [PLS_COLUMNS.outletType]: 'CE',
  [PLS_COLUMNS.lat]: String(AUSTIN_LAT),
  [PLS_COLUMNS.lng]: String(AUSTIN_LNG),
  ...over,
})

const musRec = (over: Record<string, string> = {}) => ({
  [MDF_COLUMNS.id]: '8412345',
  DISCIPL: 'CMU',
  [MDF_COLUMNS.name]: 'Thinkery',
  [MDF_COLUMNS.legalName]: 'Austin Childrens Museum',
  [MDF_COLUMNS.street]: '1830 Simond Ave',
  [MDF_COLUMNS.city]: 'Austin',
  [MDF_COLUMNS.state]: 'TX',
  [MDF_COLUMNS.zip]: '78723',
  [MDF_COLUMNS.phone]: '5124695200',
  [MDF_COLUMNS.website]: 'thinkeryaustin.org',
  [MDF_COLUMNS.lat]: String(AUSTIN_LAT),
  [MDF_COLUMNS.lng]: String(AUSTIN_LNG),
  ...over,
})

describe('CSV parser', () => {
  it('handles quoted fields with embedded commas — the failure a split(",") would cause', () => {
    const { headers, rows } = parseCsv('A,B\n"Smith Library, Main Branch",TX\n')
    expect(headers).toEqual(['A', 'B'])
    expect(rows).toEqual([{ A: 'Smith Library, Main Branch', B: 'TX' }])
  })

  it('handles escaped quotes, embedded newlines and CRLF', () => {
    const { rows } = parseCsv('A,B\r\n"He said ""hi""","line1\nline2"\r\n')
    expect(rows[0].A).toBe('He said "hi"')
    expect(rows[0].B).toBe('line1\nline2')
  })

  it('strips a UTF-8 BOM so the first header name is clean', () => {
    expect(parseCsv('﻿STABR,FSCSKEY\nTX,TX0015\n').headers[0]).toBe('STABR')
  })

  it('ignores blank trailing lines and files with no terminating newline', () => {
    expect(parseCsv('A,B\n1,2\n\n').rows).toEqual([{ A: '1', B: '2' }])
    expect(parseCsv('A,B\n1,2').rows).toEqual([{ A: '1', B: '2' }])
  })
})

describe('column guard', () => {
  it('throws listing the actual headers when an expected column is missing', () => {
    // IMLS renames fields between survey years. Without this, a renamed
    // column reads as undefined for all 17K rows and the importer emits
    // 17K rows of NULL instead of failing.
    expect(() => assertColumns(['STABR', 'FSCSKEY'], PLS_COLUMNS, 'PLS_FY23_Outlet.csv'))
      .toThrow(/missing expected column\(s\).*LIBNAME/s)
    expect(() => assertColumns(['STABR'], PLS_COLUMNS, 'f.csv')).toThrow(/Columns actually present/)
  })

  it('passes when every column is present', () => {
    expect(() => assertColumns(Object.values(PLS_COLUMNS), PLS_COLUMNS, 'f.csv')).not.toThrow()
  })
})

describe('IMLS sentinel handling', () => {
  it('treats -1/-3/-4 and M as missing, not as data', () => {
    // -3 means "temporarily closed outlet"; parsed naively it becomes a
    // coordinate in the Atlantic or a phone number of "-3".
    for (const s of ['-1', '-3', '-4', 'M', '', '  ']) expect(cleanSentinel(s)).toBeNull()
    expect(cleanSentinel('5129747400')).toBe('5129747400')
    expect(cleanSentinel('-2')).toBe('-2')
  })

  it('rejects sentinel and zero coordinates', () => {
    expect(parseCoord('-3')).toBeNull()
    expect(parseCoord('0')).toBeNull()
    expect(parseCoord('')).toBeNull()
    expect(parseCoord('30.2672')).toBe(30.2672)
    expect(parseCoord('-97.7431')).toBe(-97.7431)
  })
})

describe('library outlet mapping (PLS FY2023)', () => {
  it('maps a central library into an Item with a stable outlet-scoped id', () => {
    const { row } = libraryRowToItem(libRec(), metroForCoords, TIER)
    expect(row).toMatchObject({
      id: 'imls-lib-tx0015-002',
      category: 'library',
      source_type: 'imls',
      region: 'austin',
      confidence: 'medium',
      status: 'approved',
      indoor: 1,
      city: 'Austin',
    })
    // FSCSKEY alone is the parent entity — the outlet suffix is what
    // makes branches distinct.
    expect(row.id).toContain('002')
    expect(row.address).toBe('800 Guadalupe St, Austin, TX, 78701')
  })

  it('title-cases ALL-CAPS names but leaves mixed case alone', () => {
    expect(libraryRowToItem(libRec(), metroForCoords, TIER).row.name).toBe('Faulk Central Library')
    const mixed = libraryRowToItem(libRec({ [PLS_COLUMNS.name]: 'Faulk Central Library' }), metroForCoords, TIER)
    expect(mixed.row.name).toBe('Faulk Central Library')
  })

  it('keeps central and branch outlets, drops bookmobiles and books-by-mail', () => {
    expect(PLS_VISITABLE_OUTLET_TYPES).toEqual(new Set(['CE', 'BR']))
    for (const t of ['CE', 'BR']) {
      expect(libraryRowToItem(libRec({ [PLS_COLUMNS.outletType]: t }), metroForCoords, TIER).row).toBeTruthy()
    }
    // A bookmobile's coordinate is its garage; books-by-mail has no location.
    for (const t of ['BS', 'BM', '']) {
      expect(libraryRowToItem(libRec({ [PLS_COLUMNS.outletType]: t }), metroForCoords, TIER).skipped)
        .toMatch(/outlet type/)
    }
  })

  it('formats a 10-digit phone into attributes and drops sentinel phones', () => {
    expect(libraryRowToItem(libRec(), metroForCoords, TIER).row.attributes).toEqual({ phone: '(512) 974-7400' })
    expect(libraryRowToItem(libRec({ [PLS_COLUMNS.phone]: '-3' }), metroForCoords, TIER).row.attributes).toBeNull()
  })

  it('defers rows outside every metro bbox instead of ingesting them', () => {
    // Rural Nebraska — a real library, but plan §1.1 defers anything outside
    // a metro rather than putting it on a map nobody is looking at.
    const r = libraryRowToItem(libRec({ [PLS_COLUMNS.lat]: '41.5', [PLS_COLUMNS.lng]: '-99.5' }), metroForCoords, TIER)
    expect(r.skipped).toBe('outside every metro bbox')
  })

  it('skips rows with no coordinates or no name', () => {
    expect(libraryRowToItem(libRec({ [PLS_COLUMNS.lat]: '-3' }), metroForCoords, TIER).skipped).toBe('no coordinates')
    expect(libraryRowToItem(libRec({ [PLS_COLUMNS.name]: '' }), metroForCoords, TIER).skipped).toBe('no name')
  })
})

describe('museum mapping (MDF 2018)', () => {
  it('maps child-relevant disciplines to our categories and drops the rest', () => {
    expect(MDF_CATEGORY_BY_DISCIPLINE).toEqual({
      CMU: 'museum', SCI: 'museum', NAT: 'museum', ZAW: 'aquarium', BOT: 'park',
    })
    // Zoos/aquariums/wildlife share our combined aquarium bucket.
    expect(museumRowToItem(musRec({ DISCIPL: 'ZAW' }), metroForCoords, TIER).row.category).toBe('aquarium')
    // Arboretums and nature centers are outdoor destinations.
    const bot = museumRowToItem(musRec({ DISCIPL: 'BOT' }), metroForCoords, TIER).row
    expect(bot.category).toBe('park')
    expect(bot.indoor).toBe(0)
    // Art / history / general / historical societies are not kid destinations.
    for (const d of ['ART', 'HST', 'GMU', 'HSC', '']) {
      expect(museumRowToItem(musRec({ DISCIPL: d }), metroForCoords, TIER).skipped).toMatch(/discipline/)
    }
  })

  it("reads File2's 'DISCIPLINE' header as an alias of File1/File3's 'DISCIPL'", () => {
    // The 2018 release is inconsistent WITHIN itself: File1/File3 use
    // 'DISCIPL', File2 uses 'DISCIPLINE'. Both must map; and assertColumns
    // must accept a file with either header (verified against the real
    // 2018_csv_museum_data_files.zip, 2026-07-19).
    const rec = musRec({ DISCIPL: undefined as unknown as string, DISCIPLINE: 'SCI' })
    delete (rec as Record<string, unknown>).DISCIPL
    expect(museumRowToItem(rec, metroForCoords, TIER).row.category).toBe('museum')
    const otherCols = (Object.values(MDF_COLUMNS).filter((c) => typeof c === 'string')) as string[]
    expect(() => assertColumns([...otherCols, 'DISCIPL'], MDF_COLUMNS, 'f1')).not.toThrow()
    expect(() => assertColumns([...otherCols, 'DISCIPLINE'], MDF_COLUMNS, 'f2')).not.toThrow()
    expect(() => assertColumns(otherCols, MDF_COLUMNS, 'f0')).toThrow(/DISCIPL\|DISCIPLINE/)
  })

  it('stamps the retired-dataset vintage onto the row itself', () => {
    // Whoever reads this row later needs to know the record is an
    // 8-year-old snapshot — not just whoever read the PR that created it.
    const r = museumRowToItem(musRec(), metroForCoords, { ...TIER, vintageNote: 'Source: 2018 retired dataset.' })
    expect(r.row.description).toBe('Source: 2018 retired dataset.')
  })

  it('normalises a bare website host into a URL', () => {
    expect(museumRowToItem(musRec(), metroForCoords, TIER).row.website).toBe('https://thinkeryaustin.org')
    expect(
      museumRowToItem(musRec({ [MDF_COLUMNS.website]: 'http://x.org' }), metroForCoords, TIER).row.website,
    ).toBe('http://x.org')
  })

  it('falls back to the legal name when the common name is blank', () => {
    const r = museumRowToItem(musRec({ [MDF_COLUMNS.name]: '' }), metroForCoords, TIER)
    expect(r.row.name).toBe('Austin Childrens Museum')
  })
})

describe('Bay Area guard', () => {
  // The Bay library/museum layer is already curated (OSM + hand curation +
  // BiblioCommons). Emitting IMLS rows into `bay` at `approved` would
  // double-pin every SFPL branch on the flagship map the moment the SQL is
  // applied — before #355's dedup exists to merge them.
  const SF = { [PLS_COLUMNS.lat]: '37.7955', [PLS_COLUMNS.lng]: '-122.3937' }
  const skipBay = { ...TIER, skipRegions: new Set(['bay']) }

  it('skips Bay Area library rows by default', () => {
    expect(libraryRowToItem(libRec(SF), metroForCoords, skipBay).skipped).toBe('bay region (skipped unless --include-bay)')
  })

  it('skips Bay Area museum rows by default', () => {
    const sf = musRec({ [MDF_COLUMNS.lat]: '37.7955', [MDF_COLUMNS.lng]: '-122.3937' })
    expect(museumRowToItem(sf, metroForCoords, skipBay).skipped).toBe('bay region (skipped unless --include-bay)')
  })

  it('emits them when the caller opts in', () => {
    expect(libraryRowToItem(libRec(SF), metroForCoords, TIER).row.region).toBe('bay')
  })

  it('leaves non-Bay metros untouched by the guard', () => {
    expect(libraryRowToItem(libRec(), metroForCoords, skipBay).row.region).toBe('austin')
  })
})

describe('website normalisation', () => {
  it('prepends a scheme to a bare host', () => {
    expect(normalizeWebsite('thinkeryaustin.org')).toBe('https://thinkeryaustin.org')
  })

  it('leaves an existing scheme alone', () => {
    expect(normalizeWebsite('http://x.org')).toBe('http://x.org')
  })

  it('drops junk rather than minting a live-looking dead link', () => {
    // A bare `0` survives cleanSentinel and would become https://0 — a link
    // on a place card that goes nowhere.
    for (const junk of ['0', 'n/a', '   ', 'none']) expect(normalizeWebsite(junk)).toBeNull()
  })
})

describe('SQL emission', () => {
  const rows = [libraryRowToItem(libRec(), metroForCoords, TIER).row]

  it('escapes single quotes so an apostrophe in a name cannot break the statement', () => {
    const withQuote = [libraryRowToItem(libRec({ [PLS_COLUMNS.name]: "Children's Room" }), metroForCoords, TIER).row]
    expect(buildSeedSql(withQuote, ['-- t'])).toContain("'Children''s Room'")
  })

  it('preserves an approved row on re-import, not just rejected/archived', () => {
    // Museums default to --status pending, so without `approved` in the CASE
    // a regeneration silently demotes every museum the curator approved and
    // they vanish from the map — the 2026-05-13 upick-upick-orchards failure
    // inverted (a routine overriding a curator decision).
    expect(buildSeedSql(rows, ['-- t'])).toContain(
      "status=CASE WHEN items.status IN ('rejected','archived','approved') THEN items.status ELSE excluded.status END",
    )
  })

  it('never rewrites a published slug', () => {
    expect(buildSeedSql(rows, ['-- t'])).toContain('slug=COALESCE(items.slug, excluded.slug)')
  })

  it('emits no BEGIN/COMMIT — D1 rejects SQL-level transactions', () => {
    expect(buildSeedSql(rows, ['-- t'])).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/)
  })
})

describe('collect', () => {
  it('separates rows from a skip-reason histogram', () => {
    const { rows: r, skipped } = collect([
      { row: { id: 'a' } }, { skipped: 'no name' }, { skipped: 'no name' }, { skipped: 'no coordinates' },
    ])
    expect(r).toHaveLength(1)
    expect(skipped).toEqual({ 'no name': 2, 'no coordinates': 1 })
  })
})
