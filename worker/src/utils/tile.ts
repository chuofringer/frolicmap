// Vector tile (MVT) encoding for data-protection Phase 2b.
//
// This module wraps `geojson-vt` + `vt-pbf` so the public tile route stays
// thin. Given tile coordinates (z, x, y) and a set of points inside that
// tile's bbox, returns Mapbox-Vector-Tile-encoded bytes that MapLibre
// (Phase 2c frontend) will consume as a vector source.
//
// Design:
// - Per-request tile generation. We do NOT pre-build a geojson-vt index over
//   the whole dataset because (a) that's ~5000 points → ~500KB index
//   rebuilt on every worker cold-start, and (b) D1 cheaply serves bbox
//   queries backed by idx_items_status_lat_lng.
// - Flat 10000-row cap (see the `/api/tiles/*` query in routes/public.ts).
//   Dense tiles at low zoom (z ≤ 9) could still exceed that; current
//   implementation drops the tail. Phase 2c/2d can add proper clustering
//   or a density-based LIMIT. The frontend caps `maxzoom` at 12
//   (ItemSource.tsx) since by then a tile's bbox query returns well under
//   the cap for our data density, so deeper tiles buy nothing.
// - Properties: `{id, name, category, type}` plus, when present on the row,
//   the filter-relevant fields (age_min/max, cost, indoor, start_time,
//   end_time, rrule, exdates) — widened in #250 Phase 2d2 step (a) so a
//   future client-side filter refactor can read straight off the rendered
//   tile feature. Current frontend still filters via /api/items.json; these
//   properties are additive and unconsumed as of this change.
// - Single MVT layer named "items" so the client binds one layer to render
//   all pins (matches the current `ItemSource.tsx` structure).

import { cropEmoji } from '@shared/seasonalEmoji'

// @types/geojson-vt + @types/vt-pbf don't match the real runtime API:
// - geojson-vt's default export is a factory function, not a constructor
//   class (types declare `new GeoJSONVT(...)` but upstream does
//   `module.exports = function(data, options) { ... }`).
// - vt-pbf exposes `.fromGeojsonVt(layers)` and `.fromVectorTileJs(tile)`
//   on the default export; types only declare a narrower shape.
// We cast both to `any` here (with pinned package versions so the shim
// can't silently drift) and confine the casts to this module so the rest
// of the worker sees a typed `buildTile` interface.
// Ref: https://github.com/mapbox/vt-pbf#api
//      https://github.com/mapbox/geojson-vt#usage
import geojsonvtImport from 'geojson-vt'
import vtpbfImport from 'vt-pbf'
const geojsonvt = geojsonvtImport as unknown as (data: unknown, opts: unknown) => { getTile: (z: number, x: number, y: number) => unknown }
const vtpbf = vtpbfImport as unknown as {
  (tile: unknown): Uint8Array
  fromGeojsonVt: (layers: Record<string, unknown>, options?: { version?: number }) => Uint8Array
  fromVectorTileJs: (tile: unknown) => Uint8Array
}

/**
 * Convert MVT tile coordinates to a geographic bounding box (EPSG:4326).
 * Uses the standard Web Mercator inverse projection.
 * Tile origin is top-left, y increases downward.
 */
export function tileBbox(z: number, x: number, y: number): {
  west: number; south: number; east: number; north: number
} {
  const n = Math.pow(2, z)
  const west = (x / n) * 360 - 180
  const east = ((x + 1) / n) * 360 - 180
  const toLat = (mercY: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * mercY) / n))) * 180) / Math.PI
  const north = toLat(y)
  const south = toLat(y + 1)
  return { west, south, east, north }
}

