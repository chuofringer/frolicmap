// worker/test/import-funradar.test.mjs
// Coverage for the pure funradar → frolicmap mapping (scripts/lib/funradar.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadRows, normalizeFunradarRow, buildFunradarSql, FUNRADAR_COLUMNS,
  ALLOWED_CATEGORIES, FUNRADAR_SOURCE_TYPES,
} from '../scripts/lib/funradar.mjs'
import { buildUpsertSet, maxStatementBytes, D1_MAX_STATEMENT_BYTES } from '../scripts/lib/seedSql.mjs'

const NOW = '2026-10-19T00:00:00.000Z'
const OPTS = { allowedCategories: ALLOWED_CATEGORIES, allowedSourceTypes: FUNRADAR_SOURCE_TYPES, now: NOW }
const BBOX = { south: 37, west: -123, north: 38, east: -122 }

const place = (over = {}) => ({
  id: 'osm-node-1', type: 'place', name: "Mike's Park", name_zh: '麦克公园',
  description: null, category: 'park', lat: 37.5, lng: -122.5, address: '1 Main St',
  age_min: 0, age_max: 12, cost: 'free', price_usd: null, indoor: 0,
  opening_hours: null, photo_url: null, photo_attribution: 'CC BY by Someone',
  website: null, source_url: 'https://www.openstreetmap.org/node/1', source_type: 'osm',
  confidence: 'high', status: 'approved', last_verified: '2026-01-02',
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
  region: 'bay', city: 'Foster City', attributes: '{"fenced":true}', slug: 'mikes-park',
  has_playground: 1,
  ...over,
})

test('loadRows unwraps the wrangler envelope and accepts a bare array', () => {
  const rows = [place({ id: 'a' }), place({ id: 'b' })]
  assert.deepEqual(loadRows([{ results: rows, success: true, meta: {} }]), rows)
  assert.deepEqual(loadRows(rows), rows)
  assert.deepEqual(loadRows([]), [])
  assert.throws(() => loadRows({ nope: 1 }))
})

test('scraped and event rows are skipped with the right reasons', () => {
  assert.deepEqual(normalizeFunradarRow(place({ source_type: 'scraped' }), OPTS), { skip: 'source_type' })
  assert.deepEqual(normalizeFunradarRow(place({ source_type: 'ics-library' }), OPTS), { skip: 'source_type' })
  assert.deepEqual(normalizeFunradarRow(place({ source_type: 'manual' }), OPTS), { skip: 'source_type' })
  assert.deepEqual(normalizeFunradarRow(place({ type: 'event' }), OPTS), { skip: 'type' })
  assert.deepEqual(normalizeFunradarRow(place({ status: 'pending' }), OPTS), { skip: 'status' })
})

test('a disallowed category is skipped', () => {
  assert.deepEqual(normalizeFunradarRow(place({ category: 'farm' }), OPTS), { skip: 'category' })
  assert.deepEqual(normalizeFunradarRow(place({ category: undefined }), OPTS), { skip: 'category' })
})

test('non-finite coordinates are skipped', () => {
  assert.deepEqual(normalizeFunradarRow(place({ lat: null }), OPTS), { skip: 'coords' })
  assert.deepEqual(normalizeFunradarRow(place({ lng: 'x' }), OPTS), { skip: 'coords' })
  assert.deepEqual(normalizeFunradarRow(place({ lat: NaN }), OPTS), { skip: 'coords' })
})

test('a row outside the bbox is skipped, one inside is kept', () => {
  assert.deepEqual(normalizeFunradarRow(place({ lat: 40 }), { ...OPTS, bbox: BBOX }), { skip: 'bbox' })
  assert.ok(normalizeFunradarRow(place(), { ...OPTS, bbox: BBOX }).row)
})

test('extra columns are dropped and attributes JSON is parsed', () => {
  const { row } = normalizeFunradarRow(place({
    start_time: 'x', end_time: 'y', rrule: 'z', exdates: '[]', crops: 'c', crops_state: 's',
    in_season_now: 1, affiliate: 'a', mystery: 1,
  }), OPTS)
  for (const k of ['start_time', 'end_time', 'rrule', 'exdates', 'crops', 'crops_state', 'in_season_now', 'affiliate', 'mystery']) {
    assert.equal(k in row, false, k)
  }
  assert.deepEqual(Object.keys(row).sort(), [...FUNRADAR_COLUMNS].sort())
  assert.deepEqual(row.attributes, { fenced: true })
  assert.equal(normalizeFunradarRow(place({ attributes: '{not json' }), OPTS).row.attributes, null)
})

test('coercions and timestamp defaults', () => {
  const { row } = normalizeFunradarRow(place({
    indoor: '1', has_playground: true, confidence: 'bogus', cost: 'donation', price_usd: '4.5',
    last_verified: undefined, created_at: undefined, updated_at: undefined,
  }), OPTS)
  assert.equal(row.indoor, 1)
  assert.equal(row.has_playground, 1)
  assert.equal(row.confidence, 'medium')
  assert.equal(row.cost, null)
  assert.equal(row.price_usd, 4.5)
  assert.equal(row.last_verified, '2026-10-19')
  assert.equal(row.created_at, NOW)
  assert.equal(row.updated_at, NOW)
  assert.equal(normalizeFunradarRow(place({ indoor: undefined, has_playground: null }), OPTS).row.indoor, null)
  assert.equal(normalizeFunradarRow(place(), OPTS).row.last_verified, '2026-01-02')
})

test('a kept row yields SQL whose column list and VALUES count agree', () => {
  const { row } = normalizeFunradarRow(place(), OPTS)
  const sql = buildFunradarSql([row], { setClause: buildUpsertSet(), headerLines: ['-- test'] })
  const cols = /INSERT INTO items \(([^)]*)\) VALUES/.exec(sql)[1].split(',')
  for (const c of ['name_zh', 'photo_attribution', 'has_playground']) assert.ok(cols.includes(c), c)
  assert.equal(cols.length, 30)

  // Count top-level commas in the single VALUES tuple, ignoring those inside '…' literals.
  const tuple = /VALUES\n\s+\((.*)\)\nON CONFLICT/s.exec(sql)[1]
  let n = 1
  let inStr = false
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]
    if (ch === "'") {
      if (inStr && tuple[i + 1] === "'") i++
      else inStr = !inStr
    } else if (ch === ',' && !inStr) n++
  }
  assert.equal(n, cols.length)
  assert.match(sql, /'Mike''s Park'/)
  assert.match(sql, /'麦克公园'/)
  assert.ok(maxStatementBytes(sql) < D1_MAX_STATEMENT_BYTES)
})

test('buildFunradarSql splits statements to stay under the byte budget', () => {
  const rows = Array.from({ length: 50 }, (_, i) =>
    normalizeFunradarRow(place({ id: `osm-node-${i}`, slug: `p-${i}` }), OPTS).row)
  const sql = buildFunradarSql(rows, { setClause: buildUpsertSet(), maxBytes: 4000 })
  assert.ok((sql.match(/INSERT INTO items/g) ?? []).length > 1)
  assert.ok(maxStatementBytes(sql) <= 4000)
})
