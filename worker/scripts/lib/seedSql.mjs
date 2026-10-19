/**
 * Shared SQL emission for the national importers (#352, #353).
 *
 * Both the OSM bootstrap and the IMLS seeds were carrying their own copies of
 * `esc`/`num`, the column list, the UPSERT SET clause and the chunking loop.
 * The copies had already drifted (one refreshed `attributes` and COALESCEd
 * `website`, the other didn't) and neither was reachable by the test suite
 * because they lived inline in `.mjs` entry points. One module, unit-tested,
 * following the existing `worker/scripts/lib/` pattern.
 */

export const esc = (v) =>
  v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`

export const num = (v) => (v === null || v === undefined ? 'NULL' : String(v))

/**
 * Column list shared by every importer: static-place columns only.
 */
export const IMPORT_COLUMNS = [
  'id', 'type', 'name', 'description', 'category', 'lat', 'lng', 'address',
  'age_min', 'age_max', 'cost', 'price_usd', 'indoor', 'opening_hours',
  'photo_url', 'website', 'source_url', 'source_type', 'confidence', 'status',
  'last_verified', 'created_at', 'updated_at', 'region', 'city', 'attributes', 'slug',
]

/**
 * Preserve a curator's decision across importer re-runs.
 *
 * `rejected`/`archived` are obvious: never resurrect a row a human removed.
 * `approved` is the subtle one and it matters for any importer whose
 * `excluded.status` is `pending` — without it, a re-import silently demotes
 * every row the curator approved. The repo's UPSERT contract is explicit that
 * an approved row stays approved.
 *
 * These are static-place importers with no "material change → re-pend" case to
 * honour, so there is no field-diff condition.
 */
export const PRESERVE_CURATOR_STATUS =
  "status=CASE WHEN items.status IN ('rejected','archived','approved') THEN items.status ELSE excluded.status END"

/**
 * The SET clause every national importer shares.
 *
 * `website`/`city`/`attributes` use COALESCE so a re-import that happens to
 * lack a value doesn't null out one we already had. `slug` keeps the stored
 * value so a published /place/{slug} URL survives an upstream rename (the
 * admin route has an explicit escape hatch for genuine slug fixes).
 */
export function buildUpsertSet(extra = []) {
  return [
    // Never revert a dedup-restored name. ParkServe stores a park's name
    // without its designation ("Jaycee", not "Jaycee Park"), so the dedup pass
    // adopts the fuller variant from a merged loser and writes it back. A raw
    // re-import would then overwrite "Jaycee Park" with "Jaycee" again — the
    // same revert-on-refresh failure already documented for `confidence`
    // (finding M1), one column over. Keep the stored name only when it is a
    // whole-word EXTENSION of the incoming one; a genuine upstream rename
    // (different name, not an extension) still lands.
    "name=CASE WHEN LENGTH(items.name) > LENGTH(excluded.name) " +
      "AND SUBSTR(LOWER(items.name), 1, LENGTH(excluded.name) + 1) = LOWER(excluded.name) || ' ' " +
      'THEN items.name ELSE excluded.name END',
    'category=excluded.category',
    'lat=excluded.lat',
    'lng=excluded.lng',
    // COALESCE: the dedup pass back-fills address from a richer source
    // (e.g. ParkServe onto an OSM winner); a raw importer re-run whose own
    // address is NULL must not erase that.
    'address=COALESCE(excluded.address, items.address)',
    'website=COALESCE(excluded.website, items.website)',
    // Never demote Tier B. `confidence='high'` is computed by the dedup
    // pass from multi-source confirmation — importers only ever emit
    // 'medium'. Without this CASE, the quarterly OSM re-pull reverted every
    // deduped winner to 'medium', and since place pages gate on 'high', a
    // refresh not immediately followed by a dedup re-run silently dropped
    // the metro's place pages (deep-review finding M1).
    "confidence=CASE WHEN items.confidence='high' THEN items.confidence ELSE excluded.confidence END",
    'last_verified=excluded.last_verified',
    'updated_at=excluded.updated_at',
    'region=excluded.region',
    'city=COALESCE(excluded.city, items.city)',
    'attributes=COALESCE(excluded.attributes, items.attributes)',
    'slug=COALESCE(items.slug, excluded.slug)',
    ...extra,
    PRESERVE_CURATOR_STATUS,
  ].join(', ')
}

export function rowValues(r) {
  return [
    esc(r.id), esc(r.type), esc(r.name), esc(r.description), esc(r.category),
    num(r.lat), num(r.lng), esc(r.address),
    num(r.age_min), num(r.age_max), esc(r.cost), num(r.price_usd),
    num(r.indoor), esc(r.opening_hours),
    esc(r.photo_url), esc(r.website), esc(r.source_url), esc(r.source_type),
    esc(r.confidence), esc(r.status),
    esc(r.last_verified), esc(r.created_at), esc(r.updated_at),
    esc(r.region), esc(r.city),
    r.attributes ? esc(JSON.stringify(r.attributes)) : 'NULL',
    esc(r.slug),
  ].join(',')
}

/**
 * D1's maximum SQL statement length is 100 KB. Flush well under it: a
 * fixed row count can't respect a byte limit, because row size varies several
 * hundred bytes with name/address/opening_hours length, and the overflow would
 * only appear on a `--remote` apply (local SQLite has no such limit) — i.e.
 * mid-wave, after earlier chunks already landed.
 */
export const D1_MAX_STATEMENT_BYTES = 100_000
const DEFAULT_BUDGET = 80_000

const byteLen = (s) => Buffer.byteLength(s, 'utf8')

/**
 * Emit chunked INSERT…ON CONFLICT statements, each staying under `maxBytes`.
 *
 * A single row larger than the budget still gets its own statement rather than
 * being dropped — better a statement that might fail loudly at apply time than
 * a row silently missing from the output.
 */
export function buildImportSql(rows, {
  headerLines = [],
  columns = IMPORT_COLUMNS,
  setClause = buildUpsertSet(),
  maxBytes = DEFAULT_BUDGET,
} = {}) {
  const prefix = `INSERT INTO items (${columns.join(',')}) VALUES\n`
  const suffix = `\nON CONFLICT(id) DO UPDATE SET ${setClause};`
  const overhead = byteLen(prefix) + byteLen(suffix)

  const out = [...headerLines, '']
  let batch = []
  let batchBytes = overhead

  const flush = () => {
    if (!batch.length) return
    out.push(prefix + batch.join(',\n') + suffix, '')
    batch = []
    batchBytes = overhead
  }

  for (const r of rows) {
    const line = `  (${rowValues(r)})`
    const lineBytes = byteLen(line) + 2 // ",\n" separator
    if (batch.length && batchBytes + lineBytes > maxBytes) flush()
    batch.push(line)
    batchBytes += lineBytes
  }
  flush()

  return out.join('\n')
}

/**
 * Largest statement in a generated file, for verification and reporting.
 * Kept here so both importers can assert the invariant the same way.
 */
export function maxStatementBytes(sql) {
  return sql
    .split(/;\s*\n/)
    .reduce((max, stmt) => Math.max(max, byteLen(stmt)), 0)
}
