// Google Geocoding API mirror of validateCoords.mjs, for the #268 audit of
// the 547 manual+scraped rows Geocodio's free tier could not certify
// (accuracy_type=street_center / accuracy<0.9 / ZIP mismatch / outside
// bbox). Google resolves most of those same addresses as ROOFTOP, which is
// the confidence the unverified pool was missing.
//
// Guard chain (same shape as validateCoords.mjs's 4 guards, translated to
// Google's response vocabulary):
//   1. location_type ∈ {ROOFTOP, RANGE_INTERPOLATED}
//   2. not a partial_match (Google's "I substituted part of your address")
//   3. matched ZIP equals input ZIP (wrong-city catch)
//   4. result inside Bay Area content bbox
//
// Same trust rule as validateCoords: a failed guard means the geocode is
// NOT trusted, so the stored coord is never overridden by it — the row is
// flagged unresolvable for manual review, never guessed at.

import { extractZip } from './validateCoords.mjs'

export const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

const TRUSTED_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED'])
// Same Bay Area content bbox as validateCoords.mjs.
const CONTENT_BBOX = { south: 36.89, west: -122.85, north: 38.60, east: -121.57 }

// Thresholds in meters (the #268 review unit). 160m ≈ the 0.1mi trust floor
// validateCoords settled on 2026-05-05; below it the stored coord is
// confirmed as-is. 250m is the review line: corrections that move a pin
// farther than that get a per-row REVIEW comment in the emitted SQL so the
// operator eyeballs them before applying. ~16km (10mi) matches
// validateCoords's reject band — those corrections are emitted commented
// out entirely (probable bad address / wrong row, not mere drift).
export const CONFIRM_THRESHOLD_M = 160
export const REVIEW_THRESHOLD_M = 250
export const FAR_THRESHOLD_M = 16093

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function inBayArea(lat, lng) {
  return (
    lat >= CONTENT_BBOX.south && lat <= CONTENT_BBOX.north &&
    lng >= CONTENT_BBOX.west && lng <= CONTENT_BBOX.east
  )
}

/**
 * Geocode one address via Google. Returns the parsed top candidate or a
 * {error} marker — never throws. `fetchImpl` is injectable for tests.
 *
 * @returns {Promise<{
 *   lat: number, lng: number,
 *   locationType: string,
 *   partialMatch: boolean,
 *   zip: string | null,
 *   formatted: string,
 * } | { error: string }>}
 */
