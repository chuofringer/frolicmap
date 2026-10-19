import type { Category, Confidence, Item, ItemStatus } from './types'
import type { Bbox } from './metros'

/**
 * OSM / Overpass mapping core — the one copy of "what we ask OSM for" and
 * "how an Overpass element becomes an Item".
 *
 * This lives in `shared/` so that every caller shares one copy of it: the
 * national bootstrap (`worker/scripts/ingest-osm-national.mjs`) walks the metro
 * bboxes from a plain Node process, and the tests exercise the mapping directly.
 *
 * Everything here is pure and has NO runtime imports (the two `import type`
 * lines erase completely), which is what lets the `.mjs` script load this
 * file directly under Node's TypeScript type-stripping. Keep it that way: a
 * runtime import — especially one using the `@shared/*` path alias, which
 * plain Node cannot resolve — would break the national bootstrap.
 */

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** A license-safe photo candidate discovered at ingest time (issue #299). */
export interface PhotoCandidate {
  kind: 'commons'
  /** A Commons `File:...` page title — same shape the backfill script uses. */
  title: string
}

// Mirrors the accept half of `worker/scripts/lib/backfillPhotos.mjs::resolveCommonsTitle`
// (the OSM `image=` tag patterns it treats as a Commons file). Duplicated
// rather than imported: this file must stay free of runtime imports (see the
// file header) so the national bootstrap script can load it under Node's
// TypeScript type-stripping, and `backfillPhotos.mjs` lives outside `shared/`.
// Keep the two in sync by hand if either changes.
const COMMONS_FILE_PAGE_RE = /^https?:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i
const COMMONS_UPLOAD_RE = /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)$/i

/**
 * Ingest-time (network-free) half of the photo license-safety rule enforced
 * by `worker/scripts/lib/backfillPhotos.mjs::resolveCommonsTitle`. Resolving
 * a Commons title to a direct image URL + attribution needs a live Commons
 * API call (for `extmetadata`), which an ingest pass must never make inline — so this
 * only decides WHETHER a tag names a trustworthy Commons file and returns its
 * title; the backfill script (or a future offline pass reading
 * `attributes.photo_candidate`, see `overpassElementToItem` below) does the
 * actual resolution + verification.
 *
 * Returns a candidate for exactly the same tag shapes the backfill script
 * accepts (a `wikimedia_commons=File:*` tag, or an `image=*` tag that is
 * itself a Commons file page or raw `upload.wikimedia.org` URL) and null for
 * everything else — an untrusted host, a `Category:` page, or no tag at all.
 * Unlike `resolveCommonsTitle` this has no "skip with reason" case: that's a
 * CSV-report concern the backfill script owns, not ingest.
 */
export function resolvePhotoCandidateFromTags(
  tags: Record<string, string> | undefined,
): PhotoCandidate | null {
  if (!tags) return null

  const wc = typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons.trim() : ''
  if (wc) return wc.startsWith('File:') ? { kind: 'commons', title: wc } : null

  const image = typeof tags.image === 'string' ? tags.image.trim() : ''
  if (image) {
    const pageMatch = image.match(COMMONS_FILE_PAGE_RE)
    if (pageMatch) return { kind: 'commons', title: decodeURIComponent(pageMatch[1]) }
    const uploadMatch = image.match(COMMONS_UPLOAD_RE)
    if (uploadMatch) return { kind: 'commons', title: `File:${decodeURIComponent(uploadMatch[1])}` }
  }
  return null
}

