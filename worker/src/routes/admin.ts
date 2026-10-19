import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../env'
import { cfAccess } from '../middleware/cfAccess'
import { listItemsForAdmin, adminFacets, getById, getIdBySlug, setStatus, setSlug, setPhoto, setNameZh, upsert } from '../db/items'
import { isValidRegion } from '@shared/metros'
import { isAllowedPhotoUrl, ALLOWED_PHOTO_HOSTS } from '@shared/photoHost'
import { listReports, resolveReport } from '../db/reports'
import { purgeItemsCache, purgeItemDetailCache } from '../utils/cache'
import { CRON_CADENCES, classifyCron, type CronHealth, type CronLogRow } from '../utils/cronHealth'
import { runOsmIngest } from '../ingest/osm'
import type { Item, ItemStatus } from '@shared/types'

export const adminRouter = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>()

// CORS must run BEFORE cfAccess so that preflight OPTIONS requests succeed
// without a JWT (CF Access cookies are sent only on the follow-up request).
// `credentials: true` pairs with the frontend's `fetch(..., {credentials: 'include'})`
// so CF Access cookies ride cross-origin from frolicmap.app → api.frolicmap.app.
// Origin MUST be an explicit list (not '*') when credentials is enabled.
adminRouter.use('/api/admin/*', cors({
  origin: ['https://frolicmap.app', 'http://localhost:5173'],
  credentials: true,
  allowHeaders: ['content-type', 'x-dev-admin'],
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
}))
adminRouter.use('/api/admin/*', cfAccess)

adminRouter.get('/api/admin/ping', (c) => c.json({ ok: true, email: c.get('adminEmail') }))

// Admin queue listing (#368). Filterable by region + source_type and
// paginated, so national pending rows can't bury the weekly Bay review in one
// unbounded response.
//
// Defaults are deliberately the pre-national behaviour for the curator's
// working queue: `status=pending`, no region filter, first page. The UI sends
// `region=bay` explicitly; leaving it off here keeps the endpoint useful for
// "show me everything pending across all metros".
const ADMIN_PAGE_DEFAULT = 100
const ADMIN_PAGE_MAX = 500
const VALID_STATUSES: readonly ItemStatus[] = ['pending', 'approved', 'rejected', 'archived']

adminRouter.get('/api/admin/items', async (c) => {
  // Validate against the registry / union rather than passing strings to SQL.
  // An unknown value returning an empty list reads as "nothing to review",
  // which is the wrong thing to tell a curator.
  const statusRaw = c.req.query('status') ?? 'pending'
  if (!VALID_STATUSES.includes(statusRaw as ItemStatus)) {
    return c.json({ error: 'unknown status' }, 400)
  }
  const status = statusRaw as ItemStatus

  const region = c.req.query('region')
  if (region !== undefined && !isValidRegion(region)) {
    return c.json({ error: 'unknown region' }, 400)
  }
  // Format guard only. Values are bound parameters so there's no injection
  // surface; the real vocabulary is the D1 CHECK's ~70 source_types, which the
  // facets below reflect from the data rather than a hand-copied list.
  const sourceType = c.req.query('source_type')
  if (sourceType !== undefined && !/^[a-z0-9-]{1,50}$/.test(sourceType)) {
    return c.json({ error: 'malformed source_type' }, 400)
  }

  const rawLimit = Number(c.req.query('limit') ?? ADMIN_PAGE_DEFAULT)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), ADMIN_PAGE_MAX)
    : ADMIN_PAGE_DEFAULT
  const rawOffset = Number(c.req.query('offset') ?? 0)
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0

  const [{ items, total }, facets] = await Promise.all([
    listItemsForAdmin(c.env.DB, { status, region, sourceType, limit, offset }),
    adminFacets(c.env.DB, status),
  ])
  return c.json({ items, total, limit, offset, facets })
})

adminRouter.get('/api/admin/items/:id', async (c) => {
  const item = await getById(c.env.DB, c.req.param('id'))
  if (!item) return c.json({ error: 'not found' }, 404)
  return c.json({ item })
})

adminRouter.post('/api/admin/items/:id/approve', async (c) => {
  const id = c.req.param('id')
  const existing = await getById(c.env.DB, id)
  if (!existing) return c.json({ error: 'not found' }, 404)
  await setStatus(c.env.DB, id, 'approved')
  // Purge both caches: list (pin appears) + detail (newly-approved row becomes
  // fetchable; a previous 404-cached response for this id could otherwise stick
  // for up to 1h if someone probed before approval).
  c.executionCtx.waitUntil(purgeItemsCache(c.env.FRONTEND_URL))
  c.executionCtx.waitUntil(purgeItemDetailCache(c.env.FRONTEND_URL, id))
  return c.json({ ok: true })
})