export async function googleGeocodeOne(address, apiKey, fetchImpl = fetch) {
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`
  let json
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return { error: `http ${res.status}` }
    json = await res.json()
  } catch (err) {
    return { error: `fetch: ${err.message ?? err}` }
  }
  if (json.status === 'ZERO_RESULTS') return { error: 'ZERO_RESULTS' }
  if (json.status !== 'OK') return { error: `status ${json.status}` }
  const top = json.results?.[0]
  if (!top?.geometry?.location) return { error: 'no geometry' }
  const zip = top.address_components?.find((c) => c.types?.includes('postal_code'))?.short_name ?? null
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    locationType: top.geometry.location_type,
    partialMatch: Boolean(top.partial_match),
    zip,
    formatted: top.formatted_address ?? '',
  }
}

/**
 * Classify one stored row against its Google geocode.
 *
 * @param {{id: string, name?: string, address: string, lat: number, lng: number}} row
 * @param {Awaited<ReturnType<typeof googleGeocodeOne>>} geo
 * @returns {{
 *   id: string,
 *   verdict: 'confirmed' | 'corrected' | 'unresolvable',
 *   deltaM: number | null,       // meters stored→geocoded (null if no geocode)
 *   review: boolean,             // corrected && deltaM > REVIEW_THRESHOLD_M
 *   far: boolean,                // corrected && deltaM ≥ FAR_THRESHOLD_M
 *   newLat: number | null, newLng: number | null,
 *   reason: string,
 * }}
 *
 * Verdicts:
 *   confirmed    — Google trusted, stored coord within 160m: keep as-is.
 *   corrected    — Google trusted, stored coord ≥160m off: emit UPDATE.
 *   unresolvable — no/untrusted geocode: keep stored coord, flag for a
 *                  human. NEVER emits a coordinate (repo rule: source,
 *                  skip, or mark approximate — don't invent).
 */
export function classifyRow(row, geo) {
  const base = { id: row.id, newLat: null, newLng: null, deltaM: null, review: false, far: false }
  if (row.lat == null || row.lng == null || !row.address) {
    return { ...base, verdict: 'unresolvable', reason: 'row missing address or stored coord' }
  }
  if (geo?.error) {
    return { ...base, verdict: 'unresolvable', reason: `google: ${geo.error}` }
  }
  const guardFailures = []
  if (!TRUSTED_LOCATION_TYPES.has(geo.locationType)) guardFailures.push(`location_type=${geo.locationType}`)
  if (geo.partialMatch) guardFailures.push('partial_match')
  const inputZip = extractZip(row.address)
  if (inputZip && geo.zip && inputZip !== geo.zip) guardFailures.push(`zip ${inputZip}≠${geo.zip}`)
  if (!inBayArea(geo.lat, geo.lng)) guardFailures.push('outside bbox')

  const deltaM = Math.round(haversineMeters(row.lat, row.lng, geo.lat, geo.lng))
  if (guardFailures.length > 0) {
    return {
      ...base,
      deltaM,
      verdict: 'unresolvable',
      reason: `google guards failed: ${guardFailures.join(', ')}; Δ=${deltaM}m`,
    }
  }
  if (deltaM < CONFIRM_THRESHOLD_M) {
    return { ...base, deltaM, verdict: 'confirmed', reason: `Δ=${deltaM}m within ${CONFIRM_THRESHOLD_M}m (${geo.locationType})` }
  }
  return {
    ...base,
    deltaM,
    verdict: 'corrected',
    review: deltaM > REVIEW_THRESHOLD_M,
    far: deltaM >= FAR_THRESHOLD_M,
    newLat: geo.lat,
    newLng: geo.lng,
    reason: `Δ=${deltaM}m corrected via Google (${geo.locationType}, "${geo.formatted}")`,
  }
}

function sqlQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

/**
 * Render the correction SQL from classified results. One UPDATE per
 * corrected row; corrections past REVIEW_THRESHOLD_M carry a `-- REVIEW`
 * comment, and ≥FAR_THRESHOLD_M corrections are emitted fully commented out
 * (operator must uncomment deliberately). Confirmed rows are counted in the
 * header; unresolvable rows appear as `-- SKIP` comments so the SQL file is
 * the complete audit trail of the pool.
 */
export function renderCorrectionSql(results, { generatedBy = 'audit-manual-scraped-coords.mjs' } = {}) {
  const confirmed = results.filter((r) => r.verdict === 'confirmed')
  const corrected = results.filter((r) => r.verdict === 'corrected')
  const unresolvable = results.filter((r) => r.verdict === 'unresolvable')
  const lines = [
    `-- Coordinate corrections generated by ${generatedBy} (#268)`,
    `-- pool=${results.length} confirmed=${confirmed.length} corrected=${corrected.length} unresolvable=${unresolvable.length}`,
    `-- Apply with: npx wrangler d1 execute funradar-prod --remote --file=<this file>`,
    '',
  ]
  for (const r of corrected) {
    const update = `UPDATE items SET lat=${r.newLat}, lng=${r.newLng} WHERE id=${sqlQuote(r.id)};`
    if (r.far) {
      lines.push(`-- REVIEW-FAR (${r.deltaM}m): ${r.reason}`)
      lines.push(`-- ${update}`)
    } else if (r.review) {
      lines.push(`-- REVIEW (${r.deltaM}m): ${r.reason}`)
      lines.push(update)
    } else {
      lines.push(`-- ${r.reason}`)
      lines.push(update)
    }
    lines.push('')
  }
  if (unresolvable.length) {
    lines.push('-- Unresolvable rows (stored coord kept; verify by hand):')
    for (const r of unresolvable) lines.push(`-- SKIP ${r.id}: ${r.reason}`)
    lines.push('')
  }
  return lines.join('\n')
}
