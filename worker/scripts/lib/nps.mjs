/**
 * NPS (National Park Service) mapping logic — issue #383, plan §2.1 row 5.
 *
 * Pure: no filesystem, no network, no `shared/*` imports. The metro lookup is
 * injected, the same pattern as `lib/parkserve.mjs` and `lib/imls.mjs`, so this
 * module is unit-testable in the Worker test pool and reusable from the `.mjs`
 * seed script without either taking on the other's module-resolution needs.
 *
 * Field names and the designation vocabulary are read from the live NPS API,
 * not guessed:
 *   https://developer.nps.gov/api/v1/parks
 * Each park object looks like:
 *   { id, url, fullName, name, parkCode, description, designation, states,
 *     latitude, longitude, latLong,
 *     addresses: [{ type, line1, line2, line3, city, stateCode, postalCode }] }
 *
 * Two gotchas the mapping guards against:
 *   - `latitude`/`longitude` are STRINGS and are frequently empty ("") — a
 *     units-only record (e.g. a scenic trail with no single point) ships blank.
 *   - `designation` is the classifier, and it is deliberately conservative
 *     here: an NPS unit can be a park, a trailhead OR a historic site, so only
 *     the unambiguous park/trail designations map; everything else is skipped
 *     and counted rather than force-fit (issue #383).
 */

/**
 * Designation → category. Conservative by design (issue #383).
 *
 * Kept as an explicit allow-list keyed on the exact (lowercased) designation
 * string rather than a substring test, because substrings misfire: "National
 * Historical Park" and "National Military Park" both contain "Park" yet are
 * historic sites, not the green space a family visits. Anything not listed here
 * is skipped and tallied by designation.
 *
 *   park    — walk-in green space / recreation land
 *   hiking  — a long-distance trail unit
 *
 * Deliberately excluded (→ skipped): National Monument, National Memorial,
 * National Historic(al) Site, National Historical Park, National Battlefield /
 * Military Park, National Heritage Area/Corridor, National Historic Trail
 * (a commemorative route, not one hikeable path — Trail of Tears, Oregon Trail),
 * and blank designations. Skipping is the correct answer for these, not a bug.
 */
export const DESIGNATION_CATEGORY = {
  'national park': 'park',
  'national park & preserve': 'park',
  'national preserve': 'park',
  'national recreation area': 'park',
  'national seashore': 'park',
  'national lakeshore': 'park',
  'national scenic trail': 'hiking',
}

/**
 * NPS parkCodes are already short lowercase slugs ("yell", "grca", "gate"), but
 * normalise the same way as the OSM/IMLS/ParkServe ids so a stray character
 * can't produce a malformed primary key.
 */
export function npsId(parkCode) {
  const slug = String(parkCode ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `nps-${slug}` : null
}

/** Collapse embedded whitespace/newlines; treat blank as absent. */
function clean(v) {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? s : null
}

/** Parse a string coordinate. Empty and 0 (null-island / "no point") → null. */
export function parseCoord(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n === 0) return null
  return n
}

/**
 * Truncate a description at a word boundary with an ellipsis. NPS descriptions
 * run long (several hundred chars); the popup only needs a lede.
 */
export function truncateDescription(raw, maxLen = 500) {
  const s = clean(raw)
  if (!s || s.length <= maxLen) return s
  const cut = s.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : maxLen).trimEnd()}…`
}

/**
 * The park's Physical address (there is also a Mailing address, often a PO box
 * — never a place to visit). Returns the formatted line and the city.
 */
export function physicalAddress(addresses) {
  if (!Array.isArray(addresses)) return { line: null, city: null }
  const p = addresses.find((a) => String(a?.type ?? '').toLowerCase() === 'physical')
  if (!p) return { line: null, city: null }
  const city = clean(p.city)
  const parts = [clean(p.line1), clean(p.line2), clean(p.line3), city, clean(p.stateCode), clean(p.postalCode)]
    .filter(Boolean)
  return { line: parts.length ? parts.join(', ') : null, city }
}

/**
 * Map one NPS park object to an Item, or `{ skipped }` with the reason.
 *
 * `metroFor` is `metroForCoords` from the registry: it does the per-metro bbox
 * assignment AND cedes a contested coordinate to the higher-population metro
 * (first match by registry order), so nothing here reassigns regions by hand.
 */
export function npsParkToItem(park, metroFor, { status, confidence, descMaxLen = 500 } = {}) {
  const name = clean(park?.fullName) ?? clean(park?.name)
  if (!name) return { skipped: 'no name' }

  const parkCode = clean(park?.parkCode)
  const id = npsId(parkCode)
  if (!id) return { skipped: 'no parkCode' }

  const designation = clean(park?.designation)
  const category = DESIGNATION_CATEGORY[String(designation ?? '').toLowerCase()]
  // Conservative mapping (issue #383): tally by designation so the operator
  // sees exactly what was skipped (historic sites, monuments, memorials, …).
  if (!category) return { skipped: `designation: ${designation ?? '(blank)'}` }

  const lat = parseCoord(park?.latitude)
  const lng = parseCoord(park?.longitude)
  if (lat === null || lng === null) return { skipped: 'no coordinates' }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { skipped: 'coordinates out of range' }

  const metro = metroFor(lat, lng)
  // Plan §1.1: a unit outside every metro bbox is deferred, not ingested. Most
  // of the NPS system lands here — that's expected, not a bug.
  if (!metro) return { skipped: 'outside every metro bbox' }

  const { line: address, city } = physicalAddress(park?.addresses)
  // Canonical-source policy: nps.gov IS the publisher for a federal unit, so
  // website and source_url both point at the park's official page. Fall back to
  // the deterministic canonical URL when the payload omits `url`.
  const url = clean(park?.url) ?? `https://www.nps.gov/${parkCode}/index.htm`
  const states = clean(park?.states)
  const attributes = { designation }
  if (states) attributes.states = states

  const now = new Date().toISOString()
  return {
    row: {
      id,
      type: 'place',
      name,
      description: truncateDescription(park?.description, descMaxLen),
      category,
      lat,
      lng,
      address,
      age_min: null,
      age_max: null,
      // NPS fee structure varies per unit and per pass; leave cost unknown
      // rather than guessing from the payload's entranceFees.
      cost: null,
      price_usd: null,
      indoor: 0,
      opening_hours: null,
      photo_url: null,
      website: url,
      source_url: url,
      source_type: 'nps',
      confidence,
      status,
      last_verified: now,
      created_at: now,
      updated_at: now,
      region: metro.id,
      city,
      attributes,
      slug: null,
    },
  }
}

/** Fold `{row}` / `{skipped}` results into rows plus a reason histogram. */
export function collect(results) {
  const rows = []
  const skipped = {}
  for (const r of results) {
    if (r.row) rows.push(r.row)
    else skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1
  }
  return { rows, skipped }
}
