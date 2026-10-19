// Shared coordinate validation against Geocodio. Used by routine merge
// scripts (merge-upick.mjs, merge-aggregators.mjs) to catch bad lat/lng
// before they land in D1. Pattern surfaced 2026-05-04: U-Pick seed had
// 35/36 rows with measurable coord drift (16 ≥2 miles wrong). PR #259
// applied one-off corrections; this lib makes the validation durable.
//
// The 4-guard chain matches the audit script (verify-upick-coords.mjs):
//   1. accuracy_type ∈ {rooftop, range_interpolation, point}
//   2. accuracy score ≥ 0.9
//   3. matched ZIP equals input ZIP (catches wrong-city matches like
//      "550 Walnut Blvd, Brentwood, 94513" → Geocodio resolved to
//      "550 Walnut Ave, Walnut Creek, 94598")
//   4. result inside Bay Area content bbox
//
// Guard chain only matters when Geocodio's result is being TRUSTED. If
// any guard fails, the function falls back to the stored lat/lng and
// emits a warning — never silently override with low-confidence data.

const TRUSTED_ACCURACY_TYPE = new Set(['rooftop', 'range_interpolation', 'point'])
const MIN_ACCURACY_SCORE = 0.9
const CONTENT_BBOX = { south: 36.89, west: -122.85, north: 38.60, east: -121.57 }
// Auto-correct any drift ≥ 0.1mi (≈160m). Tightened from 0.5mi 2026-05-05
// after a curator-reported case: aggregator-bakf had a row at 0.34mi from
// the real Gamble Garden address — wrong-block territory but below the
// old 0.5mi threshold, so validateCoords kept it as "minor drift". 0.1mi
// is closer to "wrong corner of the same block" and a better trust floor
// for a discovery map. Geocodio's range_interpolation can drift up to
// ~50m on long blocks even when correct, so going below 0.05mi is too
// aggressive. 0.05–0.1mi stays in the "keep" bucket.
const DRIFT_THRESHOLD_MI = 0.1
const TOLERANCE_MI = 0.05

const GEOCODIO_BATCH_URL = 'https://api.geocod.io/v1.7/geocode'

function inBayArea(lat, lng) {
  return (
    lat >= CONTENT_BBOX.south && lat <= CONTENT_BBOX.north &&
    lng >= CONTENT_BBOX.west && lng <= CONTENT_BBOX.east
  )
}