adminRouter.post('/api/admin/items/:id/reject', async (c) => {
  const id = c.req.param('id')
  const existing = await getById(c.env.DB, id)
  if (!existing) return c.json({ error: 'not found' }, 404)
  await setStatus(c.env.DB, id, 'rejected')
  // Row was publicly visible? Purge both caches: list (pin disappears) +
  // detail (bookmarked `?item=X` URLs otherwise leak the old approved body
  // via edge cache for up to 1h; the detail handler's `status==='approved'`
  // gate only fires on cache miss).
  if (existing.status === 'approved') {
    c.executionCtx.waitUntil(purgeItemsCache(c.env.FRONTEND_URL))
    c.executionCtx.waitUntil(purgeItemDetailCache(c.env.FRONTEND_URL, id))
  }
  return c.json({ ok: true })
})

adminRouter.put('/api/admin/items/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await getById(c.env.DB, id)
  if (!existing) return c.json({ error: 'not found' }, 404)
  const patch = await c.req.json<Partial<Item>>()
  // `region` has no D1 CHECK (0016 predates the registry being authoritative),
  // so a typo'd region in an edit would silently orphan the row from every
  // public surface — validate against the registry like the list endpoint.
  if ('region' in patch && (typeof patch.region !== 'string' || !isValidRegion(patch.region))) {
    return c.json({ error: 'unknown region' }, 400)
  }
  // Curator-pasted photo fields (#299). Host-allow-listed (not just
  // https-only — `shared/photoHost.ts::isAllowedPhotoUrl`, which also
  // rejects `javascript:`/`data:`/plain-`http:` via its scheme check) and
  // length-capped against an accidental paste of something enormous. Every
  // other photo_url producer in this codebase (the OSM ingest candidate
  // pass-through + the offline Commons backfill) only ever writes a
  // Wikimedia Commons URL — this field is the one place a human can type or
  // paste ANY string, so it is the one place that invariant needs an actual
  // gate: an `<img src>` on the public detail panel pointed at an arbitrary
  // third-party host would leak every viewer's IP to that host on every
  // page load and sidestep the license/attribution guarantee the rest of
  // this pipeline exists to uphold. The admin UI mirrors this same check
  // client-side, but the server is the actual gate. An empty string is the
  // "Clear" action from the editor — normalize it to NULL here so
  // downstream code only ever sees null-or-valid, never ''.
  const PHOTO_FIELD_MAX_LEN = 2048
  // Titles are short by nature; the cap only exists to keep a paste accident
  // out of the column, since nothing downstream truncates.
  const NAME_ZH_MAX_LEN = 300
  if ('photo_url' in patch) {
    const v = patch.photo_url
    if (v == null || v === '') {
      patch.photo_url = null
    } else if (typeof v !== 'string' || v.length > PHOTO_FIELD_MAX_LEN || !isAllowedPhotoUrl(v)) {
      return c.json({ error: `photo_url must be an https:// URL on one of: ${ALLOWED_PHOTO_HOSTS.join(', ')}` }, 400)
    }
  }
  if ('photo_attribution' in patch) {
    const v = patch.photo_attribution
    if (v == null || v === '') {
      patch.photo_attribution = null
    } else if (typeof v !== 'string' || v.length > PHOTO_FIELD_MAX_LEN) {
      return c.json({ error: 'photo_attribution must be a string (max 2048 chars)' }, 400)
    }
  }
  // Chinese title (#692). Blank normalizes to NULL so the row falls back to
  // its English name — the editor's "Clear" action, and the reason
  // `displayTitle` only ever has to distinguish null from a real string.
  if ('name_zh' in patch) {
    const v = patch.name_zh
    if (v == null) {
      patch.name_zh = null
    } else if (typeof v !== 'string') {
      return c.json({ error: `name_zh must be a string (max ${NAME_ZH_MAX_LEN} chars)` }, 400)
    } else {
      const trimmed = v.trim()
      if (!trimmed) {
        patch.name_zh = null
      } else if (trimmed.length > NAME_ZH_MAX_LEN) {
        return c.json({ error: `name_zh must be a string (max ${NAME_ZH_MAX_LEN} chars)` }, 400)
      } else {
        patch.name_zh = trimmed
      }
    }
  }
  // A slug change must not collide with another row's published URL. Check
  // before applying anything: the partial unique index would otherwise make
  // `setSlug` throw a raw constraint error (a 500 to the admin UI) after the
  // rest of the edit had already been written. A 409 naming the holder is
  // actionable; nothing is applied.
  if ('slug' in patch && patch.slug != null && patch.slug !== existing.slug) {
    const holder = await getIdBySlug(c.env.DB, patch.slug)
    if (holder && holder !== id) {
      return c.json({ error: 'slug already in use', conflicting_id: holder }, 409)
    }
  }
  // Match importer semantics: an English rename invalidates the translation
  // derived from the old name unless the curator supplies a fresh Chinese
  // title in the same edit. Without this, `merged` below would carry the old
  // `name_zh` into `upsert`, defeating its rename guard.
  if ('name' in patch && patch.name !== existing.name && !('name_zh' in patch)) {
    patch.name_zh = null
  }
  const merged: Item = {
    ...existing,
    ...patch,
    id,
    updated_at: new Date().toISOString(),
  }
  await upsert(c.env.DB, merged)
  // `upsert` preserves an existing slug on conflict so importer re-runs can't
  // break a published /place/{slug} URL — which means a curator's slug edit
  // would be silently dropped here. Apply it explicitly instead. Only fires
  // when the patch actually carries a slug change, so ordinary field edits
  // (the overwhelming majority) cost nothing extra.
  if ('slug' in patch && patch.slug !== existing.slug) {
    await setSlug(c.env.DB, id, patch.slug ?? null)
  }
  // Same reasoning as the slug override above: `upsert` COALESCEs
  // photo_url/photo_attribution so a backfilled photo survives an importer
  // re-run (see the comment on `upsert`), which means a curator's edit —
  // fixing a bad URL, adding/correcting attribution, or clearing both back
  // to null — would otherwise be silently dropped. Apply it directly
  // whenever the patch actually touches either field.
  if ('photo_url' in patch || 'photo_attribution' in patch) {
    await setPhoto(c.env.DB, id, merged.photo_url ?? null, merged.photo_attribution ?? null)
  }
  // And again for the Chinese title, which `upsert` preserves for the same
  // importer-safety reason (see `setNameZh`).
  if ('name_zh' in patch) {
    await setNameZh(c.env.DB, id, merged.name_zh ?? null)
  }
  // Edits only matter to the public feed if the item is (or was) approved.
  // Purge both list + detail — a curated-field change (description, address,
  // website) is invisible without detail purge since the list payload doesn't
  // carry those fields.
  if (existing.status === 'approved' || merged.status === 'approved') {
    c.executionCtx.waitUntil(purgeItemsCache(c.env.FRONTEND_URL))
    c.executionCtx.waitUntil(purgeItemDetailCache(c.env.FRONTEND_URL, id))
  }
  return c.json({ item: merged })
})

