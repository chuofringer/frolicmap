import type { Item, ItemStatus } from '@shared/types'
import { DEFAULT_REGION } from '@shared/metros'
import { bboxAround, haversineMeters, PARK_PLAYGROUND_OVERLAP_M } from '@shared/osm'

/**
 * Is there already a `category='park'` row flagged `has_playground=1`
 * within `PARK_PLAYGROUND_OVERLAP_M` of `(lat, lng)`? (#217 — "Park +
 * playground pins overlap on close zoom".)
 *
 * The OSM playground ingester calls this before creating a standalone
 * `leisure=playground` node's pin: if the park that already covers this
 * exact playground (via #220's flag) is right there, a second pin for the
 * same amenity is noise a parent has to disambiguate at high zoom, not a
 * second destination to choose between.
 *
 * A bbox pre-filter (backed by `idx_items_park_has_playground`, migration
 * 0031) narrows the D1 scan before the true-circle `haversineMeters` check —
 * park rows are numerous enough per metro that a naive full-table distance
 * scan isn't worth it for a check this cheap to bound first.
 */
export async function hasNearbyFlaggedPark(db: D1Database, lat: number, lng: number): Promise<boolean> {
  const box = bboxAround(lat, lng, PARK_PLAYGROUND_OVERLAP_M)
  const { results } = await db
    .prepare(
      `SELECT lat, lng FROM items
       WHERE category = 'park' AND has_playground = 1
         AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .bind(box.south, box.north, box.west, box.east)
    .all<{ lat: number; lng: number }>()
  return results.some((r) => haversineMeters({ lat, lng }, r) <= PARK_PLAYGROUND_OVERLAP_M)
}

export async function listByStatus(db: D1Database, status: ItemStatus): Promise<Item[]> {
  const { results } = await db
    .prepare('SELECT * FROM items WHERE status = ? ORDER BY category, name')
    .bind(status)
    .all<Row>()
  return results.map(rowToItem)
}

/**
 * Region-scoped variant of `listByStatus` (national expansion, plan §2.0).
 * Backed by `idx_items_region_status` from migration 0016.
 *
 * `region` is validated against the metro registry by the caller — this
 * function will happily return an empty array for an unknown id, which is
 * why `/api/items.json` 400s on a bad `?region=` instead of quietly
 * serving nothing.
 */
export async function listByStatusAndRegion(
  db: D1Database,
  status: ItemStatus,
  region: string,
): Promise<Item[]> {
  const { results } = await db
    .prepare('SELECT * FROM items WHERE status = ? AND region = ? ORDER BY category, name')
    .bind(status, region)
    .all<Row>()
  return results.map(rowToItem)
}

export interface AdminItemQuery {
  status: ItemStatus
  region?: string
  sourceType?: string
  limit: number
  offset: number
}

/**
 * Filtered, paginated admin listing (#368).
 *
 * `listByStatus` returns every matching row, which stops being fine the
 * moment national pending rows land: a few thousand IMLS museums would bury
 * every other metro's review in one unpaginated response. Region and source filters let the curator keep
 * working a single queue.
 *
 * Returns the page plus the unpaginated total so the UI can show "1–50 of N"
 * and the curator knows how much is behind the filter. Two queries rather
 * than a window function — simpler, and the count is cheap against
 * `idx_items_region_status`.
 */
export async function listItemsForAdmin(
  db: D1Database,
  q: AdminItemQuery,
): Promise<{ items: Item[]; total: number }> {
  const where = ['status = ?']
  const params: (string | number)[] = [q.status]
  if (q.region) { where.push('region = ?'); params.push(q.region) }
  if (q.sourceType) { where.push('source_type = ?'); params.push(q.sourceType) }
  const whereSql = where.join(' AND ')

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM items WHERE ${whereSql}`)
    .bind(...params)
    .first<{ n: number }>()

  const { results } = await db
    .prepare(
      `SELECT * FROM items WHERE ${whereSql} ORDER BY category, name LIMIT ? OFFSET ?`,
    )
    .bind(...params, q.limit, q.offset)
    .all<Row>()

  return { items: results.map(rowToItem), total: countRow?.n ?? 0 }
}

