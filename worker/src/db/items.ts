import type { Item, ItemStatus } from '@shared/types'
import { DEFAULT_REGION } from '@shared/metros'

/**
 * List rows of one status in one region (national expansion, plan §2.0).
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

export async function getById(db: D1Database, id: string): Promise<Item | null> {
  const row = await db
    .prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first<Row>()
  return row ? rowToItem(row) : null
}

/**
 * Reference upsert for a single row. The deployed Worker is read-only and
 * never calls this; data is loaded offline by the SQL that
 * `worker/scripts/lib/seedSql.mjs` emits. Kept as a seeding helper for the
 * integration tests, and it pins the photo / slug / name_zh preservation rules.
 */
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
        -- issue #299), a routine re-import must not blank it back out — no
        -- importer today produces photo_url/photo_attribution (they always pass
        -- null), so an unconditional overwrite here would silently erase every
        -- backfilled photo on the next import. COALESCE keeps the stored
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
        -- next OSM re-import. A COALESCE alone has the opposite failure
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