export const CATEGORY_QUERY: Record<Category, string[]> = {
  playground: [`node[leisure=playground]`, `way[leisure=playground]`],
  museum:     [`node[tourism=museum]`, `way[tourism=museum]`],
  library:    [`node[amenity=library]`, `way[amenity=library]`],
  park:       [`way[leisure=park]`],
  aquarium:   [`node[tourism=aquarium]`, `way[tourism=aquarium]`],
  // Zoos + petting zoos (#323). `tourism=zoo` lived on the aquarium leg until
  // zoo became its own category; re-ingest flips those rows to `zoo` in place
  // (same `osm-{type}-{id}` id, upsert updates category, status preserved).
  // `zoo=petting_zoo` is queried on its own because some petting zoos carry
  // the subtag without `tourism=zoo`; elements tagged with both match both
  // clauses and collapse to one row via the shared id.
  zoo:        [`node[tourism=zoo]`, `way[tourism=zoo]`,
               `node[zoo=petting_zoo]`, `way[zoo=petting_zoo]`],
  beach:      [`node[natural=beach]`, `way[natural=beach]`],
  // Trailheads only — deliberately skips `route=hiking` relations to avoid
  // pulling in mega-relations like Bay Area Ridge Trail / Bay Trail that
  // would render as a single point hundreds of miles long.
  hiking:     [`node[information=trailhead]`, `way[information=trailhead]`],
  // Campgrounds + caravan/RV sites. Both tag families are kid-relevant —
  // many state parks tag drive-up campgrounds as tourism=camp_site and
  // RV-only loops as tourism=caravan_site.
  campground: [`node[tourism=camp_site]`, `way[tourism=camp_site]`,
               `node[tourism=caravan_site]`, `way[tourism=caravan_site]`],
  // Splash pads / water parks (#435). Tagged four different ways upstream and
  // we take all four: `leisure=water_park` (commercial + municipal water
  // parks) plus three spray-ground families — `playground=splash_pad`,
  // `playground:water=yes`, and `amenity=splash_pad`. A `playground:water=yes`
  // object is usually ALSO `leisure=playground`, so it matches BOTH this leg
  // and the playground leg; the national bootstrap resolves that collision to
  // `waterplay` by ordering waterplay BEFORE playground in OSM_CATEGORIES (see
  // below). Colon-keys are quoted so Overpass parses them literally.
  waterplay:  [`node[leisure=water_park]`, `way[leisure=water_park]`,
               `node[playground=splash_pad]`, `way[playground=splash_pad]`,
               `node["playground:water"=yes]`, `way["playground:water"=yes]`,
               `node[amenity=splash_pad]`, `way[amenity=splash_pad]`],
}

/**
 * Categories with a real OSM leg, smallest-first.
 *
 * The order matters for an interrupted run: the national script checkpoints
 * per category and works smallest-first, so a run that times out is still
 * incrementally useful.
 *
 * `waterplay` is deliberately placed BEFORE `playground` (#435). A splash pad
 * tagged `playground:water=yes` is also `leisure=playground`, so the same OSM
 * element matches both legs and yields the same `osm-{type}-{id}` id. The
 * national bootstrap does one cross-category dedup pass in this order and
 * keeps the first category it sees, so waterplay-before-playground makes a
 * water-equipped playground emit as `waterplay` — what a parent filtering
 * "Water Play" wants — never doubled as a plain playground.
 */
export const OSM_CATEGORIES: readonly Category[] = [
  // `zoo` before `aquarium`: a combined zoo-aquarium venue tagged with both
  // `tourism=zoo` and `tourism=aquarium` matches both legs, and the
  // first-category-wins dedup should keep it a zoo (the zoo is the venue,
  // the aquarium a wing of it).
  'zoo', 'aquarium', 'beach', 'park', 'waterplay',
  'playground', 'museum', 'library',
  'hiking', 'campground',
]

export function bboxString(bbox: Bbox): string {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
}

/**
 * Build an Overpass QL query for one category within one bbox.
 *
 * `timeoutSec` maps to Overpass's `[timeout:]` setting. The national
 * bootstrap raises it for large metros and, when a query still times out,
 * splits the bbox and retries — see `ingest-osm-national.mjs`.
 */
export function buildOverpassQueryForBbox(
  category: Category,
  bbox: Bbox,
  timeoutSec = 60,
): string {
  const clauses = CATEGORY_QUERY[category]
  const body = clauses.map((c) => `  ${c}(${bboxString(bbox)});`).join('\n')
  return `[out:json][timeout:${timeoutSec}];\n(\n${body}\n);\nout center tags;`
}

export interface OsmItemOptions {
  /** Metro id written to `items.region`. */
  region: string
  /** Coordinates outside this box are dropped. */
  bbox: Bbox
  /**
   * Tier signal (plan §1.6). Raw single-source OSM is Tier C —
   * `'medium'`.
   */
  confidence: Confidence
  /**
   * `'approved'` for the national bootstrap (trusted structured sources
   * auto-approve, plan §1.6/§4A.2).
   */
  status: ItemStatus
  /** Optional `items.city`, when the caller knows it. */
  city?: string | null
}

/**
 * Fallback display name for an unnamed element, by category.
 *
 * Every other leg drops unnamed elements (`return null` below) — a nameless
 * museum/library/park is noise. `waterplay` is the exception (#435): splash
 * pads and spray grounds are very frequently mapped without a `name` tag
 * (they're a feature of a park, not a named POI), so dropping the unnamed ones
 * would gut the layer. Give them a generic-but-honest label instead — a
 * `leisure=water_park` becomes "Water park", everything else "Splash pad" —
 * so a parent still sees the pin. Returns null for all other categories,
 * preserving the drop-unnamed behaviour they've always had.
 */