adminRouter.get('/api/admin/reports', async (c) => {
  const resolved = (c.req.query('resolved') === '1' ? 1 : 0) as 0 | 1
  const reports = await listReports(c.env.DB, resolved)
  return c.json({ reports })
})

adminRouter.post('/api/admin/reports/:id/resolve', async (c) => {
  await resolveReport(c.env.DB, Number(c.req.param('id')))
  return c.json({ ok: true })
})

adminRouter.get('/api/admin/ingestion-log', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM ingestion_log ORDER BY id DESC LIMIT 50')
    .all()
  return c.json({ log: results })
})

// Per-source last-run health card for /api/admin/observability. Cadence config + status classification live in ../utils/cronHealth
// (pulled out so the seasonal-pause branch is unit-testable with an injected
// `now`); this wrapper only owns the D1 round-trip.
async function computeCronHealth(db: D1Database, now: number): Promise<CronHealth[]> {
  const sourceIds = Object.keys(CRON_CADENCES)
  const placeholders = sourceIds.map(() => '?').join(',')
  const { results: logRows } = await db
    .prepare(
      `SELECT source_id, started_at, finished_at, fetched, inserted, updated, errors
         FROM ingestion_log
        WHERE id IN (
          SELECT MAX(id) FROM ingestion_log
           WHERE source_id IN (${placeholders})
           GROUP BY source_id
        )`
    )
    .bind(...sourceIds)
    .all<CronLogRow & { source_id: string; finished_at: string }>()
  const latestBySource = new Map<string, typeof logRows[number]>(
    logRows.map((r) => [r.source_id, r])
  )
  return sourceIds.map((id) => classifyCron(id, CRON_CADENCES[id], latestBySource.get(id), now))
}

// GET /api/admin/observability: operator dashboard data (issue #197).
// Returns the per-source last-run health card for the cron(s).
adminRouter.get('/api/admin/observability', async (c) => {
  const crons = await computeCronHealth(c.env.DB, Date.now())
  return c.json({ crons })
})

// POST /api/admin/run/:source: manual trigger for the scheduled OSM ingest.
// CF-Access-gated (inherits the router-level middleware). Use from the admin
// UI's Ingestion tab to force a run on demand instead of waiting for the
// next quarterly slot. Returns the handler's stats JSON.
//
// Supported sources: 'osm'.
adminRouter.post('/api/admin/run/:source', async (c) => {
  const source = c.req.param('source')
  try {
    if (source === 'osm') {
      const stats = await runOsmIngest(c.env.DB)
      return c.json({ source, ...stats })
    }
    return c.json({ error: `unknown source: ${source}` }, 400)
  } catch (err) {
    return c.json(
      { error: `run failed: ${err instanceof Error ? err.message : String(err)}` },
      500
    )
  }
})
