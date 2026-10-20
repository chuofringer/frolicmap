import { describe, it, expect } from 'vitest'
import {
  esc, num, buildUpsertSet, buildImportSql, maxStatementBytes,
  PRESERVE_CURATOR_STATUS, IMPORT_COLUMNS, D1_MAX_STATEMENT_BYTES,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/seedSql.mjs'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'osm-node-1', type: 'place', name: 'Test Park', description: null,
  category: 'park', lat: 30.27, lng: -97.74, address: '1 Main St, Austin, TX',
  age_min: null, age_max: null, cost: null, price_usd: null, indoor: 0,
  opening_hours: null, photo_url: null, photo_attribution: null, website: null,
  source_url: 'https://example.com', source_type: 'osm',
  confidence: 'medium', status: 'approved',
  last_verified: '2026-07-18T00:00:00.000Z', created_at: '2026-07-18T00:00:00.000Z',
  updated_at: '2026-07-18T00:00:00.000Z', region: 'austin', city: 'Austin',
  attributes: null, slug: null,
  ...over,
})

describe('escaping', () => {
  it('escapes single quotes so an apostrophe cannot break the statement', () => {
    expect(esc("Children's Room")).toBe("'Children''s Room'")
  })

  it('renders null and undefined as SQL NULL, not the string "null"', () => {
    expect(esc(null)).toBe('NULL')
    expect(esc(undefined)).toBe('NULL')
    expect(num(null)).toBe('NULL')
    expect(num(0)).toBe('0')
  })
})

describe('curator-status preservation', () => {
  it('preserves approved as well as rejected and archived', () => {
    // The approved case is the subtle one: an importer whose excluded.status
    // is 'pending' (IMLS museums) would otherwise demote every row the
    // curator approved on the next re-import — a routine silently overriding
    // a human decision, the 2026-05-13 upick-upick-orchards failure inverted.
    expect(PRESERVE_CURATOR_STATUS).toContain("items.status IN ('rejected','archived','approved')")
  })

  it('is included in the shared SET clause', () => {
    expect(buildUpsertSet()).toContain(PRESERVE_CURATOR_STATUS)
  })

  it('never nulls out an existing value when the re-import lacks one', () => {
    const set = buildUpsertSet()
    expect(set).toContain('website=COALESCE(excluded.website, items.website)')
    expect(set).toContain('city=COALESCE(excluded.city, items.city)')
    expect(set).toContain('attributes=COALESCE(excluded.attributes, items.attributes)')
    // The dedup pass back-fills address from a richer source; a raw importer
    // re-run with a NULL address must not erase it (deep-review M1).
    expect(set).toContain('address=COALESCE(excluded.address, items.address)')
  })

  it('never demotes Tier B on re-import', () => {
    // confidence='high' is computed by the dedup pass from multi-source
    // confirmation; importers only emit 'medium'. Without the CASE, the
    // quarterly OSM re-pull reverted every deduped winner to 'medium' and —
    // since place pages gate on 'high' — silently dropped the metro's place
    // pages until the next dedup run (deep-review M1).
    expect(buildUpsertSet()).toContain(
      "confidence=CASE WHEN items.confidence='high' THEN items.confidence ELSE excluded.confidence END",
    )
  })

  it('keeps a published slug against importer re-runs', () => {
    expect(buildUpsertSet()).toContain('slug=COALESCE(items.slug, excluded.slug)')
  })

  it('appends importer-specific clauses before the status CASE', () => {
    const set = buildUpsertSet(['indoor=excluded.indoor'])
    expect(set).toContain('indoor=excluded.indoor')
    expect(set.indexOf('indoor=excluded.indoor')).toBeLessThan(set.indexOf('status=CASE'))
  })
})

describe('byte-budgeted chunking', () => {
  it('keeps every statement under D1s 100 KB cap for a large row set', () => {
    // The bug this replaces: a fixed 200-row chunk produced 84–110 KB
    // statements depending on name/address length, and only failed on a
    // --remote apply (local SQLite has no such limit) — i.e. mid-wave.
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row({ id: `osm-node-${i}`, name: `A Fairly Long Park Name Number ${i}`.repeat(3) }))
    const sql = buildImportSql(rows, { headerLines: ['-- t'] })
    expect(maxStatementBytes(sql)).toBeLessThan(D1_MAX_STATEMENT_BYTES)
  })

  it('splits into multiple statements rather than one giant one', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => row({ id: `osm-node-${i}` }))
    const sql = buildImportSql(rows, { headerLines: ['-- t'] })
    expect((sql.match(/INSERT INTO items/g) ?? []).length).toBeGreaterThan(1)
  })

  it('emits a single statement when everything fits', () => {
    const sql = buildImportSql([row()], { headerLines: ['-- t'] })
    expect((sql.match(/INSERT INTO items/g) ?? []).length).toBe(1)
  })

  it('never drops a row, even one larger than the budget on its own', () => {
    // Better a statement that might fail loudly at apply time than a row
    // silently missing from the output.
    const huge = row({ id: 'huge', name: 'x'.repeat(2000) })
    const sql = buildImportSql([huge, row({ id: 'small' })], { headerLines: ['-- t'], maxBytes: 500 })
    expect(sql).toContain("'huge'")
    expect(sql).toContain("'small'")
  })

  it('round-trips every row into the output', () => {
    const rows = Array.from({ length: 350 }, (_, i) => row({ id: `osm-node-${i}` }))
    const sql = buildImportSql(rows, { headerLines: ['-- t'], maxBytes: 20_000 })
    for (const r of rows) expect(sql).toContain(`'${r.id}'`)
  })

  it('emits no BEGIN/COMMIT — D1 rejects SQL-level transactions', () => {
    expect(buildImportSql([row()], { headerLines: ['-- t'] })).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/)
  })

  it('writes the header lines first', () => {
    expect(buildImportSql([row()], { headerLines: ['-- hello'] }).startsWith('-- hello')).toBe(true)
  })

  it('emits values in the declared column order', () => {
    expect(buildImportSql([row()], { headerLines: [] }))
      .toContain(`INSERT INTO items (${IMPORT_COLUMNS.join(',')}) VALUES`)
  })
})
