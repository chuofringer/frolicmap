import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../env'
import { listByStatusAndRegion, getById } from '../db/items'
import { DEFAULT_REGION, isValidRegion, isPublishedRegion, publishedRegionIds, getMetroBySlug } from '@shared/metros'
import type { ListItem } from '@shared/types'
import { LIST_ITEM_FIELDS } from '@shared/types'
import { mintSessionToken, verifySessionToken, bearerToken, SESSION_TTL_SECONDS, type SessionPayload } from '../utils/session'
import { cityFromAddress } from '../utils/cityFromAddress'
import { buildTile, tileBbox, fairCapByCategory, warnIfTileCapped, type TilePoint } from '../utils/tile'
import { isProdOrigin, originGuard } from '../utils/originGuard'
import { nextEnumerationState, hashIp, EMPTY_ENUMERATION_STATE } from '../utils/enumerationGuard'
import { getEnumerationWatch, upsertEnumerationWatch } from '../db/enumerationWatch'
import { globalLimit, subjectFor, retryAfterSeconds } from '../utils/globalRateLimit'

export const publicRouter = new Hono<{ Bindings: Env }>()

/**
 * Every rate-limit number this file uses, in one place. The per-IP first
 * layer (the `ITEMS_*_RATE_LIMITER` bindings) has its limits in
 * `wrangler.toml` (10 list, 30 session, 60 detail, 300 tiles per minute per IP); the
 * `*Global` entries below are the second layer, a Durable Object counter that
 * is consistent across colos and keyed by session-token nonce (IP for mints).
 * Keep each global number equal to its binding's limit.
 */
const LIMITS = {
  /** Length of every rate-limit window, in milliseconds. */
  windowMs: 60_000,
  /** Bulk catalog (`/api/items.json`): one call returns the whole ListItem list, so it is tight. */
  listGlobal: 10,
  /** Session mints (`POST /api/session`): a browser needs one per page load plus one refresh per 5 min. */
  sessionGlobal: 30,
  /** Detail and coords (`/api/items/:id[/coords]`), one shared budget: per-click, per-pin fetches. */
  detailGlobal: 60,
  /** Tiles (`/api/tiles/*`): one pan or zoom fires 4-10 tile requests at once, so this is the loosest. */
  tilesGlobal: 300,
  /** `Retry-After` seconds sent when the per-IP binding trips (its window is fixed at 60s). */
  bindingRetryAfterSeconds: 60,
  /** `Retry-After` seconds sent with the 503 when `SESSION_SIGNING_KEY` is not configured. */
  unconfiguredRetryAfterSeconds: 300,
} as const

// CORS lockdown: a specific allowlist, not `origin: '*'`. Legit consumers
// are only the frolicmap.app SPA and local dev. `ALLOWED_ORIGINS` /
// `isProdOrigin` / `originGuard` live in `../utils/originGuard`.

// Read-only frontend previews against live data.
//
// Cloudflare Pages emits a preview build per branch/commit at origins like
// `https://<hash>.frolicmap.pages.dev` and `https://<branch>.frolicmap.pages.dev`.
// With `VITE_API_BASE` pointed at the API on the Pages *Preview* scope,
// those builds call the prod API, so every PR's preview URL can render the
// real map with live data for visual review.
//
// The pattern is ANCHORED (`^...$`) and allows exactly ONE label before
// `.frolicmap.pages.dev`: `[a-z0-9-]+` matches the CF-assigned hash/branch
// segment only. This deliberately rejects the spoof shapes an attacker would
// reach for: no scheme other than https, no ports, no nested subdomains
// (`a.b.frolicmap.pages.dev`), no missing dot boundary
// (`evil-frolicmap.pages.dev`), and no suffix trickery
// (`frolicmap.pages.dev.evil.com`).
//
// The whole Worker is read-only (`/api/session`, `/api/items.json`,
// `/api/items/:id`, `/api/items/:id/coords`, `/api/tiles/*`), so preview
// origins may use every route.
const PAGES_PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.frolicmap\.pages\.dev$/

