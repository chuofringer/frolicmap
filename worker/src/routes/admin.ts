import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../env'
import { cfAccess } from '../middleware/cfAccess'
import { listItemsForAdmin, adminFacets, approveAllPending, pendingEventCountsBySource, getById, getIdBySlug, setStatus, setSlug, setPhoto, setNameZh, upsert } from '../db/items'
import {
  listSubmissionsForAdmin,
  getSubmissionById,
  markSubmissionApproved,
  markSubmissionRejected,
} from '../db/submissions'
import { isValidRegion, DEFAULT_REGION } from '@shared/metros'
import { isAllowedPhotoUrl, ALLOWED_PHOTO_HOSTS } from '@shared/photoHost'
import { listReports, resolveReport } from '../db/reports'
import { purgeItemsCache, purgeItemDetailCache } from '../utils/cache'
import { gateSource, type SourceAccuracyConfig } from '@shared/qualityGate'
import accuracyConfig from '../../../data/quality/source-accuracy.json'
import { slugify } from '../utils/slug'
import { cityFromAddress } from '../utils/cityFromAddress'
import { CRON_CADENCES, classifyCron, type CronHealth, type CronLogRow } from '../utils/cronHealth'
import { runOsmIngest } from '../ingest/osm'
import { runArchiveExpired } from '../archiveExpired'
import {
  makeProductionDeps,
  runStructuredFeedsIngest,
} from '../ingest/structuredFeeds'
import type { Item, ItemStatus, SubmissionStatus } from '@shared/types'
import type { SignupKind } from '@shared/signupSource'

export const adminRouter = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>()

// SQL twin of `shared/signupSource.ts::signupKind` — classify a
// `waitlist_signups` row as a typed-in newsletter opt-in or a row written as a
// side effect of a Google sign-in through the events gate. Keep in sync with
// the TS predicate (`source.startsWith('events-gate')`). GLOB, not LIKE:
// SQLite's LIKE is case-insensitive for ASCII, so it would classify a
// differently-cased source than the TS predicate does.
const SIGNUP_KIND_SQL =
  "CASE WHEN source GLOB 'events-gate*' THEN 'google_signin' ELSE 'newsletter' END"