/**
 * Distinct regions and source_types present at a given status, with counts.
 *
 * The admin filter dropdowns are populated from this rather than a hardcoded
 * list: a hand-maintained copy of the `source_type` CHECK list would be wrong the
 * day a new importer lands, which is the exact drift class that made
 * `ALL_CATEGORIES` a single source of truth. Reading the facets from the data
 * means the dropdown can only ever offer filters that would return rows.
 */
export async function adminFacets(
  db: D1Database,
  status: ItemStatus,
): Promise<{ regions: { value: string; n: number }[]; sourceTypes: { value: string; n: number }[] }> {
  const [regions, sourceTypes] = await Promise.all([
    db.prepare('SELECT region AS value, COUNT(*) AS n FROM items WHERE status = ? GROUP BY region ORDER BY n DESC')
      .bind(status).all<{ value: string; n: number }>(),
    db.prepare('SELECT source_type AS value, COUNT(*) AS n FROM items WHERE status = ? GROUP BY source_type ORDER BY n DESC')
      .bind(status).all<{ value: string; n: number }>(),
  ])
  return { regions: regions.results, sourceTypes: sourceTypes.results }
}

/** Id of the row currently holding `slug`, or null. Backed by idx_items_slug. */
export async function getIdBySlug(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM items WHERE slug = ?')
    .bind(slug)
    .first<{ id: string }>()
  return row?.id ?? null
}

export async function getById(db: D1Database, id: string): Promise<Item | null> {
  const row = await db
    .prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first<Row>()
  return row ? rowToItem(row) : null
}

export async function upsert(db: D1Database, item: Item): Promise<void> {
  await db
    .prepare(
      `INSERT INTO items (
        id, type, name, description, category, lat, lng, address,
        age_min, age_max, cost, price_usd, indoor, opening_hours,
        photo_url, photo_attribution,
        website, source_url, source_type, confidence, status, last_verified,
        created_at, updated_at,
        region, city, attributes, slug, has_playground, name_zh
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        category=excluded.category,
        lat=excluded.lat,
        lng=excluded.lng,
        address=excluded.address,
        age_min=excluded.age_min,
        age_max=excluded.age_max,
        cost=excluded.cost,
        price_usd=excluded.price_usd,
        indoor=excluded.indoor,
        opening_hours=excluded.opening_hours,
        -- Once a row has a backfilled photo (worker/scripts/backfill-photos.mjs,
        -- issue #299), a routine ingest re-run must not blank it back out — no
        -- importer today produces photo_url/photo_attribution (they always pass
        -- null), so an unconditional overwrite here would silently erase every
        -- backfilled photo on the next cron pass. COALESCE keeps the stored
        -- value and only fills it from an importer once one actually starts
        -- supplying photos — same pattern as the slug preservation below.
        photo_url=COALESCE(items.photo_url, excluded.photo_url),
        photo_attribution=COALESCE(items.photo_attribution, excluded.photo_attribution),
        website=excluded.website,
        source_url=excluded.source_url,
        source_type=excluded.source_type,
        confidence=excluded.confidence,
        last_verified=excluded.last_verified,
        updated_at=excluded.updated_at,
        region=excluded.region,
        city=excluded.city,
        attributes=excluded.attributes,
        has_playground=excluded.has_playground,
        -- A published /place/{slug} URL must survive a refresh: once a row
        -- has a slug, an importer re-run never rewrites it (COALESCE keeps
        -- the stored value and only fills a NULL). Upstream renames change
        -- the display name, not the URL.
        slug=COALESCE(items.slug, excluded.slug),
        -- Chinese title (#692), preserved like photo_url but invalidated on a
        -- rename. No importer produces a translation (they all pass null), so
        -- an unconditional overwrite would erase every backfilled title on the
        -- next quarterly OSM pass. A COALESCE alone has the opposite failure
        -- though: when upstream RENAMES a venue, the old translation would
        -- outlive the English name it was translated from and quietly caption
        -- the row with the wrong place. So a changed name drops the stale
        -- translation and the row falls back to English until re-translated.
        name_zh=CASE
          WHEN excluded.name <> items.name THEN excluded.name_zh
          ELSE COALESCE(items.name_zh, excluded.name_zh)
        END`
    )
    .bind(
      item.id, item.type, item.name, item.description, item.category, item.lat, item.lng, item.address,
      item.age_min, item.age_max, item.cost, item.price_usd, item.indoor, item.opening_hours,
      item.photo_url, item.photo_attribution, item.website, item.source_url, item.source_type, item.confidence, item.status,
      item.last_verified, item.created_at, item.updated_at,
      item.region ?? DEFAULT_REGION,
      item.city ?? null,
      item.attributes ? JSON.stringify(item.attributes) : null,
      item.slug ?? null,
      item.has_playground ?? null,
      item.name_zh ?? null
    )
    .run()
}