// Read-only surface: exact allowlist OR a Cloudflare Pages preview origin.
function isAllowedOrigin(origin: string): boolean {
  return isProdOrigin(origin) || PAGES_PREVIEW_ORIGIN_RE.test(origin)
}

// Read-only endpoints accept preview origins (function form -> hono emits
// `Vary: Origin`, so the per-origin ACAO header can't get cross-cached at the
// edge under the data responses' `private, max-age=3600`). Returning the
// origin echoes it into Access-Control-Allow-Origin; returning null blocks it.
const readOnlyCorsOrigin = (origin: string): string | null =>
  isAllowedOrigin(origin) ? origin : null

publicRouter.use('/api/items.json', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/items/:id', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
// Hono middleware paths match literally, not by prefix, so `/api/items/:id`
// above does NOT also cover this subpath, which needs its own registration.
publicRouter.use('/api/items/:id/coords', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/session', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/where', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/tiles/*', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))

// Minified attribution. Credits the open datasets the places come from:
// OpenStreetMap (ODbL), IMLS (libraries + museums) and the National Park
// Service.
const ATTRIBUTION = [
  { source: 'OpenStreetMap contributors', license: 'ODbL-1.0', url: 'https://www.openstreetmap.org/copyright' },
  { source: 'Institute of Museum and Library Services', license: 'public-domain', url: 'https://www.imls.gov' },
  { source: 'National Park Service', license: 'public-domain', url: 'https://www.nps.gov' },
] as const

// `originGuard` (imported above) defaults to the exact-allowlist rule
// (`isProdOrigin`) so write paths are locked to the prod/dev origins. The
// read-only endpoints below pass `isAllowedOrigin` to additionally accept CF
// Pages preview origins on BOTH the Origin and the Referer-origin check.

/**
 * Session-token gate for data endpoints.
 *
 * Returns `null` on success (caller proceeds to handler), or a `Response`
 * with the appropriate 401/503 when the token is missing/invalid/expired.
 *
 * If `SESSION_SIGNING_KEY` isn't configured, responds 503 rather than
 * silently accepting unauthenticated requests, matching the mint endpoint's
 * semantics (no-crash cold deploy, clear error for the operator).
 */
async function sessionGuard(
  c: {
    req: { header: (n: string) => string | undefined }
    env: { SESSION_SIGNING_KEY?: string }
  },
): Promise<Response | null> {
  if (!c.env.SESSION_SIGNING_KEY) {
    return new Response(JSON.stringify({ error: 'session auth not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': String(LIMITS.unconfiguredRetryAfterSeconds) },
    })
  }
  const token = bearerToken(c.req.header('authorization'))
  const verdict = await verifySessionToken(c.env.SESSION_SIGNING_KEY, token ?? undefined)
  if (verdict.valid) return null
  // Surface reason in the response body so the SPA can distinguish "refresh"
  // (expired) from "re-mint" (missing / malformed / bad-signature).
  return new Response(JSON.stringify({ error: 'unauthorized', reason: verdict.reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Payload of the request's (already-guarded) session token, used for the
 * rate-limit subject (the token nonce). Re-verifies the bearer token: a
 * second HMAC over a small payload is microseconds, and it keeps
 * `sessionGuard`'s Response|null contract untouched. Returns null when
 * anything is off.
 */
async function sessionPayloadOf(
  c: {
    req: { header: (n: string) => string | undefined }
    env: { SESSION_SIGNING_KEY?: string }
  },
): Promise<SessionPayload | null> {
  const token = bearerToken(c.req.header('authorization'))
  const verdict = await verifySessionToken(c.env.SESSION_SIGNING_KEY, token ?? undefined)
  return verdict.valid ? verdict.payload : null
}

publicRouter.get('/api/items.json', async (c) => {
  // Read-only surface — CF Pages preview origins allowed.
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  // The list endpoint requires a valid session token. This
  // closes the `curl | jq` clone path. The frontend's `useItems()` hook
  // attaches `Authorization: Bearer` and gates its query on token
  // presence, matching the detail / tile endpoints.
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  // cf-connecting-ip is always set by Cloudflare in prod. XFF would be
  // attacker-forgeable, so don't fall through to it.
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  // Bulk-catalog budget — intentionally tight (10/min/IP).
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer. This is the "bulk clone" surface
  // the per-isolate 10/min/IP budget above is sized to make expensive — and
  // therefore the one where the IP-rotation reset that budget is vulnerable
  // to matters most. Same 10/min shape, but globally consistent per token.
  const listPayload = await sessionPayloadOf(c)
  const listLimit = await globalLimit(c.env, 'list', subjectFor(ip, listPayload?.nonce), { limit: LIMITS.listGlobal, windowMs: LIMITS.windowMs })
  if (!listLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(listLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // National expansion (plan §2.0): the list endpoint is region-scoped.
  //
  // An omitted `?region=` means `bay`, NOT "every row" — today those are the
  // same response (the schema defaults every row to 'bay' unless an importer
  // sets another region). The
  // default matters later: once 50 metros are loaded, an unscoped call would
  // dump the entire national dataset in one response, which is both a
  // scraping gift and a payload the SPA can't use. Scoping now means the
  // national importers can't accidentally widen this endpoint.
  //
  // Unknown region → 400 rather than an empty 200. A typo'd metro slug is a
  // client bug; an empty item list would render as "no places near you" and
  // look like missing data instead of a bad request.
  // Both rejection paths set `no-store`: an error response that the edge
  // could cache would outlive the condition that caused it — in particular a
  // cached 400 for a metro would survive that metro going live, and
  // `purgeItemsCache` has no way to reach it.
  const regionParam = c.req.query('region')
  if (regionParam !== undefined && !isValidRegion(regionParam)) {
    c.header('Cache-Control', 'no-store')
    const bySlug = getMetroBySlug(regionParam)
    return c.json({
      error: 'unknown region',
      // The id/slug split is the one place these namespaces diverge, so it's
      // the likeliest caller mistake — especially with slug-driven
      // /cities/{metro} routes and someone hand-translates a URL.
      ...(bySlug ? { hint: `'${regionParam}' is a URL slug, not a region id — use '${bySlug.id}'` } : {}),
    }, 400)
  }
  // Valid but not yet launched. Kept distinct from "unknown" so an operator
  // debugging a pre-launch metro sees the real reason.
  if (regionParam !== undefined && !isPublishedRegion(regionParam)) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'region not published' }, 404)
  }
  const region = regionParam ?? DEFAULT_REGION
  const full = await listByStatusAndRegion(c.env.DB, 'approved', region)
  // Redact to the ListItem shape — description, address, price_usd,
  // opening_hours, photo_url, website, source_url, source_type, confidence,
  // last_verified, created_at, updated_at all move to the per-item detail
  // endpoint (`/api/items/:id`). Frontend still has everything it needs for
  // pin rendering + client-side filtering; popup fetches the rest on click.
  const items: ListItem[] = full.map((it) => {
    const out = {} as ListItem
    for (const k of LIST_ITEM_FIELDS) {
      // Pick<Item, K> is assignable to the corresponding ListItem slot.
      ;(out as Record<string, unknown>)[k] = it[k] as unknown
    }
    // `city` is populated by the importers but can be null on older rows. The
    // list cards show a city so a distance number isn't the only sense of
    // place, so derive it from the address when the column is empty. Display
    // only: nothing is written back, so the SEO pages still read the real
    // column.
    if (!out.city) out.city = cityFromAddress(it.address)
    return out
  })

  // Private, not public — CF edge must NOT share-cache since
  // the response is gated on a per-request token (same rationale as the
  // detail + tile endpoints after the 2c hotfix). Browser caches 1h.
  c.header('Cache-Control', 'private, max-age=3600')
  return c.json({
    items,
    region,
    generated_at: new Date().toISOString(),
    attribution: ATTRIBUTION,
  })
})

// Per-item detail endpoint. Returns the full Item shape for one row. The
// SPA fetches from here on marker click / URL-param item. Separate rate
// limiter from the list endpoint (60/min/IP vs 10/min/IP) because real
// user flow is many detail fetches per one list fetch.
//
// Requires a valid session token in the Authorization header.
// Unauthenticated requests get 401. The token gates off the bulk
// detail-scrape path that a determined adversary could otherwise use even
// after the list endpoint's redaction.
publicRouter.get('/api/items/:id', async (c) => {
  // Read-only surface — CF Pages preview origins allowed.
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer: globally-consistent budget keyed
  // by the session token's nonce (falls back to IP only if verification
  // somehow fails here after already passing sessionGuard above — defensive,
  // shouldn't happen). Same 60/min shape as the per-isolate limiter above,
  // but immune to the IP-rotation reset that limiter is vulnerable to.
  const detailPayload = await sessionPayloadOf(c)
  const detailLimit = await globalLimit(c.env, 'items-detail', subjectFor(ip, detailPayload?.nonce), { limit: LIMITS.detailGlobal, windowMs: LIMITS.windowMs })
  if (!detailLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(detailLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const id = c.req.param('id')

  // Sequential-ID enumeration heuristic. A tile walk at
  // z=11-12 already yields every public id, so the rate limiter above caps
  // *volume* but not *pattern* — this catches an IP methodically walking
  // that harvested id list in sorted order, which no organic click session
  // does. See utils/enumerationGuard.ts for the decision logic.
  const ipHash = await hashIp(ip, c.env.SESSION_SIGNING_KEY as string) // set: sessionGuard 503s without it
  const now = new Date()
  const watch = await getEnumerationWatch(c.env.DB, ipHash)
  if (watch?.blockedUntil && watch.blockedUntil > now) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(Math.ceil((watch.blockedUntil.getTime() - now.getTime()) / 1000)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }
  const verdict = nextEnumerationState(watch ?? EMPTY_ENUMERATION_STATE, id, now)
  await upsertEnumerationWatch(c.env.DB, ipHash, verdict.next, verdict.blockedUntil, now)
  if (verdict.blockedUntil) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(Math.ceil((verdict.blockedUntil.getTime() - now.getTime()) / 1000)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const item = await getById(c.env.DB, id)
  // Same region gate as the list and tile endpoints. An unpublished
  // metro's rows are `approved` in D1 from import time, so status alone would
  // have made every one of them fetchable by id. Returns 404 rather than 403
  // so an unpublished metro's ids aren't enumerable.
  if (!item || item.status !== 'approved' || !isPublishedRegion(item.region)) {
    return c.json({ error: 'not found' }, 404)
  }

  // Browser caches 1h; CF edge does NOT cache (s-maxage=0). If we let the
  // shared edge cache hold a 200 response, subsequent unauthenticated
  // requests would be served the cached body *without* the worker running
  // (and thus without sessionGuard firing) — the exact hole the session gate is
  // meant to close. `s-maxage=0` tells CF edge to skip the shared cache;
  // each request runs the worker, re-checks the token, then re-queries D1.
  // Acceptable cost given D1 detail queries are ~5ms. See the data-
  // protection-plan.md threat model — this is the "token gates access,
  // not identity of cached content" discipline, simpler form: just don't
  // share-cache authenticated content at the edge at all. A worker Cache API layer could be
  // added for per-request perf if needed.
  c.header('Cache-Control', 'private, max-age=3600')
  return c.json({ item })
})

// Minimal coordinate-only endpoint. Exists so
// the SPA's `?item=<id>` fly-to lookup (`useUrlItem`) `?item=<id>` fly-to lookup no longer needs the FULL
// `/api/items.json` catalog just to resolve one id's lat/lng — tile
// features carry no lat/lng-by-id index (a tile is scoped to its own bbox,
// so the item may not even be in a currently-loaded tile), and shipping a
// second full detail fetch just for coordinates would be wasteful and widen
// the curated-field exposure for no reason. Same guards, same rate budget,
// and the same anti-enumeration 404 as the full detail endpoint — this is
// deliberately NOT a lighter-weight version of that endpoint's protection,
// only of its response body.
publicRouter.get('/api/items/:id/coords', async (c) => {
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer, SAME scope as `/api/items/:id` —
  // this endpoint shares that endpoint's per-isolate budget too (see the
  // route comment above), so it shares its global budget as well: an
  // adversary alternating between the two to spread load across counters
  // must not effectively double their allowance.
  const coordsPayload = await sessionPayloadOf(c)
  const coordsLimit = await globalLimit(c.env, 'items-detail', subjectFor(ip, coordsPayload?.nonce), { limit: LIMITS.detailGlobal, windowMs: LIMITS.windowMs })
  if (!coordsLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(coordsLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const id = c.req.param('id')
  const item = await getById(c.env.DB, id)
  // Same region gate as detail/list/tiles — 404 rather than 403 so an
  // unpublished metro's ids aren't enumerable.
  if (!item || item.status !== 'approved' || !isPublishedRegion(item.region)) {
    return c.json({ error: 'not found' }, 404)
  }

  c.header('Cache-Control', 'private, max-age=3600')
  return c.json({ lat: item.lat, lng: item.lng })
})

// Vector tile endpoint. Returns MVT-encoded points for one tile
// at (z, x, y). The SPA consumes this via a MapLibre vector
// source alongside `/api/items.json`.
//
// Payload contains only `{id, name, category, type}` as feature properties
// (geometry carries lat/lng). All curated fields stay behind the detail
// endpoint. The tile also carries the filter fields (age, cost, indoor) so the
// SPA can filter client-side off the tile payload.
//
// Rate-limited under its own tiles budget (300/min/IP, then 300/min per
// session token in the Durable Object) because real map usage fires many tile
// requests per session (pan/zoom generates 4-10 tiles at a time); the list
// (10/min) and detail (60/min) budgets would be too tight.
//
// Browser-cached 1h per (z, x, y) (`private`, never share-cached at the edge,
// see the response headers below). 1h staleness on a pin appearance is
// acceptable given the importers run on a daily-to-weekly cadence.
const TILE_PATH_RE = /^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/

// The real fairness boundary, enforced app-side by `fairCapByCategory`
// — see the comment above the tile query below.
const TILE_ROW_CAP = 10000
// A generous multiple of TILE_ROW_CAP so a pathological low-zoom tile
// (an entire dense metro) can't pull an unbounded row set into worker
// memory before the app-side cap runs; far above any realistic tile size.
const SQL_ROW_SAFETY_CAP = TILE_ROW_CAP * 3

publicRouter.get('/api/tiles/*', async (c) => {
  // Read-only surface — CF Pages preview origins allowed.
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked

  // Parse + validate tile coords BEFORE the auth check — a malformed URL
  // is a client-side mistake and deserves a 400 regardless of whether a
  // token is attached. The auth check is below so that well-formed URLs
  // don't leak any information about the dataset to unauthenticated
  // callers (they just get 401, not 200).
  const m = TILE_PATH_RE.exec(new URL(c.req.url).pathname)
  if (!m) return c.json({ error: 'invalid tile path' }, 400)
  const z = Number(m[1])
  const x = Number(m[2])
  const y = Number(m[3])
  const maxCoord = Math.pow(2, z)
  if (z > 22 || x >= maxCoord || y >= maxCoord) {
    return c.json({ error: 'invalid tile coords' }, 400)
  }

  // Tiles require a valid session token. Without gating, the
  // tile endpoint would just be a different wire-format clone of the
  // list payload — same protection model as detail.
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  // First layer: the tiles-only per-IP binding (300/min/IP, see wrangler.toml).
  // Deliberately NOT the detail binding: a single pan or zoom gesture fires
  // 4-10 tile requests essentially at once, so real map usage is bursty in a
  // way single-item detail fetches aren't, and sharing the 60/min detail
  // budget would throttle one enthusiastic pan (and starve popup taps).
  const { success } = await c.env.ITEMS_TILES_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer: the Durable Object counter, own `tiles` scope with the same
  // 300/min budget, but globally consistent and keyed by session-token nonce,
  // so it survives IP rotation and spans every colo. 300/min still bounds a
  // tile-walk scrape to a few z11-12 tiles a second per token.
  const tilesPayload = await sessionPayloadOf(c)
  const tilesLimit = await globalLimit(c.env, 'tiles', subjectFor(ip, tilesPayload?.nonce), { limit: LIMITS.tilesGlobal, windowMs: LIMITS.windowMs })
  if (!tilesLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(tilesLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const { west, south, east, north } = tileBbox(z, x, y)
  // Draw-order strategy: MapLibre renders `circle` layer features in the
  // order they appear in the tile. Tile feature order = SQL ORDER BY order.
  // Smaller, more-specific pins (playground > park > museum > ...) must
  // render on top of larger-venue pins: `ORDER BY category` lands playgrounds
  // last alphabetically, so they draw last and sit on top. `name` is a stable
  // tiebreak for fully equal keys.
  //
  // LIMIT 10000: at z=8-9 a single tile covers the whole Bay Area (~4600
  // rows). 500 was truncating 90% of the dataset. At z ≥ 11 each tile has
  // <500 rows anyway, so the higher cap only matters for the few low-zoom
  // tiles and is cheap for them.
  //
  // Fair thinning. The SQL LIMIT below is a generous *safety valve*
  // (SQL_ROW_SAFETY_CAP), not the fairness boundary — a flat
  // `ORDER BY category, ... LIMIT 10000` picks its survivors by
  // category-alphabetical position, so once a tile's row count crosses the
  // cap every category *after* the cutoff point is wiped out wholesale
  // (e.g. `playground`/`waterplay` vanish entirely) instead of
  // every category losing the same share. `fairCapByCategory` (utils/tile)
  // applies the real 10000-row cap app-side by round-robining one row per
  // category at a time, so truncation removes each category's tail evenly
  // instead of removing whole categories — same idea as the per-category
  // `ROW_NUMBER() OVER (PARTITION BY category ...)` fix already shipped for
  // the SEO pin-sample truncation (per-category `ROW_NUMBER() OVER (PARTITION BY category ...)`), done in JS here so the fairness
  // logic is unit-testable without a D1 fixture. No `ORDER BY RANDOM()` —
  // capping is a deterministic function of each row's draw-order position,
  // so the same tile query returns the same survivors on a cache miss
  // instead of visibly reshuffling which pins are visible. The SQL LIMIT
  // still bounds worst-case D1 read/memory for a pathological low-zoom
  // tile before the app-side cap runs.
  // Region gate. `status='approved'` is NOT a visibility decision on
  // its own: trusted structured sources auto-approve at import time (plan
  // §1.6), so a metro's rows sit in D1 as approved for weeks before it
  // launches. Without this clause the tile endpoint served them by bbox the
  // moment they were applied — confirmed in production with Austin, whose
  // `?region=austin` correctly 404'd while its tile returned 23 KB of pins.
  // That collapsed "import → QA → publish" (plan §4A.5) into "import =
  // publish". Tiles now serve only published metros, matching
  // `/api/items.json` and `/api/items/:id`.
  const published = publishedRegionIds()
  if (published.length === 0) {
    // No metro is live — emit a valid empty tile rather than building
    // `region IN ()`, which is a SQL syntax error.
    return new Response(buildTile(z, x, y, []), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.mapbox-vector-tile',
        'cache-control': 'private, max-age=3600',
      },
    })
  }
  const regionPlaceholders = published.map(() => '?').join(',')
  const { results } = await c.env.DB
    .prepare(
      'SELECT id, name, category, type, lat, lng, ' +
      'age_min, age_max, cost, indoor FROM items ' +
      "WHERE status = 'approved' " +
      `AND region IN (${regionPlaceholders}) ` +
      'AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ' +
      'ORDER BY category, name ' +
      `LIMIT ${SQL_ROW_SAFETY_CAP}`,
    )
    .bind(...published, south, north, west, east)
    .all<TilePoint>()

  // Thin to the real row cap fairly across categories, not by
  // truncating the SQL-order tail. See TILE_ROW_CAP / SQL_ROW_SAFETY_CAP
  // above and fairCapByCategory (utils/tile) for the rationale.
  warnIfTileCapped(z, x, y, results.length, TILE_ROW_CAP)
  const capped = fairCapByCategory(results, TILE_ROW_CAP)

  const pbf = buildTile(z, x, y, capped)

  // `application/vnd.mapbox-vector-tile` is the IANA-registered type for MVT
  // and is what MapLibre / Mapbox clients expect. `application/x-protobuf`
  // also works but is less specific.
  return new Response(pbf, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.mapbox-vector-tile',
      // Browser cache only (`private`) — CF edge must NOT share-cache
      // this response. Otherwise a cached 200 would serve subsequent
      // unauthenticated requests without the worker running, bypassing
      // `sessionGuard`. See the detail endpoint for the full rationale.
      // An explicit worker-Cache-API layer could be added later.
      'cache-control': 'private, max-age=3600',
    },
  })
})

// Session mint. Issues a 5-minute HMAC-signed token. The data
// endpoints require it as `Authorization: Bearer`; the SPA keeps it in memory
// only and refreshes it before it expires.
//
// Behaviour when `SESSION_SIGNING_KEY` is unset: 503, `Retry-After: 300`.
// This is the cold-deploy path — code is live but the secret hasn't been
// set via `wrangler secret put SESSION_SIGNING_KEY`. Returning 503 (not 500)
// lets browsers treat this as transient and retry, and keeps the frontend's
// session-mint call idempotent.
publicRouter.post('/api/session', async (c) => {
  // Read-only surface — CF Pages preview origins allowed. A
  // preview build must be able to mint a token to load tiles/items, but the
  // token grants only the read endpoints (the whole Worker is read-only).
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked

  if (!c.env.SESSION_SIGNING_KEY) {
    c.header('Retry-After', String(LIMITS.unconfiguredRetryAfterSeconds))
    return c.json({ error: 'session minting not yet configured' }, 503)
  }

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  // Rate-limit session mints under their own budget (30/min/IP), separate
  // from the list endpoint's. A browser legitimately needs one mint per page
  // load + one refresh per 5 min, so a user who reloads often must still get
  // through; a sustained burst of mints is either broken client code or abuse.
  const { success } = await c.env.SESSION_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer, keyed by IP only — this is the
  // one gated route with no token to key off of yet (minting one is the
  // whole point of the call). 30/min/IP, matching the per-isolate budget
  // just above, but globally consistent: this is the endpoint an IP-rotating
  // adversary would hit hardest to keep manufacturing fresh per-isolate
  // buckets for every OTHER endpoint, so it's the one place a colo-local
  // reset is most valuable to close.
  const mintLimit = await globalLimit(c.env, 'session', subjectFor(ip, undefined), { limit: LIMITS.sessionGlobal, windowMs: LIMITS.windowMs })
  if (!mintLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(mintLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const token = await mintSessionToken(c.env.SESSION_SIGNING_KEY)
  // Never cache. Every mint must be fresh — a cached token would be shared
  // across users and handed out by CF edge for the 1h TTL.
  c.header('Cache-Control', 'no-store')
  return c.json({ token, ttl_seconds: SESSION_TTL_SECONDS })
})

// Approximate location of the connection, from Cloudflare's edge (`request.cf`),
// so the home page can open on the visitor's nearest metro (#17).
//
// Deliberately minimal: no D1, no logging, no storage, no session token (the
// response carries no place data, only what the edge already derived from the
// caller's own IP and handed back to that same caller). Only the per-IP
// SESSION_RATE_LIMITER (30/min/IP) guards it. `cf` is undefined under local
// `wrangler dev` and for non-CF callers; every field is then null and the SPA
// falls back to the city list. `cf.latitude`/`longitude` arrive as strings.
publicRouter.get('/api/where', async (c) => {
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked

  c.header('Cache-Control', 'no-store')

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.SESSION_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Retry-After', String(LIMITS.bindingRetryAfterSeconds))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : null
  }
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  let lat = num(cf?.latitude)
  let lng = num(cf?.longitude)
  // Both or neither: a half coordinate is useless and would mislead the client.
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    lat = null
    lng = null
  }
  return c.json({ lat, lng, city: str(cf?.city), region: str(cf?.region) })
})