// CORS must run BEFORE cfAccess so that preflight OPTIONS requests succeed
// without a JWT (CF Access cookies are sent only on the follow-up request).
// `credentials: true` pairs with the frontend's `fetch(..., {credentials: 'include'})`
// so CF Access cookies ride cross-origin from funradar.app → api.funradar.app.
// Origin MUST be an explicit list (not '*') when credentials is enabled.
adminRouter.use('/api/admin/*', cors({
  origin: ['https://funradar.app', 'http://localhost:5173'],
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

// Bulk approve everything pending behind the queue's current filter (region
// and/or source_type) as one UPDATE. Added after the 2026-W37 all-cities
// batch landed 21,220 pending rows (#659): "Approve this page" is 100 per
// click and each per-id approve costs a round trip + cache purge. Same
// validation as the GET list so a typo can't approve the wrong slice.
// Only the list cache is purged — per-id detail purges for tens of thousands
// of ids are not worth it: `/api/items/:id` is `private, max-age=3600`, so the
// edge never caches it and the detail purge is only defence-in-depth against
// intermediaries that ignore `private`.
adminRouter.post('/api/admin/items/approve-all', async (c) => {
  const body = await c.req.json<{ region?: unknown; source_type?: unknown }>().catch(() => ({}) as { region?: unknown; source_type?: unknown })
  const region = typeof body.region === 'string' && body.region !== '' ? body.region : undefined
  if (region !== undefined && !isValidRegion(region)) {
    return c.json({ error: 'unknown region' }, 400)
  }
  const sourceType = typeof body.source_type === 'string' && body.source_type !== '' ? body.source_type : undefined
  if (sourceType !== undefined && !/^[a-z0-9-]{1,50}$/.test(sourceType)) {
    return c.json({ error: 'malformed source_type' }, 400)
  }
  // Quality gate (#679): EVENT rows are bulk-approved only for source_types
  // whose latest weekly sample cleared the accuracy bar. Held sources' events
  // stay pending (approve them per-id after review, or update
  // data/quality/source-accuracy.json once a fresh sample passes); unsampled
  // sources are approved but reported. Place rows are never gated: the sample
  // measures event date/time/venue accuracy only.
  const config = accuracyConfig as SourceAccuracyConfig
  // The hold list comes from the CONFIG, not from the pending-count snapshot
  // below, so a held source's event that lands between the two queries is
  // still held rather than swept into the UPDATE.
  const holdSources = Object.keys(config.sources).filter((s) => gateSource(s, config).decision === 'hold')
  const pending = await pendingEventCountsBySource(c.env.DB, { region, sourceType })
  const held: { source_type: string; pending: number; accuracy: number; tier: string }[] = []
  const unsampled: { source_type: string; pending: number }[] = []
  for (const { source_type, n } of pending) {
    const g = gateSource(source_type, config)
    if (g.decision === 'hold' && g.accuracy !== null && g.tier !== null) {
      held.push({ source_type, pending: n, accuracy: g.accuracy, tier: g.tier })
    } else if (g.decision === 'unsampled') {
      unsampled.push({ source_type, pending: n })
    }
  }
  const approved = await approveAllPending(c.env.DB, { region, sourceType, holdEventSourceTypes: holdSources })
  if (approved > 0) c.executionCtx.waitUntil(purgeItemsCache(c.env.FRONTEND_URL))
  return c.json({ ok: true, approved, held, unsampled, thresholds: config.thresholds })
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

// --- User submissions moderation queue (#226) -------------------------------
//
// A member's suggested place/event lands in `submissions` (migration 0032),
// never `items` directly. This queue is the curator's review surface: list
// pending rows (with the submitter's email joined in for context), approve
// (copies into `items`) or reject (with an optional note the submitter never
// sees today, but keeps a record of why).

const SUBMISSION_VALID_STATUSES: readonly SubmissionStatus[] = ['pending', 'approved', 'rejected']

adminRouter.get('/api/admin/submissions', async (c) => {
  const statusRaw = c.req.query('status') ?? 'pending'
  if (!SUBMISSION_VALID_STATUSES.includes(statusRaw as SubmissionStatus)) {
    return c.json({ error: 'unknown status' }, 400)
  }
  // Same limit/offset clamping as GET /api/admin/items.
  const rawLimit = Number(c.req.query('limit') ?? ADMIN_PAGE_DEFAULT)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), ADMIN_PAGE_MAX)
    : ADMIN_PAGE_DEFAULT
  const rawOffset = Number(c.req.query('offset') ?? 0)
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0
  const { submissions, total } = await listSubmissionsForAdmin(c.env.DB, statusRaw as SubmissionStatus, { limit, offset })
  return c.json({ submissions, total, limit, offset })
})

// Approve: copies the submission into `items` as a curator-vouched-for
// manual row (`source_type='manual'`, `confidence='medium'` — a person
// looked at it, but it hasn't been independently verified the way a
// curator's own hand-add is) and stamps `item_id` back onto the submission.
//
// Idempotent: a submission that already carries `item_id` (i.e. was already
// approved) short-circuits before touching `items` again — re-clicking
// Approve, or a double-submit from a slow UI, can't create two rows for the
// same submission.
adminRouter.post('/api/admin/submissions/:id/approve', async (c) => {
  const id = c.req.param('id')
  const sub = await getSubmissionById(c.env.DB, id)
  if (!sub) return c.json({ error: 'not found' }, 404)
  if (sub.item_id) {
    return c.json({ ok: true, item_id: sub.item_id })
  }

  const now = new Date().toISOString()
  const itemId = `user-${slugify(sub.name, crypto.randomUUID().slice(0, 6))}`
  const item: Item = {
    id: itemId,
    type: sub.type ?? 'place',
    name: sub.name,
    description: sub.description,
    category: sub.category,
    lat: sub.lat,
    lng: sub.lng,
    address: sub.address,
    age_min: sub.age_min,
    age_max: sub.age_max,
    cost: sub.cost,
    price_usd: null,
    indoor: sub.indoor,
    opening_hours: null,
    start_time: sub.start_time,
    end_time: sub.end_time,
    rrule: null,
    exdates: null,
    photo_url: null,
    photo_attribution: null,
    website: sub.website,
    // `items.source_url` is NOT NULL; a submission's `source_url` and
    // `website` are both optional, so fall back in that order and finally
    // to the site itself rather than rejecting an otherwise-good submission
    // at approval time over a field the submitter had no obligation to fill.
    source_url: sub.source_url ?? sub.website ?? 'https://funradar.app',
    source_type: 'manual',
    confidence: 'medium',
    status: 'approved',
    last_verified: now,
    created_at: now,
    updated_at: now,
    crops: null,
    crops_state: null,
    in_season_now: null,
    region: sub.region ?? DEFAULT_REGION,
    city: cityFromAddress(sub.address),
    // Deliberately NOT `{ submitted_by: sub.user_id, submission_id: sub.id }`.
    // `items.attributes` rides straight through to the PUBLIC full-detail
    // response (`GET /api/items/:id` returns the whole `Item`, unlike the
    // redacted `ListItem`/tile projections) — stamping the submitter's
    // internal user id there would hand any signed-in (or guest-tier
    // session) viewer a stable identifier tying this pin to a specific
    // account, and tying it to every OTHER pin that carries the same id.
    // The audit trail already exists the other way around, admin-only:
    // `submissions.item_id` on this row (set below) lets a curator look up
    // who submitted a given item without exposing that link publicly.
    attributes: null,
    slug: null,
    has_playground: null,
    name_zh: null,
  }
  await upsert(c.env.DB, item)
  await markSubmissionApproved(c.env.DB, id, itemId, now)
  c.executionCtx.waitUntil(purgeItemsCache(c.env.FRONTEND_URL))
  return c.json({ ok: true, item_id: itemId })
})

adminRouter.post('/api/admin/submissions/:id/reject', async (c) => {
  const id = c.req.param('id')
  const sub = await getSubmissionById(c.env.DB, id)
  if (!sub) return c.json({ error: 'not found' }, 404)
  // Guard the mirror image of approve's idempotency check: a submission
  // that already carries `item_id` was already approved and copied into
  // `items`. Rejecting it now would flip `submissions.status` to
  // 'rejected' while the item it produced stays live and public — an
  // admin-queue record that lies about what's actually on the map. The UI
  // never offers Reject once a row leaves the pending tab; this guards the
  // same invariant against a direct API call.
  if (sub.item_id) {
    return c.json({ error: 'submission already approved; edit or archive the item instead' }, 409)
  }
  const body = await c.req.json<{ reviewer_note?: unknown }>().catch(() => ({}) as { reviewer_note?: unknown })
  const note = typeof body.reviewer_note === 'string' ? body.reviewer_note.trim().slice(0, 2000) || null : null
  await markSubmissionRejected(c.env.DB, id, note, new Date().toISOString())
  return c.json({ ok: true })
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

// Shared by /api/admin/observability and /api/admin/stats (#243) — both need
// the same per-source last-run health card, just packaged with different
// siblings. Cadence config + status classification live in ../utils/cronHealth
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

// GET /api/admin/observability — operator dashboard data (issue #197,
// extended in #273 to cover the 2 Claude Code Desktop routines). Single
// round-trip returning:
//   - crons: per-source last-run health card
//   - outbound_clicks: last-30d total + top 10 destination hosts
adminRouter.get('/api/admin/observability', async (c) => {
  const now = Date.now()
  const crons = await computeCronHealth(c.env.DB, now)

  // Outbound click stats — last 30 days, total + top 10 hosts.
  const cutoffSec = Math.floor((now - 30 * 86400000) / 1000)
  const totalRow = await c.env.DB
    .prepare('SELECT COUNT(*) as n FROM outbound_clicks WHERE ts >= ?')
    .bind(cutoffSec)
    .first<{ n: number }>()
  const { results: hostRows } = await c.env.DB
    .prepare(
      `SELECT dest_host, COUNT(*) as count
         FROM outbound_clicks
        WHERE ts >= ?
        GROUP BY dest_host
        ORDER BY count DESC
        LIMIT 10`
    )
    .bind(cutoffSec)
    .all<{ dest_host: string; count: number }>()

  return c.json({
    crons,
    outbound_clicks: {
      total_last_30d: totalRow?.n ?? 0,
      top_hosts: hostRows.map((r) => ({ host: r.dest_host, count: r.count })),
    },
  })
})

// GET /api/admin/stats — the "is everything OK" operator snapshot (issue
// #243: Admin Stats dashboard). Single round-trip, current-snapshot only (no
// time series — that's what /admin/behavior is for):
//   - items: counts by status / category / source_type (raw DB values — this
//     is an operator surface, not the public legend vocabulary; matches how
//     PendingQueue already lists `it.source_type` unlabeled)
//   - ingestion: the same per-source cron health card as /api/admin/observability
//     (computeCronHealth above), so this page's "which sources are stale"
//     answer never drifts from the Ingestion tab's
//   - reports: active vs. resolved counts (cross-links to the Reports tab)
//   - waitlist: active NEWSLETTER subscriber count (Google-sign-in rows are
//     not subscribers — same convention as WaitlistView's Phase 1 gate tile)
//   - outbound: last-30d total + top 5 destination hosts
//
// All three GROUP BY queries below run on indexed columns (idx_items_status,
// idx_items_category) except source_type, which has no dedicated index —
// same tradeoff PendingQueue's `adminFacets` already accepts for its
// per-status source_type facet, and `items` is small enough (thousands of
// rows) that an admin-only, human-triggered snapshot doesn't need one added.
adminRouter.get('/api/admin/stats', async (c) => {
  const db = c.env.DB
  const now = Date.now()

  const [{ results: itemsByStatus }, { results: itemsByCategory }, { results: itemsBySourceType }] =
    await Promise.all([
      db
        .prepare('SELECT status, COUNT(*) as count FROM items GROUP BY status ORDER BY count DESC')
        .all<{ status: string; count: number }>(),
      db
        .prepare('SELECT category, COUNT(*) as count FROM items GROUP BY category ORDER BY count DESC')
        .all<{ category: string; count: number }>(),
      db
        .prepare('SELECT source_type, COUNT(*) as count FROM items GROUP BY source_type ORDER BY count DESC')
        .all<{ source_type: string; count: number }>(),
    ])

  const crons = await computeCronHealth(db, now)

  const [reportsActiveRow, reportsResolvedRow] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM reports WHERE resolved = 0').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM reports WHERE resolved = 1').first<{ n: number }>(),
  ])

  // Active NEWSLETTER subscribers only (SIGNUP_KIND_SQL, same rule the
  // Waitlist tab's Phase 1 gate uses) — a Google sign-in row never asked for
  // email and shouldn't count as a subscriber here either.
  const waitlistActiveRow = await db
    .prepare(
      `SELECT COUNT(*) as n FROM waitlist_signups
        WHERE unsubscribed_at IS NULL AND ${SIGNUP_KIND_SQL} = 'newsletter'`
    )
    .first<{ n: number }>()

  const cutoffSec = Math.floor((now - 30 * 86400000) / 1000)
  const [outboundTotalRow, { results: outboundHostRows }] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM outbound_clicks WHERE ts >= ?').bind(cutoffSec).first<{ n: number }>(),
    db
      .prepare(
        `SELECT dest_host, COUNT(*) as count
           FROM outbound_clicks
          WHERE ts >= ?
          GROUP BY dest_host
          ORDER BY count DESC
          LIMIT 5`
      )
      .bind(cutoffSec)
      .all<{ dest_host: string; count: number }>(),
  ])

  return c.json({
    items: {
      byStatus: itemsByStatus,
      byCategory: itemsByCategory,
      bySourceType: itemsBySourceType,
    },
    ingestion: { crons },
    reports: {
      active: reportsActiveRow?.n ?? 0,
      resolved: reportsResolvedRow?.n ?? 0,
    },
    waitlist: {
      active: waitlistActiveRow?.n ?? 0,
    },
    outbound: {
      total_last_30d: outboundTotalRow?.n ?? 0,
      top_hosts: outboundHostRows.map((r) => ({ host: r.dest_host, count: r.count })),
    },
  })
})