function fallbackName(tags: Record<string, string>, category: Category): string | null {
  if (category !== 'waterplay') return null
  return tags.leisure === 'water_park' ? 'Water park' : 'Splash pad'
}

/**
 * Indoor/outdoor prior by category. `null` would mean "unknown", not
 * "outdoor"; an override is a hand-written UPDATE applied with `wrangler d1 execute`.
 */
function indoorDefault(category: Category): 0 | 1 {
  return category === 'library' || category === 'museum' || category === 'aquarium' ? 1 : 0
}

export function overpassElementToItem(
  el: OverpassElement,
  category: Category,
  opts: OsmItemOptions,
): Item | null {
  const name = el.tags?.name ?? fallbackName(el.tags ?? {}, category)
  if (!name) return null
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  if (lat == null || lng == null) return null
  if (!inBbox(opts.bbox, lat, lng)) return null

  const id = `osm-${el.type}-${el.id}`
  const address = buildAddress(el.tags ?? {})
  const now = new Date().toISOString()
  // #299: never write `photo_url` from ingest — resolving a Commons title
  // needs a live API call this ingest path must not make. Stash the candidate
  // in `attributes` so an offline pass (an extended `backfill-photos.mjs`)
  // can resolve + verify it without re-querying Overpass for tags this
  // element already gave us.
  const photoCandidate = resolvePhotoCandidateFromTags(el.tags)

  return {
    id,
    type: 'place',
    name,
    description: null,
    category,
    lat,
    lng,
    address,
    age_min: null,
    age_max: null,
    cost: null,
    price_usd: null,
    indoor: indoorDefault(category),
    opening_hours: el.tags?.opening_hours ?? null,
    photo_url: null, photo_attribution: null,
    website: el.tags?.website ?? null,
    source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    source_type: 'osm',
    confidence: opts.confidence,
    status: opts.status,
    last_verified: now,
    created_at: now,
    updated_at: now,
    region: opts.region,
    city: opts.city ?? el.tags?.['addr:city'] ?? null,
    attributes: photoCandidate ? { photo_candidate: photoCandidate } : null,
    // Assigned by the page generator (#356) for the Tier A/B rows that earn a
    // standalone /place/{slug} page — not by the raw importer.
    slug: null,
    name_zh: null,
    // #220: a park feature tagged `playground=yes` has an on-site playground
    // that is almost never ALSO separately mapped as its own
    // `leisure=playground` node — the playground filter otherwise misses it
    // entirely. Only meaningful for `category==='park'`; every other
    // category (including a standalone `leisure=playground` node, which
    // isn't a park and carries no such tag) stays null, not 0 — 0 would
    // claim "checked, no playground" for rows nobody actually verified.
    has_playground: category === 'park' && el.tags?.playground === 'yes' ? 1 : null,
  }
}

export function inBbox(bbox: Bbox, lat: number, lng: number): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east
}

/**
 * Region a national-bootstrap row may be emitted under, or null when the
 * walked metro must CEDE the element.
 *
 * Metro bboxes are hand-set rectangles and neighbours overlap (LA/Riverside,
 * DC/Baltimore, the bay/sacramento band). An element inside two boxes must
 * resolve to exactly one region, deterministically — and a walk only speaks
 * for its own metro. When the registry (`metroForCoords`, population-order
 * first-match) names a different metro, this returns null and the walk emits
 * nothing: the canonical metro's bbox contains the point by definition, so
 * its own walk is the sole emitter. Reassigning instead of ceding let a
 * sacramento walk emit `region='bay'` rows.
 *
 * `metroFor` is injected (same pattern as the IMLS importers' `metroFor`) so
 * this module keeps zero runtime imports — the constraint that lets plain
 * Node load it under type-stripping.
 */
export function resolveNationalRegion(
  walkedRegionId: string,
  lat: number,
  lng: number,
  metroFor: (lat: number, lng: number) => { id: string } | undefined,
): string | null {
  const canonical = metroFor(lat, lng)
  if (!canonical) return null
  return canonical.id === walkedRegionId ? walkedRegionId : null
}

/**
 * Split a bbox into four quadrants. The national bootstrap's fallback when
 * Overpass times out on a dense metro: four smaller queries usually succeed
 * where one large one didn't.
 */
