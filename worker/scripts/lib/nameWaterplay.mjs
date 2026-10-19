/**
 * Pure naming logic for the waterplay-naming pass (issue #435 follow-up).
 *
 * Many national OSM waterplay rows carry a generic fallback name — "Splash pad"
 * or "Water park" (see `fallbackName` in `shared/osm.ts`), because splash pads
 * and spray grounds are usually mapped as an unnamed feature of a park rather
 * than a named POI. A pin labelled just "Splash pad" is poor UX; most of these
 * sit inside or beside a NAMED park/playground we already hold, so we can lift
 * the donor's name onto the water feature: "Splash pad at Volunteer Park".
 *
 * This module is the pure decision logic — generic-name detection, donor
 * eligibility, nearest-donor selection, and the composed name — split out of
 * `worker/scripts/name-waterplay.mjs` so it can be unit-tested without a DB.
 * The entry point owns all I/O (wrangler reads, SQL emission).
 */

import { haversineMeters, normalizeName } from './dedupPlaces.mjs'

/**
 * The exact unnamed-fallback labels `shared/osm.ts::fallbackName` assigns.
 * Canonical casing is what we re-emit into the composed name, so a row that
 * OSM happens to name "Splash Pad" (a real but still-generic tag value) is
 * normalized back to this label form.
 */
export const WATERPLAY_FALLBACK_LABELS = ['Water park', 'Splash pad']

/** Normalized fallback labels, for case-insensitive membership tests. */
const FALLBACK_SET = new Set(WATERPLAY_FALLBACK_LABELS.map((s) => normalizeName(s)))

/**
 * Vocabulary of purely-descriptive water-feature words. A name whose EVERY
 * token comes from this set names the feature type, not the place —
 * "Sprayground", "Splash Park", "water sprinkler", "Spray & Play Park" — and
 * is as generic as the fallback labels. Observed variants from the 2026-07-21
 * prod audit. Deliberately conservative: words that appear in real proper
 * names ("Station", "Country", "Zone") are NOT here, so "Splash Station" and
 * "Splash Country" survive as names.
 */
const GENERIC_TOKENS = new Set([
  'splash', 'splashpad', 'splashpark', 'spray', 'sprayground', 'sprinkler',
  'water', 'waterpark', 'waterplay', 'wading', 'paddling',
  'play', 'pad', 'park', 'pool', 'ground', 'grounds', 'playground', 'area', 'and', 'n',
])

/**
 * Names a park/playground donor must NOT carry — a generic placeholder is no
 * better than the fallback it would replace. Covers the waterplay fallbacks
 * themselves (a donor should never be another unnamed water feature) plus the
 * generic park placeholders seen in the wild. OSM/ParkServe/NPS drop unnamed
 * park and playground rows outright (no fallback label for those categories),
 * so this stays short and defensive.
 */
const GENERIC_DONOR_NAMES = new Set(
  [
    ...WATERPLAY_FALLBACK_LABELS,
    'Unknown Park',
    'Open Space',
    'Park',
    'Playground',
  ].map((s) => normalizeName(s)),
)

/**
 * Is this waterplay row's name generic? True for the exact fallback labels in
 * any case variant ("Splash Pad", "SPLASH PAD"), and for any name made up
 * ENTIRELY of descriptive water-feature words ("Sprayground", "Splash Park",
 * "water sprinkler"). A single non-generic token ("Turtle Splash Water Park",
 * "Splashpad Texas") makes the name real and it is left alone. This function
 * is the single source of truth — the script fetches all waterplay rows and
 * filters here, not in SQL.
 */
export function isGenericWaterplayName(name) {
  const n = normalizeName(name)
  if (!n) return false
  if (FALLBACK_SET.has(n)) return true
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((t) => GENERIC_TOKENS.has(t))
}

/**
 * The canonical fallback label for a generic waterplay name — "Water park" for
 * a water-park row, "Splash pad" for everything else. Mirrors the branch in
 * `shared/osm.ts::fallbackName` (leisure=water_park → "Water park", else
 * "Splash pad") so the re-emitted label matches what the importer would have
 * produced.
 */
export function waterplayFallbackLabel(name) {
  const n = normalizeName(name)
  return n.includes('water park') || n.includes('waterpark') ? 'Water park' : 'Splash pad'
}

