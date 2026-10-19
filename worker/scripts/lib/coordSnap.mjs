// Same-address coord-snapping primitives. Shared between:
//   - worker/scripts/merge-aggregators.mjs (intra-batch snap before SQL emit)
//   - worker/scripts/snap-coords-from-d1.mjs (post-merge D1 snap in CI)
//
// Problem: weekly aggregator extracts emit slightly-different lat/lng for
// the same venue across runs (LLM coord drift). The same canonical event
// then lands under multiple D1 ids (because of time-suffix preservation in
// canonicalIdFor) and accumulates as N pins clustered around the real
// venue. The same-address coord-snap pattern picks a single canonical
// (lat, lng) per normalized street address so all sibling rows render as
// one pin.
//
// Canonical (lat, lng) = the most-frequent coord bucket (~30m), with
// most-recent `last_verified` breaking ties. Bucket width 30m is wide
// enough to collapse LLM drift across runs but narrow enough that
// genuinely-distinct adjacent addresses don't get accidentally merged.

import { normalizeAddress } from './normalizeAddress.mjs'

const BUCKET = 0.0003

function pickCanonical(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const bk = `${Math.round(r.lat / BUCKET) * BUCKET}|${Math.round(r.lng / BUCKET) * BUCKET}`
    if (!buckets.has(bk)) buckets.set(bk, [])
    buckets.get(bk).push(r)
  }
  if (buckets.size < 2) return null
  const sorted = [...buckets.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    const aRecent = a[1].map((r) => r.last_verified ?? '').sort().pop() ?? ''
    const bRecent = b[1].map((r) => r.last_verified ?? '').sort().pop() ?? ''
    return bRecent.localeCompare(aRecent)
  })
  const winnerRows = sorted[0][1]
  const winnerByVerified = [...winnerRows].sort((a, b) =>
    (b.last_verified ?? '').localeCompare(a.last_verified ?? '')
  )
  return { lat: winnerByVerified[0].lat, lng: winnerByVerified[0].lng }
}

// Returns { id, address, current: {lat,lng}, target: {lat,lng} } for every
// row whose coord drifts from its address-group canonical by more than ~10m.
// Rows with no normalizable address (no street number) are skipped — they
// can't be reliably matched to siblings.
export function computeCoordSnaps(rows) {
  const groups = new Map()
  for (const r of rows) {
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue
    const key = normalizeAddress(r.address)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const snaps = []
  for (const rs of groups.values()) {
    if (rs.length < 2) continue
    const target = pickCanonical(rs)
    if (!target) continue
    for (const r of rs) {
      if (Math.abs(r.lat - target.lat) < 0.00001 && Math.abs(r.lng - target.lng) < 0.00001) continue
      snaps.push({
        id: r.id,
        address: r.address,
        current: { lat: r.lat, lng: r.lng },
        target,
      })
    }
  }
  return snaps
}