/**
 * Directly set (or clear) a row's `slug`.
 *
 * `upsert` deliberately refuses to overwrite an existing slug — importer
 * re-runs must never break a published `/place/{slug}` URL. That protection
 * would otherwise make slugs permanently unfixable through every surface we
 * have: the admin `PUT` also goes through `upsert`, so a curator patching a
 * typo'd or awkward slug would have their change silently discarded.
 *
 * This is the escape hatch, admin-only. The trade-off is explicit: changing a
 * published slug breaks any existing link to the old URL, so the caller is
 * trusted to mean it.
 */
export async function setSlug(db: D1Database, id: string, slug: string | null): Promise<void> {
  await db
    .prepare('UPDATE items SET slug = ?, updated_at = ? WHERE id = ?')
    .bind(slug, new Date().toISOString(), id)
    .run()
}

/**
 * Directly set (or clear) a row's `photo_url` + `photo_attribution` (#299).
 *
 * Same escape-hatch shape as `setSlug` above, for the same reason: `upsert`
 * COALESCEs both photo columns so a backfilled photo survives an importer
 * re-run (see the comment on `upsert`), which also means a curator's admin
 * edit — a correction, or an explicit clear back to null — would be silently
 * dropped if it only went through `upsert`. The admin `PUT` handler calls
 * this whenever the incoming patch actually touches either field.
 */
export async function setPhoto(
  db: D1Database,
  id: string,
  photoUrl: string | null,
  photoAttribution: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE items SET photo_url = ?, photo_attribution = ?, updated_at = ? WHERE id = ?')
    .bind(photoUrl, photoAttribution, new Date().toISOString(), id)
    .run()
}

/**
 * Directly set (or clear) a row's Chinese title (#692).
 *
 * Third instance of the `setSlug`/`setPhoto` escape hatch, for the same
 * reason: `upsert` preserves a stored `name_zh` against importers that all
 * pass null, so a curator correcting a bad translation — or clearing one back
 * to null so the row falls back to English — would be silently dropped if the
 * edit only went through `upsert`. Called from the admin `PUT` whenever the
 * patch actually carries the field.
 */
export async function setNameZh(db: D1Database, id: string, nameZh: string | null): Promise<void> {
  await db
    .prepare('UPDATE items SET name_zh = ?, updated_at = ? WHERE id = ?')
    .bind(nameZh, new Date().toISOString(), id)
    .run()
}

export async function setStatus(db: D1Database, id: string, status: ItemStatus): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare('UPDATE items SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run()
}

type Row = {
  [K in keyof Item]:
    Item[K] extends Record<string, unknown> | null ? string | null :
    Item[K]
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function rowToItem(row: Row): Item {
  return {
    ...row,
    attributes: safeJsonParse<Record<string, unknown>>(row.attributes as unknown as string | null),
  } as Item
}