// ZIP must be at the END of the address (or end + ZIP+4 suffix). Earlier
// version used `\b\d{5}\b` and matched any 5-digit token, which falsely
// caught street numbers like "10800 Torre Avenue, Cupertino, CA" → "10800"
// (treated as a ZIP), producing spurious zip-mismatch failures. Anchoring
// to end-of-string fixes that.
export function extractZip(address) {
  if (!address) return null
  const m = address.match(/(\d{5})(?:-\d{4})?\s*$/)
  return m?.[1] ?? null
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Geocode a batch of addresses against Geocodio. Returns the parsed
 * response array (one entry per input), or null on API failure.
 *
 * Geocodio's batch endpoint accepts up to 10000 addresses per call;
 * routine batches are well below that.
 */
async function geocodeBatch(addresses, apiKey) {
  try {
    const res = await fetch(`${GEOCODIO_BATCH_URL}?api_key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(addresses),
    })
    if (!res.ok) {
      console.error(`[validateCoords] Geocodio ${res.status}: ${await res.text().catch(() => '')}`)
      return null
    }
    const json = await res.json()
    return json.results ?? []
  } catch (err) {
    console.error(`[validateCoords] Geocodio fetch error: ${err.message ?? err}`)
    return null
  }
}

/**
 * Validate stored lat/lng against Geocodio for a batch of rows.
 *
 * @param {Array<{id: string, lat: number, lng: number, address: string}>} rows
 * @param {string} apiKey - Geocodio API key
 * @returns {Promise<Array<{
 *   id: string,
 *   action: 'keep' | 'correct' | 'reject' | 'unverified',
 *   lat: number,        // resolved lat (corrected or stored)
 *   lng: number,        // resolved lng (corrected or stored)
 *   reason: string,     // human-readable explanation
 *   originalLat: number,
 *   originalLng: number,
 * }>>}
 *
 * action semantics:
 *   - 'keep'       : stored coord already matches Geocodio within tolerance
 *   - 'correct'    : Geocodio passed all 4 guards AND disagreed with stored
 *                    by >0.5mi → caller should use {lat, lng} (the corrected)
 *   - 'reject'     : Geocodio passed guards AND stored is wildly wrong
 *                    (≥10mi). Caller should DROP the row entirely (probable
 *                    address-typo or fake-coord scenario).
 *   - 'unverified' : Geocodio failed guards (or API unavailable). Caller
 *                    keeps stored coord; signal logged for manual review.
 *
 * If apiKey is empty/missing, returns all rows as 'unverified' with a
 * warning. Routine merges that lose Geocodio access shouldn't break —
 * they just lose the validation safety net for that run.
 */
export async function validateCoords(rows, apiKey) {
  if (!apiKey) {
    console.warn('[validateCoords] GEOCODIO_API_KEY not set — skipping validation')
    return rows.map((r) => ({
      id: r.id,
      action: 'unverified',
      lat: r.lat,
      lng: r.lng,
      reason: 'GEOCODIO_API_KEY missing — validation skipped',
      originalLat: r.lat,
      originalLng: r.lng,
    }))
  }

  const filtered = rows.filter((r) => r.address && r.lat != null && r.lng != null)
  if (filtered.length === 0) return []

  const responses = await geocodeBatch(filtered.map((r) => r.address), apiKey)
  if (responses === null) {
    return rows.map((r) => ({
      id: r.id,
      action: 'unverified',
      lat: r.lat,
      lng: r.lng,
      reason: 'Geocodio API unreachable — validation skipped',
      originalLat: r.lat,
      originalLng: r.lng,
    }))
  }

  const decisions = []
  for (let i = 0; i < filtered.length; i++) {
    const row = filtered[i]
    const top = responses[i]?.response?.results?.[0]
    if (!top) {
      decisions.push({
        id: row.id,
        action: 'unverified',
        lat: row.lat,
        lng: row.lng,
        reason: 'Geocodio returned no result for address',
        originalLat: row.lat,
        originalLng: row.lng,
      })
      continue
    }

    const gLat = top.location.lat
    const gLng = top.location.lng
    const accuracy = top.accuracy
    const accuracyType = top.accuracy_type
    const matchedZip = top.address_components?.zip ?? null
    const inputZip = extractZip(row.address)
    const guardFailures = []
    if (!TRUSTED_ACCURACY_TYPE.has(accuracyType)) {
      guardFailures.push(`accuracy_type=${accuracyType}`)
    }
    if (accuracy < MIN_ACCURACY_SCORE) {
      guardFailures.push(`accuracy=${accuracy}<${MIN_ACCURACY_SCORE}`)
    }
    if (inputZip && matchedZip && inputZip !== matchedZip) {
      guardFailures.push(`zip ${inputZip}≠${matchedZip}`)
    }
    if (!inBayArea(gLat, gLng)) {
      guardFailures.push('outside bbox')
    }
    const delta = haversineMiles(row.lat, row.lng, gLat, gLng)

    if (guardFailures.length > 0) {
      // Geocodio not trustworthy — keep stored coord, log for review.
      decisions.push({
        id: row.id,
        action: 'unverified',
        lat: row.lat,
        lng: row.lng,
        reason: `Geocodio guards failed: ${guardFailures.join(', ')}; Δ=${delta.toFixed(2)}mi`,
        originalLat: row.lat,
        originalLng: row.lng,
      })
      continue
    }

    if (delta < TOLERANCE_MI) {
      decisions.push({
        id: row.id,
        action: 'keep',
        lat: row.lat,
        lng: row.lng,
        reason: `Δ=${delta.toFixed(3)}mi within tolerance`,
        originalLat: row.lat,
        originalLng: row.lng,
      })
      continue
    }

    if (delta >= 10) {
      // Stored coord is wildly off (10+ miles) AND Geocodio is confident.
      // Probable causes: typo'd address, LLM hallucinated coord, wrong row.
      // Don't auto-correct silently — drop the row so the curator sees it
      // missing in /admin/ingestion and investigates.
      decisions.push({
        id: row.id,
        action: 'reject',
        lat: row.lat,
        lng: row.lng,
        reason: `stored coord ${delta.toFixed(1)}mi from geocoded — likely bad address or fake coord`,
        originalLat: row.lat,
        originalLng: row.lng,
      })
      continue
    }

    if (delta >= DRIFT_THRESHOLD_MI) {
      // Drift in the 0.5–10mi range. Geocodio is confident; auto-correct.
      decisions.push({
        id: row.id,
        action: 'correct',
        lat: gLat,
        lng: gLng,
        reason: `Δ=${delta.toFixed(2)}mi corrected via Geocodio (acc=${accuracy}, ${accuracyType})`,
        originalLat: row.lat,
        originalLng: row.lng,
      })
      continue
    }

    // 0.05mi ≤ Δ < 0.5mi: minor drift, keep as-is. Cheaper than churning
    // every row's coord every run for sub-block adjustments.
    decisions.push({
      id: row.id,
      action: 'keep',
      lat: row.lat,
      lng: row.lng,
      reason: `Δ=${delta.toFixed(2)}mi minor — within 0.5mi threshold`,
      originalLat: row.lat,
      originalLng: row.lng,
    })
  }

  return decisions
}