export interface TilePoint {
  id: string
  name: string
  category: string
  type: 'place' | 'event'
  lat: number
  lng: number
  primary_crop_emoji?: string
  // Filter-relevant fields (#250 Phase 2d2 step (a)). Widened onto the tile
  // payload so client-side filter logic (age band, free/paid, indoor/outdoor,
  // date/time) can eventually read straight off the rendered tile feature
  // instead of the separate `/api/items.json` catalog fetch — see
  // docs/data-protection-plan.md Phase 2d2. Optional/nullable to match the
  // underlying D1 columns; not yet consumed by the frontend as of this
  // change (still additive — `applyFilters` keeps reading `/api/items.json`
  // until the frontend migration lands).
  age_min?: number | null
  age_max?: number | null
  cost?: string | null
  indoor?: number | null
  start_time?: string | null
  end_time?: string | null
  rrule?: string | null
  exdates?: string | null
}

/**
 * Logs when a tile's raw D1 row count reaches `fairCapByCategory`'s cap
 * (`TILE_ROW_CAP` = 10000 in routes/public.ts) — the point where thinning
 * actually starts dropping rows rather than passing every row through.
 * Bay-Area-density tiles never approach this; a hit signals either a very
 * dense low-zoom tile (a whole metro's bbox) or a bbox big enough to need
 * its own zoom-split. `console.warn` surfaces it in `wrangler tail` the same
 * way the BiblioCommons per-branch fallback does — a coverage/tuning signal,
 * not a request-time error, so the response still ships normally.
 */
export function warnIfTileCapped(z: number, x: number, y: number, rowCount: number, cap: number): void {
  if (rowCount >= cap) {
    console.warn(`[tile] row cap hit at z=${z} x=${x} y=${y}: ${rowCount} rows (cap=${cap})`)
  }
}

/**
 * Cap a set of tile rows at `capRows` total without biasing which
 * categories survive (#424).
 *
 * The tile query orders rows `ORDER BY category, ...` so draw order is
 * correct (see the comment in `public.ts`'s tile route), but a flat
 * `LIMIT` over that ordering amputates the alphabetic tail: once the cap
 * binds, every category after the cutoff point (e.g. `playground`,
 * `upick`, `waterplay`) disappears wholesale instead of every category
 * losing an even share.
 *
 * This walks the input round-robin — one row from each category present,
 * then a second row from each, and so on — so truncation removes each
 * category's least-favored rows (its tail in the caller's ordering) at
 * roughly the same rate, and no category vanishes unless every other
 * category present has fewer rows than it does. Deterministic: the same
 * input always keeps the same rows, so a cache miss doesn't visibly
 * reshuffle which pins are on the map. Output preserves the input's
 * relative order (so callers that already sorted for draw order don't
 * need to re-sort).
 */

export function fairCapByCategory<T extends { category: string }>(
  rows: T[],
  capRows: number,
): T[] {
  if (rows.length <= capRows) return rows

  const byCategory = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = byCategory.get(row.category)
    if (bucket) bucket.push(row)
    else byCategory.set(row.category, [row])
  }
  const buckets = [...byCategory.values()]

  const kept = new Set<T>()
  for (let i = 0; kept.size < capRows; i++) {
    let progressed = false
    for (const bucket of buckets) {
      if (i < bucket.length) {
        kept.add(bucket[i])
        progressed = true
        if (kept.size >= capRows) break
      }
    }
    if (!progressed) break // every bucket exhausted before hitting the cap
  }

  return rows.filter((row) => kept.has(row))
}

/**
 * Resolve the pin emoji for one U-Pick feature: first ripe crop in
 * `crops[]` order → its emoji; else first crop where state is 'next';
 * else `crops[0]` fallback. Returns `undefined` when the inputs are
 * unusable (missing, malformed JSON, empty crops array) so the caller
 * can omit the property from the tile feature — MapLibre then falls
 * through to the static category emoji.
 *
 * The v1-medium spec originally concatenated up to 2 ripe emojis (e.g.
 * "🍓🍒") to signal dual-ripe farms, but two glyphs at pin size render
 * as a squished blob on mobile. Per-crop ripeness still shows in the
 * popup's ripeness row, so no information is lost.
 *
 * Accepts `crops` / `crops_state` as EITHER the D1 JSON-string form (what
 * the tile route reads straight from SELECT) or the parsed object form
 * (what callers may already have).
 */