/** Whether a park/playground row is usable as a name donor. */
export function isEligibleDonor(row) {
  if (!row || typeof row.name !== 'string') return false
  const n = normalizeName(row.name)
  if (!n) return false
  // A donor whose own name is purely descriptive ("Water Play Area") would
  // produce "Splash pad at Water Play Area" — no better than the fallback.
  return !GENERIC_DONOR_NAMES.has(n) && !isGenericWaterplayName(row.name)
}

/**
 * Does the donor's name already carry the water-feature word, so the "X at Y"
 * form would be redundant ("Splash pad at Rotary Splash Pad")? When it does we
 * use the donor name outright. Keyed to the row's feature type: a splash-pad
 * row looks for "splash"/"spray"; a water-park row for "water park"/"waterpark".
 */
function donorNamesFeature(donorName, label) {
  const n = normalizeName(donorName)
  if (label === 'Water park') return n.includes('water park') || n.includes('waterpark')
  return n.includes('splash') || n.includes('spray')
}

/** Nearest eligible donor within `maxDistanceM`, or null. */
function nearestDonor(row, donors, maxDistanceM) {
  let best = null
  let bestDist = Infinity
  for (const d of donors) {
    const dist = haversineMeters(row, d)
    if (dist <= maxDistanceM && dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best ? { donor: best, distanceM: bestDist } : null
}

/**
 * Decide the new name for one generic waterplay row given a list of candidate
 * donors, or null to leave it alone (no donor within range).
 *
 * `donors` may be pre-filtered by the caller; ineligible ones are skipped here
 * too so the function is safe to call with a raw list.
 */
export function pickWaterplayName(row, donors, maxDistanceM = 250) {
  const eligible = donors.filter(isEligibleDonor)
  // Prefer a PARK donor over a nearer playground: playground rows are often
  // sub-features whose names mean little standalone ("The Cove" inside
  // Ballard Commons Park) — the park is the name parents recognize. The
  // playground fallback still applies when no park is in range.
  const near =
    nearestDonor(row, eligible.filter((d) => d.category === 'park'), maxDistanceM) ??
    nearestDonor(row, eligible, maxDistanceM)
  if (!near) return null

  const label = waterplayFallbackLabel(row.name)
  const donorName = String(near.donor.name).trim()
  const name = donorNamesFeature(donorName, label) ? donorName : `${label} at ${donorName}`

  return {
    name,
    donorId: near.donor.id,
    donorName,
    distanceM: Math.round(near.distanceM),
  }
}

/**
 * Run the naming decision over every generic row in a region.
 *
 * Returns the list of renames (each with the row id, new name, donor id and
 * rounded distance) plus a count of rows left alone for lack of a nearby donor.
 */
/** Names this pass itself produced — eligible for recomputation under `revisit`. */
const PASS_NAME_RE = /^(?:Splash pad|Water park) at /

export function nameWaterplayRows(rows, donors, opts = {}) {
  const maxDistanceM = opts.maxDistanceM ?? 250
  // `revisit` re-opens names a previous pass composed ("Splash pad at X") so
  // an improved donor choice (e.g. the park-over-playground preference) can
  // supersede them. Hand-written names never match the composed pattern with
  // an eligible donor swap producing a DIFFERENT name, and identical
  // recomputations are skipped below, so revisit is idempotent.
  const revisit = opts.revisit ?? false
  // Callers may pass ALL waterplay rows — generic-name detection lives here.
  const genericRows = rows.filter(
    (r) => isGenericWaterplayName(r.name) || (revisit && PASS_NAME_RE.test(r.name)),
  )
  const eligible = donors.filter(isEligibleDonor)

  const renames = []
  let noDonor = 0
  for (const row of genericRows) {
    const picked = pickWaterplayName(row, eligible, maxDistanceM)
    if (!picked) {
      // A revisit row with no donor keeps its existing composed name — it is
      // not a fallback-labelled row, so it doesn't count as donor-less.
      if (!PASS_NAME_RE.test(row.name)) noDonor++
      continue
    }
    if (picked.name === row.name) continue
    renames.push({ id: row.id, ...picked })
  }

  return { genericCount: genericRows.length, renames, noDonor }
}