// GET /api/admin/behavior?days=N[&region=<id>] — user-behavior dashboard
// data (issue #243).
//
// One round-trip powering /admin/behavior. Sections over a bounded window
// (days clamped 1..90, default 7):
//   - uiEvents  — the `ui_events` table (#481): totals + by-goal breakdown,
//     daily-per-goal series, top filter/coming-soon contexts, and top items
//     for popup_open joined to `items`. All tap aggregates exclude
//     `metro_view` (the visit signal — surfaced only via byRegion) and
//     `session_start` (the per-session denominator — surfaced via the
//     dedicated `sessions` count, which powers the funnel-rate divisions).
//   - outbound  — the `outbound_clicks` table (#166): totals, daily series,
//     top destination hosts, top items.
//   - waitlist  — `waitlist_signups` rows landing inside the window, split by
//     provenance: `newsletter` (typed-in opt-ins) vs `googleSignin` (rows the
//     events gate writes on sign-in). See shared/signupSource.ts.
//   - signin    — the events sign-in gate funnel (2026-07-26 experiment):
//     per-goal totals for the nine gate/calendar goals (scoped by `region=`),
//     an UNscoped region × gate-goal breakdown for the per-city conversion
//     table, and account counts from `users` (0022; site-wide — accounts
//     carry no region).
//   - byRegion  — per-city (metro) analytics (0021, extended #361): metro_view
//     visit counts, the day×region visit trend, ui-event goal counts per
//     region, outbound clicks attributed to their item's region, and waitlist
//     signups by the visitor's metro (`city` column). These are the always-on
//     cross-city overview and are NOT scoped by `region=`.
//
// `region=` (validated against the registry; unknown → 400) is the drill-down:
// it scopes ONLY the uiEvents/outbound/waitlist sections to one metro. ui_events
// carries its own `region`; outbound is attributed via items.region (JOIN);
// waitlist via its `city` column. Absent `region=` = all cities.
//
// EVERY section is bounded below by `ANALYTICS_EPOCH` (see the constant) — the
// dashboard reports nothing older than 2026-08-10, whatever the tables hold.
//
// `ts` / `created_at` are INTEGER epoch seconds; `date(ts,'unixepoch')` buckets
// them by UTC day. All "top" queries are LIMIT-bounded so a busy day can't
// return an unbounded payload. Item joins are LEFT JOINs — an event whose
// context/item_id no longer resolves (archived or never-existed id) still
// appears with a null name so its count isn't silently dropped. A NULL region
// (historical rows, off-metro events, clicks on removed items) surfaces as
// `region: null` — the frontend renders it as "unattributed".
const BEHAVIOR_DAYS_DEFAULT = 7
const BEHAVIOR_DAYS_MAX = 90

