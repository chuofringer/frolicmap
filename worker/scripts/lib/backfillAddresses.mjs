/**
 * Pure helpers for the reverse-geocode address backfill (issue #399).
 *
 * These are the response→address formatter and the SQL-emission logic, split
 * out of `worker/scripts/backfill-addresses.mjs` so they can be unit-tested
 * without touching the network, the filesystem or wrangler. The entry point
 * owns all the I/O (Nominatim fetch, rate-limiting, cache file, batch files);
 * everything here is a pure function of its arguments.
 */

import { esc } from './seedSql.mjs'

/**
 * Cache key for a coordinate: `"lat,lng"` rounded to 5 decimal places (~1.1m).
 *
 * Rounding is what makes the JSON-lines cache a stable, dedup'd key — two rows
 * at effectively the same spot share one Nominatim lookup, and a resumed run
 * finds the prior answer. 5dp matches the precision we store coords at.
 */
export function cacheKey(lat, lng) {
  const n = (v) => Number(v).toFixed(5)
  return `${n(lat)},${n(lng)}`
}

/**
 * Build a US street address from a Nominatim `reverse` (jsonv2,
 * addressdetails=1) response, or return `null` to signal "skip this row".
 *
 * Format: `"<house_number> <road>, <city>"`. The house number and city are
 * optional; the **road is mandatory** — with no `road`/`street` in the
 * response there is no street address to compose, and fabricating one (e.g.
 * from the display_name or a bare locality) would be worse than leaving the
 * field null. This mirrors the repo's "don't invent data" rule: SKIP > fake.
 *
 * City falls back through OSM's place hierarchy: city → town → village →
 * suburb (the last covers dense urban parks that only carry a neighbourhood).
 */
export function formatAddress(resp) {
  const a = resp && resp.address
  if (!a || typeof a !== 'object') return null

  const road = typeof a.road === 'string' ? a.road.trim() : ''
  if (!road) return null

  const houseNumber = typeof a.house_number === 'string' ? a.house_number.trim() : ''
  const street = houseNumber ? `${houseNumber} ${road}` : road

  const cityRaw = a.city ?? a.town ?? a.village ?? a.suburb
  const city = typeof cityRaw === 'string' ? cityRaw.trim() : ''

  return city ? `${street}, ${city}` : street
}

/**
 * A single idempotent UPDATE for one row.
 *
 * The `AND (address IS NULL OR address='')` guard is load-bearing: applying a
 * batch can never clobber a curated address (someone may have filled it in
 * between the SELECT and the apply), and re-applying a batch is a no-op. Only
 * `address` and `updated_at` are ever written — no other column is touched.
 */
export function buildUpdateStatement(id, address, updatedAtIso) {
  return (
    `UPDATE items SET address=${esc(address)}, updated_at=${esc(updatedAtIso)} ` +
    `WHERE id=${esc(id)} AND (address IS NULL OR address='');`
  )
}

/**
 * Split an array into fixed-size chunks (last chunk may be shorter).
 */
export function chunk(arr, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`)
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Guard against ever emitting a write for a Bay Area row.
 *
 * `region='bay'` is the original curated metro — its rows are out of scope for
 * this national backfill and must never be touched by it. The remote SELECT
 * already filters `region!='bay'`, but an `--input` file is operator-supplied
 * and could include anything, so we assert on the input and refuse to run
 * rather than trust the export was scoped correctly. Also validates that every
 * row carries an id and numeric coords.
 */
export function assertInputRows(rows) {
  if (!Array.isArray(rows)) throw new Error('input must be an array of rows')
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error(`invalid row: ${JSON.stringify(row)}`)
    if (row.region === 'bay') {
      throw new Error(`refusing to backfill a region='bay' row (id=${row.id}); this job is national-only`)
    }
    if (row.id === undefined || row.id === null || row.id === '') {
      throw new Error(`row missing id: ${JSON.stringify(row)}`)
    }
    if (!Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lng))) {
      throw new Error(`row ${row.id} has non-numeric lat/lng`)
    }
  }
  return rows
}