export function resolvePrimaryCropEmoji(
  crops: unknown,
  cropsState: unknown,
): string | undefined {
  let cropArr: unknown
  let state: unknown
  try {
    cropArr = typeof crops === 'string' ? JSON.parse(crops) : crops
    state = typeof cropsState === 'string' ? JSON.parse(cropsState) : cropsState
  } catch {
    return undefined
  }
  if (!Array.isArray(cropArr) || cropArr.length === 0) return undefined
  const s = (state && typeof state === 'object') ? state as Record<string, string> : {}
  const ripe = cropArr.find((c): c is string => typeof c === 'string' && s[c] === 'ripe')
  if (ripe) return cropEmoji(ripe)
  const next = cropArr.find((c): c is string => typeof c === 'string' && s[c] === 'next')
  const fallback = typeof cropArr[0] === 'string' ? cropArr[0] : undefined
  return cropEmoji(next ?? fallback)
}

/**
 * Build one tile feature's MVT properties from a `TilePoint`.
 *
 * Exported (rather than kept inline in `buildTile`) so the field-widening
 * logic (#250 Phase 2d2 step (a)) can be unit-tested directly against plain
 * objects, without decoding an actual MVT protobuf back out.
 *
 * MVT properties can't carry `null`/`undefined` (protobuf value types are
 * string/number/boolean), so absent/null fields are simply omitted rather
 * than written as a sentinel — matches how `primary_crop_emoji` was already
 * handled, and lets a future MapLibre filter expression use `has`/`!has` to
 * distinguish "field absent" the same way.
 */
export function tileFeatureProperties(p: TilePoint): Record<string, string | number> {
  const properties: Record<string, string | number> = {
    id: p.id,
    name: p.name,
    category: p.category,
    type: p.type,
  }
  if (p.primary_crop_emoji) properties.primary_crop_emoji = p.primary_crop_emoji
  if (p.age_min != null) properties.age_min = p.age_min
  if (p.age_max != null) properties.age_max = p.age_max
  if (p.cost != null) properties.cost = p.cost
  if (p.indoor != null) properties.indoor = p.indoor
  if (p.start_time != null) properties.start_time = p.start_time
  if (p.end_time != null) properties.end_time = p.end_time
  if (p.rrule != null) properties.rrule = p.rrule
  if (p.exdates != null) properties.exdates = p.exdates
  return properties
}

/**
 * Build a single MVT-encoded vector tile containing the given points.
 * Points OUTSIDE the tile bbox are silently dropped (defense against
 * caller bugs — the SQL query should only return in-bbox rows anyway).
 */
export function buildTile(
  z: number,
  x: number,
  y: number,
  points: readonly TilePoint[],
): Uint8Array {
  const features = points.map((p) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: tileFeatureProperties(p),
  }))

  // `maxZoom` tells geojson-vt the deepest zoom level it needs to support.
  // We index the one specific (z, x, y) we're asked for; no prefetch.
  // `extent: 4096` is the MVT standard tile resolution — MapLibre expects
  // this and it's the default, but stating it for clarity.
  const index = geojsonvt(
    { type: 'FeatureCollection', features },
    { maxZoom: z, indexMaxZoom: z, buffer: 0, tolerance: 0, extent: 4096 },
  )
  const tile = index.getTile(z, x, y) as { features?: unknown[] } | null
  if (!tile || !tile.features || tile.features.length === 0) {
    // vt-pbf rejects empty inputs — return a tiny valid "empty" tile so
    // the client handles it as "no pins here" rather than a network error.
    return vtpbf.fromVectorTileJs({ layers: { items: { version: 2, name: 'items', extent: 4096, length: 0, features: [] } } })
  }
  return vtpbf.fromGeojsonVt({ items: tile }, { version: 2 })
}