// --- analytics epoch --------------------------------------------------------
// Operator clean-slate decision of 2026-08-10: this dashboard reports NOTHING
// that happened before this UTC day, in EVERY section.
//
// Why it exists: the telemetry tables (`ui_events`, `outbound_clicks`) were
// wiped on 2026-08-10, but `waitlist_signups` and `users` keep their full
// history because the PRODUCT needs it (digest recipients, sign-in). Reporting
// the wiped tables next to the full-history ones gave one page two different
// start dates — some panels counting from Aug 6, others from Aug 10 — so no
// two numbers on it were comparable. Bounding every section at one date fixes
// that. The wiped tables get the bound too (belt-and-braces): a stray
// pre-wipe row must never resurface in a panel that claims to start here.
//
// This bounds REPORTING ONLY. No rows are deleted, and nothing outside this
// endpoint reads the constant — the waitlist list, the digest and sign-in all
// still see every row they always did.
const ANALYTICS_EPOCH = '2026-08-10' // UTC day
// The two column shapes the bound is compared against: telemetry and
// `waitlist_signups` store INTEGER epoch seconds, `users` stores a TEXT
// `datetime('now')` string ('YYYY-MM-DD HH:MM:SS', UTC, lexicographically
// ordered). Both are precomputed constants so every comparison binds a value
// against a bare column and stays sargable.
const ANALYTICS_EPOCH_SEC = Math.floor(Date.parse(`${ANALYTICS_EPOCH}T00:00:00Z`) / 1000)
const ANALYTICS_EPOCH_DATETIME = `${ANALYTICS_EPOCH} 00:00:00`