export function quadrants(bbox: Bbox): Bbox[] {
  const midLat = (bbox.south + bbox.north) / 2
  const midLng = (bbox.west + bbox.east) / 2
  return [
    { south: bbox.south, west: bbox.west, north: midLat, east: midLng },
    { south: bbox.south, west: midLng, north: midLat, east: bbox.east },
    { south: midLat, west: bbox.west, north: bbox.north, east: midLng },
    { south: midLat, west: midLng, north: bbox.north, east: bbox.east },
  ]
}

/**
 * Split a bbox into a north half and a south half (#253 — North Bay coverage
 * audit). Unlike `quadrants` (which also splits east/west for the national
 * bootstrap's dense-metro case), this is the narrow fix for a bbox that's
 * simply TALL: the Bay Area content bbox spans 1.71° of latitude
 * (36.89–38.60), well past the ~1.0° point where a single Overpass query
 * risks the timeout/memory ceiling on public infrastructure, and a
 * truncated run silently drops whichever elements Overpass hadn't reached
 * yet — often the north edge (Sonoma/Napa/Solano/Marin), simply because nothing
 * about node ordering favours them.
 */
export function splitBboxNS(bbox: Bbox): [Bbox, Bbox] {
  const mid = (bbox.south + bbox.north) / 2
  return [
    { south: mid, west: bbox.west, north: bbox.north, east: bbox.east },
    { south: bbox.south, west: bbox.west, north: mid, east: bbox.east },
  ]
}

/** Height of a bbox in degrees of latitude. */
export function bboxHeightDeg(bbox: Bbox): number {
  return bbox.north - bbox.south
}

/**
 * Latitude past which an N/S split is worth attempting on a truncated
 * response (#253). Not a hard science — just the point where a single
 * Overpass query is plausibly too big for the free instance.
 */
export const TALL_BBOX_SPLIT_THRESHOLD_DEG = 1.0

/**
 * Parsed shape of a raw Overpass `/api/interpreter` JSON response.
 *
 * `remark` is Overpass's own signal that a query did NOT run to completion —
 * commonly `"runtime error: Query timed out in ... after N seconds."` or an
 * out-of-memory variant. Overpass still answers with HTTP 200 in that case,
 * and `elements` (if present at all) is a PARTIAL result: whatever had been
 * collected before the timeout/memory ceiling hit, in no guaranteed spatial
 * order. Treat `remark !== null` as "do not trust this result set as
 * complete" — it plausibly dropped rows anywhere in the bbox, including the
 * far edge (which is exactly the North Bay's position in the Bay Area box).
 */
export interface OverpassParsedResponse {
  elements: OverpassElement[]
  remark: string | null
}

export function parseOverpassResponse(json: unknown): OverpassParsedResponse {
  const body = (json ?? {}) as { elements?: OverpassElement[]; remark?: string }
  return {
    elements: Array.isArray(body.elements) ? body.elements : [],
    remark: typeof body.remark === 'string' && body.remark.length > 0 ? body.remark : null,
  }
}

/**
 * Overlap radius for the park/playground pin-dedup (#217): "Park + playground
 * pins overlap on close zoom". A standalone OSM `leisure=playground` node
 * sitting inside a park that #220's `has_playground` flag already covers is
 * a second pin for the same amenity a parent has to squint to tell apart at
 * high zoom — the fix is to not create it in the first place, not to render
 * it differently. 30 m covers a playground structure's footprint inside its
 * park (a swing set a stone's throw from the park's own centroid/way node)
 * without reaching into a genuinely separate, adjacent playground.
 */
export const PARK_PLAYGROUND_OVERLAP_M = 30

/**
 * Great-circle distance in metres between two lat/lng points.
 *
 * Kept here (rather than importing `worker/scripts/lib/dedupPlaces.mjs`'s
 * copy) because this module has the zero-runtime-imports constraint the
 * national `.mjs` bootstrap depends on — see the file header.
 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * A lat/lng bounding box wide enough to contain every point within
 * `meters` of `(lat, lng)` — a cheap pre-filter for a D1 range query before
 * the caller narrows to a true circle with `haversineMeters`. Longitude
 * degrees shrink with latitude (`cos(lat)`), so the lng padding is widened
 * accordingly; latitude padding is constant (~111,320 m/degree everywhere).
 */
export function bboxAround(lat: number, lng: number, meters: number): Bbox {
  const latPad = meters / 111320
  const lngPad = meters / (111320 * Math.cos((lat * Math.PI) / 180) || 1)
  return { south: lat - latPad, north: lat + latPad, west: lng - lngPad, east: lng + lngPad }
}

function buildAddress(tags: Record<string, string>): string | null {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  const city = tags['addr:city']
  const state = tags['addr:state']
  const parts = [street, city, state].filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(', ') : null
}