adminRouter.get('/api/admin/behavior', async (c) => {
  const rawDays = Number(c.req.query('days') ?? BEHAVIOR_DAYS_DEFAULT)
  const days = Number.isFinite(rawDays)
    ? Math.min(Math.max(Math.trunc(rawDays), 1), BEHAVIOR_DAYS_MAX)
    : BEHAVIOR_DAYS_DEFAULT
  // Window start, clamped to the epoch: a 90-day window reaching back past
  // 2026-08-10 stops there. Every windowed query below binds this one value,
  // so the clamp covers uiEvents/sessions/outbound/waitlist/byRegion at once.
  const cutoff = Math.max(Math.floor(Date.now() / 1000) - days * 86400, ANALYTICS_EPOCH_SEC)

  // Optional drill-down region. Validate against the registry like the queue
  // endpoint — an unknown id returning an empty dashboard reads as "no
  // activity" (wrong) instead of "bad request". Absent = all cities.
  const regionParam = c.req.query('region')
  if (regionParam !== undefined && !isValidRegion(regionParam)) {
    return c.json({ error: 'unknown region' }, 400)
  }
  const region = regionParam ?? null

  const db = c.env.DB

  // --- ui_events (scoped by `region=` when present) ----------------------
  // ui_events carries its own `region` column, so scoping is a plain AND.
  //
  // `metro_view` and `session_start` are EXCLUDED from every tap aggregate:
  // metro_view is the once-per-(session,metro) visit signal (its own
  // byRegion.visits/visitsDaily panels) and session_start is the once-per-
  // session denominator (its own `sessions` count below) — neither is a tap,
  // and counting them here would inflate "Taps on site" by one per session
  // (per metro) and leak meaningless rows into the by-goal chart.
  const uiRegionSql = region ? ' AND region = ?' : ''
  const uiBind = region ? [cutoff, region] : [cutoff]
  const notVisit = " AND goal NOT IN ('metro_view', 'session_start')"

  // sessions — the per-session funnel denominator (session_start fires once
  // per browser session on app mount, bot-guarded). Scoped by `region=` like
  // the rest of the uiEvents section, so per-session rates divide like for
  // like under a drill-down. Zero on windows predating the goal's deploy —
  // the dashboard renders rates as "—" then.
  const sessionsRow = await db
    .prepare(`SELECT COUNT(*) as n FROM ui_events WHERE goal = 'session_start' AND ts >= ?${uiRegionSql}`)
    .bind(...uiBind)
    .first<{ n: number }>()

  const uiTotalRow = await db
    .prepare(`SELECT COUNT(*) as n FROM ui_events WHERE ts >= ?${notVisit}${uiRegionSql}`)
    .bind(...uiBind)
    .first<{ n: number }>()

  const { results: byGoal } = await db
    .prepare(
      `SELECT goal, COUNT(*) as count
         FROM ui_events
        WHERE ts >= ?${notVisit}${uiRegionSql}
        GROUP BY goal
        ORDER BY count DESC`
    )
    .bind(...uiBind)
    .all<{ goal: string; count: number }>()

  const { results: uiDaily } = await db
    .prepare(
      `SELECT date(ts,'unixepoch') as day, goal, COUNT(*) as count
         FROM ui_events
        WHERE ts >= ?${notVisit}${uiRegionSql}
        GROUP BY day, goal
        ORDER BY day ASC`
    )
    .bind(...uiBind)
    .all<{ day: string; goal: string; count: number }>()

  // Top contexts for the two category-tagged goals. filter_chip = which
  // filters get toggled; coming_soon_tap = demand for not-yet-live layers in a
  // metro (the signal that picks the next depth city). NULL contexts excluded.
  const topContextsFor = async (goal: string) => {
    const { results } = await db
      .prepare(
        `SELECT context, COUNT(*) as count
           FROM ui_events
          WHERE goal = ? AND context IS NOT NULL AND ts >= ?${uiRegionSql}
          GROUP BY context
          ORDER BY count DESC
          LIMIT 10`
      )
      .bind(...(region ? [goal, cutoff, region] : [goal, cutoff]))
      .all<{ context: string; count: number }>()
    return results
  }
  const [filterChipContexts, comingSoonContexts] = await Promise.all([
    topContextsFor('filter_chip'),
    topContextsFor('coming_soon_tap'),
  ])

  // Top opened places. context holds the item id; LEFT JOIN so an unknown id
  // still lists (name/category null). Also selects the item's region for the
  // City column. When drilling into one metro, restrict to that metro's items
  // via i.region (turns the LEFT JOIN into an effective inner). `popup_open`
  // ONLY — the panel is titled "Most-opened places" with an "Opens" count, so
  // mixing `share` events in (as this once did) overstated the numbers.
  const { results: uiTopItems } = await db
    .prepare(
      `SELECT e.context as id, i.name as name, i.category as category, i.region as region, COUNT(*) as count
         FROM ui_events e
         LEFT JOIN items i ON i.id = e.context
        WHERE e.goal = 'popup_open' AND e.context IS NOT NULL AND e.ts >= ?${region ? ' AND i.region = ?' : ''}
        GROUP BY e.context
        ORDER BY count DESC
        LIMIT 10`
    )
    .bind(...uiBind)
    .all<{ id: string; name: string | null; category: string | null; region: string | null; count: number }>()

  // --- outbound_clicks (scoped by item region via JOIN when present) -----
  // outbound_clicks has no region column, so a region drill-down joins items
  // and filters i.region. Unscoped queries stay join-free except top items
  // (which already LEFT JOINs for the name).
  const { results: outTotalRows } = region
    ? await db
        .prepare(
          `SELECT COUNT(*) as n FROM outbound_clicks o
             JOIN items i ON i.id = o.item_id
            WHERE o.ts >= ? AND i.region = ?`
        )
        .bind(cutoff, region)
        .all<{ n: number }>()
    : await db
        .prepare('SELECT COUNT(*) as n FROM outbound_clicks WHERE ts >= ?')
        .bind(cutoff)
        .all<{ n: number }>()
  const outTotal = outTotalRows[0]?.n ?? 0

  const { results: outDaily } = region
    ? await db
        .prepare(
          `SELECT date(o.ts,'unixepoch') as day, COUNT(*) as count
             FROM outbound_clicks o JOIN items i ON i.id = o.item_id
            WHERE o.ts >= ? AND i.region = ?
            GROUP BY day
            ORDER BY day ASC`
        )
        .bind(cutoff, region)
        .all<{ day: string; count: number }>()
    : await db
        .prepare(
          `SELECT date(ts,'unixepoch') as day, COUNT(*) as count
             FROM outbound_clicks
            WHERE ts >= ?
            GROUP BY day
            ORDER BY day ASC`
        )
        .bind(cutoff)
        .all<{ day: string; count: number }>()

  const { results: outHosts } = region
    ? await db
        .prepare(
          `SELECT o.dest_host as host, COUNT(*) as count
             FROM outbound_clicks o JOIN items i ON i.id = o.item_id
            WHERE o.ts >= ? AND i.region = ?
            GROUP BY o.dest_host
            ORDER BY count DESC
            LIMIT 10`
        )
        .bind(cutoff, region)
        .all<{ host: string; count: number }>()
    : await db
        .prepare(
          `SELECT dest_host as host, COUNT(*) as count
             FROM outbound_clicks
            WHERE ts >= ?
            GROUP BY dest_host
            ORDER BY count DESC
            LIMIT 10`
        )
        .bind(cutoff)
        .all<{ host: string; count: number }>()

  const { results: outTopItems } = await db
    .prepare(
      `SELECT o.item_id as id, i.name as name, i.category as category, i.region as region, COUNT(*) as count
         FROM outbound_clicks o
         LEFT JOIN items i ON i.id = o.item_id
        WHERE o.ts >= ?${region ? ' AND i.region = ?' : ''}
        GROUP BY o.item_id
        ORDER BY count DESC
        LIMIT 10`
    )
    .bind(...(region ? [cutoff, region] : [cutoff]))
    .all<{ id: string; name: string | null; category: string | null; region: string | null; count: number }>()

  // --- waitlist (scoped by `city` when present) --------------------------
  // Split by provenance (2026-08-08): a Google sign-in writes a
  // `waitlist_signups` row nobody typed (`events-gate*`, see
  // public.ts::insertGateSignup), so a single "waitlist signups" number mixed
  // real newsletter opt-ins with sign-ins and read as inflated demand. Both
  // kinds are reported separately; `total` stays as the raw table count.
  const wlRegionSql = region ? ' AND city = ?' : ''
  const wlBind = region ? [cutoff, region] : [cutoff]

  const { results: wlByKind } = await db
    .prepare(
      `SELECT ${SIGNUP_KIND_SQL} as kind, COUNT(*) as count
         FROM waitlist_signups
        WHERE created_at >= ?${wlRegionSql}
        GROUP BY kind`
    )
    .bind(...wlBind)
    .all<{ kind: SignupKind; count: number }>()

  const { results: wlDailyRows } = await db
    .prepare(
      `SELECT date(created_at,'unixepoch') as day, ${SIGNUP_KIND_SQL} as kind, COUNT(*) as count
         FROM waitlist_signups
        WHERE created_at >= ?${wlRegionSql}
        GROUP BY day, kind
        ORDER BY day ASC`
    )
    .bind(...wlBind)
    .all<{ day: string; kind: SignupKind; count: number }>()

  const wlKindTotal = (kind: SignupKind) =>
    wlByKind.find((r) => r.kind === kind)?.count ?? 0
  const wlKindDaily = (kind: SignupKind) =>
    wlDailyRows.filter((r) => r.kind === kind).map(({ day, count }) => ({ day, count }))

  // --- signin: the events sign-in gate funnel (2026-07-26 experiment) ----
  // The gate's decision metric is unlock/view rate per surface and per city
  // (docs/specs/2026-07-26-signin-gated-events-plan.md §7). These goals get
  // their own queries instead of riding uiByRegion: that panel is
  // `ORDER BY count DESC LIMIT 200`, so in a busy week low-count gate rows
  // (exactly the ones the experiment needs) would be the first dropped.
  const GATE_GOALS = [
    'welcome_gate_view',
    'welcome_gate_guest',
    'welcome_gate_unlock',
    'events_gate_view',
    'events_gate_dismiss',
    'events_gate_unlock',
    'calendar_view',
    'calendar_gate_view',
    'calendar_gate_unlock',
  ]
  const gateIn = GATE_GOALS.map(() => '?').join(', ')

  // funnel — per-goal totals, scoped by the `region=` drill-down like uiEvents.
  const { results: signinFunnel } = await db
    .prepare(
      `SELECT goal, COUNT(*) as count
         FROM ui_events
        WHERE ts >= ? AND goal IN (${gateIn})${uiRegionSql}
        GROUP BY goal`
    )
    .bind(...(region ? [cutoff, ...GATE_GOALS, region] : [cutoff, ...GATE_GOALS]))
    .all<{ goal: string; count: number }>()

  // byRegion — region × gate-goal counts, NOT scoped (cross-city overview
  // convention, same as byRegion below). Bounded: ≤60 metros × 9 goals + NULL.
  const { results: signinByRegion } = await db
    .prepare(
      `SELECT region, goal, COUNT(*) as count
         FROM ui_events
        WHERE ts >= ? AND goal IN (${gateIn})
        GROUP BY region, goal
        ORDER BY count DESC
        LIMIT 600`
    )
    .bind(cutoff, ...GATE_GOALS)
    .all<{ region: string | null; goal: string; count: number }>()

  // accounts — real Google accounts (migration 0022). Site-wide only: users
  // rows carry no region (sign-in works from any city map). `created_at` is
  // TEXT `datetime('now')` — unlike the epoch-second analytics tables — so the
  // window compare converts the cutoff, not the column (keeps it sargable).
  // try/catch: on a deploy where 0022 hasn't been applied yet the whole
  // dashboard shouldn't 500 over one tile — surface zeros instead.
  // `returners` (retention signal, 2026-08-09): accounts that signed in at
  // least twice — `last_login_at > created_at`. The first sign-in's INSERT
  // sets both columns in one statement (same datetime('now')), so equality
  // means "never came back"; only a later upsert moves last_login_at past
  // created_at. Site-wide AND all-time like `total` — a window-scoped
  // retention count on 23 accounts would just be noise.
  // "All time" here means "since ANALYTICS_EPOCH": the `users` table itself
  // keeps every account (they still receive digests and can still sign in),
  // but accounts created before the epoch are outside what this page reports,
  // and a returner among them would be counted against a total that excludes
  // them. `window` needs no separate bound — `cutoff` is already clamped.
  let accounts = { total: 0, window: 0, returners: 0 }
  let accountsSince: string | null = null
  try {
    const totalRow = await db
      .prepare('SELECT COUNT(*) as n FROM users WHERE created_at >= ?')
      .bind(ANALYTICS_EPOCH_DATETIME)
      .first<{ n: number }>()
    const windowRow = await db
      .prepare(`SELECT COUNT(*) as n FROM users WHERE created_at >= datetime(?, 'unixepoch')`)
      .bind(cutoff)
      .first<{ n: number }>()
    const returnersRow = await db
      .prepare('SELECT COUNT(*) as n FROM users WHERE last_login_at > created_at AND created_at >= ?')
      .bind(ANALYTICS_EPOCH_DATETIME)
      .first<{ n: number }>()
    accounts = {
      total: totalRow?.n ?? 0,
      window: windowRow?.n ?? 0,
      returners: returnersRow?.n ?? 0,
    }
    // First account this page will report = when the stream starts, as far as
    // the dashboard is concerned (feeds `since`). `created_at` is TEXT
    // datetime; date() trims it to the UTC day.
    accountsSince =
      (
        await db
          .prepare('SELECT date(MIN(created_at)) as d FROM users WHERE created_at >= ?')
          .bind(ANALYTICS_EPOCH_DATETIME)
          .first<{ d: string | null }>()
      )?.d ?? null
  } catch (e) {
    console.warn('behavior: users table unavailable (migration 0022 not applied?)', e)
  }

  // --- since: when each stream began collecting -------------------------
  // Every analytics stream went live on a different date (ui_events
  // 2026-07-24, outbound/waitlist early May, accounts 2026-07-27,
  // session_start 2026-08-09), so a 30/90-day window silently under-reports
  // any stream younger than itself. MIN over the whole table AS THIS PAGE SEES
  // IT — deliberately unscoped by window and region (the question is "when did
  // collection begin", not "first event in this window") but bounded below by
  // the epoch, so a date here can never predate what the counts beside it
  // cover. Day strings (UTC, matching the daily buckets everywhere else);
  // NULL = no rows at or after the epoch yet. Cheap: MIN on an indexed column
  // per small table.
  const sinceDay = async (sql: string, bind: string | number) =>
    (await db.prepare(sql).bind(bind).first<{ d: string | null }>())?.d ?? null
  const [sinceUiEvents, sinceSessions, sinceOutbound, sinceWaitlist] = await Promise.all([
    sinceDay("SELECT date(MIN(ts),'unixepoch') as d FROM ui_events WHERE ts >= ?", ANALYTICS_EPOCH_SEC),
    sinceDay(
      "SELECT date(MIN(ts),'unixepoch') as d FROM ui_events WHERE goal = 'session_start' AND ts >= ?",
      ANALYTICS_EPOCH_SEC
    ),
    sinceDay("SELECT date(MIN(ts),'unixepoch') as d FROM outbound_clicks WHERE ts >= ?", ANALYTICS_EPOCH_SEC),
    sinceDay(
      "SELECT date(MIN(created_at),'unixepoch') as d FROM waitlist_signups WHERE created_at >= ?",
      ANALYTICS_EPOCH_SEC
    ),
  ])

  // --- byRegion: cross-city overview (NOT scoped by `region=`) -----------
  // visitsByRegion — the "how many people visit each city" number. metro_view
  // fires once per (session, metro), so this is a per-metro visit count. NULL
  // region (historical/off-metro) surfaces as its own row and reads as
  // "unattributed" in the UI; a group only exists when it has rows, so the
  // "only if nonzero" requirement is satisfied by construction.
  const { results: visitsByRegion } = await db
    .prepare(
      `SELECT region, COUNT(*) as count
         FROM ui_events
        WHERE goal = 'metro_view' AND ts >= ?
        GROUP BY region
        ORDER BY count DESC
        LIMIT 60`
    )
    .bind(cutoff)
    .all<{ region: string | null; count: number }>()

  // visitsDaily — day × region metro_view series for the trend chart.
  const { results: visitsDaily } = await db
    .prepare(
      `SELECT date(ts,'unixepoch') as day, region, COUNT(*) as count
         FROM ui_events
        WHERE goal = 'metro_view' AND ts >= ?
        GROUP BY day, region
        ORDER BY day ASC`
    )
    .bind(cutoff)
    .all<{ day: string; region: string | null; count: number }>()

  // uiByRegion — region × goal counts across all TAP goals (metro_view
  // excluded — visits have their own panels above), powering the "taps by
  // city" breakdown. Bounded (60 metros × ~9 goals well under the cap).
  const { results: uiByRegion } = await db
    .prepare(
      `SELECT region, goal, COUNT(*) as count
         FROM ui_events
        WHERE ts >= ?${notVisit}
        GROUP BY region, goal
        ORDER BY count DESC
        LIMIT 200`
    )
    .bind(cutoff)
    .all<{ region: string | null; goal: string; count: number }>()

  // outboundByRegion — outbound clicks attributed to their item's region.
  // LEFT JOIN so a click on a removed item counts under NULL (unattributed).
  const { results: outboundByRegion } = await db
    .prepare(
      `SELECT i.region as region, COUNT(*) as count
         FROM outbound_clicks o
         LEFT JOIN items i ON i.id = o.item_id
        WHERE o.ts >= ?
        GROUP BY i.region
        ORDER BY count DESC
        LIMIT 60`
    )
    .bind(cutoff)
    .all<{ region: string | null; count: number }>()

  // waitlistByRegion — signups (newsletter + Google-sign-in combined, same
  // "total" convention as `waitlist.total` above) by the metro the visitor
  // was on (0017's `city` column, aliased to `region` for the shared
  // RegionCount shape). #361 (per-metro dashboard): "which metros convert"
  // needs signups next to visits/taps/outbound, not just the all-cities tile.
  const { results: waitlistByRegion } = await db
    .prepare(
      `SELECT city as region, COUNT(*) as count
         FROM waitlist_signups
        WHERE created_at >= ?
        GROUP BY city
        ORDER BY count DESC
        LIMIT 60`
    )
    .bind(cutoff)
    .all<{ region: string | null; count: number }>()

  return c.json({
    days,
    region,
    // The floor under every number below, echoed so the dashboard can state it
    // without hardcoding a date that would drift from this constant.
    epoch: ANALYTICS_EPOCH,
    since: {
      uiEvents: sinceUiEvents,
      sessions: sinceSessions,
      outbound: sinceOutbound,
      waitlist: sinceWaitlist,
      accounts: accountsSince,
    },
    uiEvents: {
      total: uiTotalRow?.n ?? 0,
      sessions: sessionsRow?.n ?? 0,
      byGoal,
      daily: uiDaily,
      topContexts: {
        filter_chip: filterChipContexts,
        coming_soon_tap: comingSoonContexts,
      },
      topItems: uiTopItems,
    },
    outbound: {
      total: outTotal,
      daily: outDaily,
      topHosts: outHosts,
      topItems: outTopItems,
    },
    waitlist: {
      total: wlKindTotal('newsletter') + wlKindTotal('google_signin'),
      newsletter: { total: wlKindTotal('newsletter'), daily: wlKindDaily('newsletter') },
      googleSignin: {
        total: wlKindTotal('google_signin'),
        daily: wlKindDaily('google_signin'),
      },
    },
    signin: {
      funnel: signinFunnel,
      byRegion: signinByRegion,
      accounts,
    },
    byRegion: {
      visits: visitsByRegion,
      visitsDaily,
      ui: uiByRegion,
      outbound: outboundByRegion,
      waitlist: waitlistByRegion,
    },
  })
})

// POST /api/admin/run/:source — manual trigger for scheduled handlers.
// CF-Access-gated (inherits the router-level middleware). Use from the
// admin UI's Ingestion Dashboard to force a cron run on demand instead of
// waiting for the next UTC slot. Returns the handler's stats JSON.
//
// Supported sources: 'structured-feeds' | 'osm' | 'archive-expired'.
adminRouter.post('/api/admin/run/:source', async (c) => {
  const source = c.req.param('source')
  try {
    if (source === 'structured-feeds') {
      const stats = await runStructuredFeedsIngest(c.env.DB, makeProductionDeps(undefined, c.env))
      return c.json({ source, ...stats })
    }
    if (source === 'osm') {
      const stats = await runOsmIngest(c.env.DB)
      return c.json({ source, ...stats })
    }
    if (source === 'archive-expired') {
      const stats = await runArchiveExpired(c.env.DB, c.env.FRONTEND_URL)
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

// GET /api/admin/waitlist?limit=N[&kind=newsletter|google_signin] — list of
// waitlist signups (issue #165).
//
// Counts are always broken out by provenance (`newsletter` = typed-in opt-in,
// `googleSignin` = written by the events sign-in gate; shared/signupSource.ts)
// so a sign-in is never read as a subscriber; `kind=` narrows the ROW LIST
// only. Returns total count + the most recent N rows. Total is the Phase 0
// monetization gate metric (≥500 unblocks Phase 1 sponsor work). The
// `unsubscribed` count is broken out so the curator can see active vs.
// total at a glance.
//
// `limit` query param caps the row list; defaults to 100, max 500.
// Pagination beyond 500 isn't supported in v1 — at the gate (~500 rows)
// the table fits on one screen, and at higher volumes the count is the
// only metric that matters operationally.
//
// CF-Access-gated by the router-level middleware. No public exposure.
adminRouter.get('/api/admin/waitlist', async (c) => {
  const limitParam = Number(c.req.query('limit') ?? 100)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 500) : 100

  // `kind` filter (2026-08-08): the table mixes typed-in newsletter opt-ins
  // with rows written by a Google sign-in through the events gate. Both the
  // totals and the row list break out by kind so the curator never reads a
  // sign-in as a subscriber. Absent/unknown `kind` = both.
  const kindParam = c.req.query('kind')
  const kind: SignupKind | null =
    kindParam === 'newsletter' || kindParam === 'google_signin' ? kindParam : null
  const kindWhere = kind ? ` WHERE ${SIGNUP_KIND_SQL} = ?` : ''
  const kindBind = kind ? [kind] : []

  const { results: totalsByKind } = await c.env.DB
    .prepare(
      `SELECT ${SIGNUP_KIND_SQL} as kind, ` +
      'COUNT(*) as total, ' +
      'SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END) as active, ' +
      'SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as unsubscribed ' +
      'FROM waitlist_signups GROUP BY kind'
    )
    .all<{ kind: SignupKind; total: number; active: number; unsubscribed: number }>()

  const forKind = (k: SignupKind) =>
    totalsByKind.find((r) => r.kind === k) ?? { total: 0, active: 0, unsubscribed: 0 }
  const newsletter = forKind('newsletter')
  const googleSignin = forKind('google_signin')

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, email, source, city, unsubscribed_at, created_at, ${SIGNUP_KIND_SQL} as kind ` +
      `FROM waitlist_signups${kindWhere} ORDER BY created_at DESC LIMIT ?`
    )
    .bind(...kindBind, limit)
    .all<{ id: number; email: string; source: string; city: string | null; unsubscribed_at: number | null; created_at: number; kind: SignupKind }>()

  return c.json({
    // Legacy top-level counts stay the whole-table numbers so existing
    // callers don't silently change meaning; the split lives beside them.
    total: newsletter.total + googleSignin.total,
    active: newsletter.active + googleSignin.active,
    unsubscribed: newsletter.unsubscribed + googleSignin.unsubscribed,
    newsletter: {
      total: newsletter.total,
      active: newsletter.active,
      unsubscribed: newsletter.unsubscribed,
    },
    googleSignin: {
      total: googleSignin.total,
      active: googleSignin.active,
      unsubscribed: googleSignin.unsubscribed,
    },
    kind,
    signups: results,
  })
})
