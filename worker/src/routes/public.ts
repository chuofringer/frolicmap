import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../env'
import { listByStatusAndRegion, getById } from '../db/items'
import { insertSubmission, countPendingByUser, listSubmissionsByUser } from '../db/submissions'
import { DEFAULT_REGION, isValidRegion, isPublishedRegion, publishedRegionIds, getMetroBySlug, getMetro, metroForCoords } from '@shared/metros'
import { UI_EVENT_GOALS } from '@shared/uiEventGoals'
import { signupKind } from '@shared/signupSource'
import { isGatedEventKind } from '@shared/eventsGate'
import type { ListItem } from '@shared/types'
import { LIST_ITEM_FIELDS, ALL_CATEGORIES } from '@shared/types'
import { mintSessionToken, verifySessionToken, bearerToken, type SessionPayload } from '../utils/session'
import { mintMemberCredential, verifyMemberCredential, CREDENTIAL_TTL_SECONDS } from '../utils/authTokens'
import { verifyGoogleIdToken } from '../utils/googleIdToken'
import { cityFromAddress } from '../utils/cityFromAddress'
import { CityDonorIndex } from '../utils/nearestCity'
import { buildTile, tileBbox, resolvePrimaryCropEmoji, fairCapByCategory, warnIfTileCapped, type TilePoint } from '../utils/tile'
import { sendWaitlistWelcome } from '../utils/email'
import { isProdOrigin, originGuard } from '../utils/originGuard'
import { isRainingFromWeather } from '../utils/weather'
import { nextEnumerationState, hashIp, EMPTY_ENUMERATION_STATE } from '../utils/enumerationGuard'
import { getEnumerationWatch, upsertEnumerationWatch } from '../db/enumerationWatch'
import { globalLimit, subjectFor, retryAfterSeconds } from '../utils/globalRateLimit'
import { affiliateConfigFromEnv, applyAffiliateToItem, affiliatePartnerForHost } from '../utils/affiliate'

export const publicRouter = new Hono<{ Bindings: Env }>()

// CORS lockdown: previously `origin: '*'` — now a specific allowlist.
// Removes the "public API, free to embed anywhere" posture. Legit consumers
// are only the funradar.app SPA and local dev. See docs/data-protection-plan.md.
// `ALLOWED_ORIGINS` / `isProdOrigin` / `originGuard` now live in
// `../utils/originGuard` (#422) so the internal router can pair its
// secret-gated endpoints with the exact same mechanism instead of a
// second, invented one.

// #248 Phase 1 — read-only frontend previews against prod data.
//
// Cloudflare Pages emits a PR-preview build per branch/commit at origins like
// `https://<hash>.funradar-app.pages.dev` and `https://<branch>.funradar-app.pages.dev`.
// With `VITE_API_BASE=https://api.funradar.app` set on the Pages *Preview*
// scope (Production stays cleared per #194), those builds call the prod API,
// so every PR's preview URL can render the real map with live data for visual
// review — no local checkout required.
//
// The pattern is ANCHORED (`^…$`) and allows exactly ONE label before
// `.funradar-app.pages.dev`: `[a-z0-9-]+` matches the CF-assigned hash/branch
// segment only. This deliberately rejects the spoof shapes an attacker would
// reach for — no scheme other than https, no ports, and no nested subdomains
// (`a.b.funradar-app.pages.dev`), no missing dot boundary
// (`evil-funradar-app.pages.dev`), and no suffix trickery
// (`funradar-app.pages.dev.evil.com`).
//
// Preview origins are granted the READ-ONLY data surface ONLY (`/api/session`,
// `/api/items.json`, `/api/items/:id`, `/api/tiles/*`). WRITES stay locked to
// ALLOWED_ORIGINS: a preview build must never be able to pollute the waitlist,
// reports, or click telemetry — those side effects would land in prod D1 /
// prod Resend from an unreviewed branch. Phase 2 (issue #248) stands up a
// separate preview backend for write-path validation.
const PAGES_PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.funradar-app\.pages\.dev$/

// Read-only surface: exact allowlist OR a Cloudflare Pages preview origin.
function isAllowedOrigin(origin: string): boolean {
  return isProdOrigin(origin) || PAGES_PREVIEW_ORIGIN_RE.test(origin)
}

// Read-only endpoints accept preview origins (function form → hono emits
// `Vary: Origin`, so the per-origin ACAO header can't get cross-cached at the
// edge under the data responses' `private, max-age=3600`). Returning the
// origin echoes it into Access-Control-Allow-Origin; returning null blocks it.
const readOnlyCorsOrigin = (origin: string): string | null =>
  isAllowedOrigin(origin) ? origin : null

publicRouter.use('/api/items.json', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/items/:id', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
// Hono middleware paths match literally, not by prefix, so `/api/items/:id`
// above does NOT also cover this subpath — needs its own registration.
publicRouter.use('/api/items/:id/coords', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/session', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/tiles/*', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))
// Weather (issue #213, rainy-day banner) is read-only and carries no
// per-visitor data — safe to allow preview origins same as the other
// read-only endpoints above.
publicRouter.use('/api/weather', cors({ origin: readOnlyCorsOrigin, credentials: false, maxAge: 600 }))

// Write path — CF Pages *preview* origins (the anchored `.pages.dev` regex)
// are NEVER allowed here, in prod or in the #248 preview worker: that regex
// matches ANY PR-preview build, reviewed or not. Instead the dedicated
// preview worker deployment (`[env.preview]`) opts its own single, known
// origin into the write path via `PREVIEW_WRITE_ORIGIN` — see `isProdOrigin`.
// In prod that var is unset, so this is exactly the old exact-match check.
const writeCorsOrigin = (origin: string, c: { env: { PREVIEW_WRITE_ORIGIN?: string } }): string | null =>
  isProdOrigin(origin, c.env.PREVIEW_WRITE_ORIGIN) ? origin : null

publicRouter.use('/api/signup', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))
// Auth endpoint (Google sign-in) is a write: it creates users. Exact
// prod/dev allowlist (+ the preview worker's own origin) only — a CF Pages
// PR-preview build must never be able to mint member credentials.
publicRouter.use('/api/auth/*', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

// Minified attribution. Keeps OSM credited per ODbL §4.3 requirements and
// names the other two durable source categories (BAKF, municipal portals)
// since those origins may have license terms requiring credit (CC-BY on
// some city open-data portals, informal courtesy credit for BAKF). The
// previous version enumerated every source per-row which was essentially
// a sources-of-record index. This middle ground credits broad categories
// without publishing the curation playbook.
const ATTRIBUTION = [
  { source: 'OpenStreetMap contributors', license: 'ODbL-1.0', url: 'https://www.openstreetmap.org/copyright' },
  { source: 'bayareakidsfun.com', license: 'curated-extracts', url: 'https://bayareakidsfun.com' },
  { source: 'Bay Area city & county open-data portals', license: 'public-domain / per-portal terms', url: null },
] as const

// `originGuard` (imported above) defaults to the exact-allowlist rule
// (`isProdOrigin`, plus the per-request `PREVIEW_WRITE_ORIGIN` env var —
// #248 Phase 2) so write paths keep their pre-#248 behavior with no
// call-site change in prod, where that var is unset. The read-only
// endpoints below pass `isAllowedOrigin` to additionally accept CF Pages
// preview origins on BOTH the Origin and the Referer-origin check (#248
// Phase 1).

/**
 * Data-protection Phase 2c — session-token gate for data endpoints.
 *
 * Returns `null` on success (caller proceeds to handler), or a `Response`
 * with the appropriate 401/503 when the token is missing/invalid/expired.
 *
 * If `SESSION_SIGNING_KEY` isn't configured, responds 503 rather than
 * silently accepting unauthenticated requests — matches the Phase 2a mint
 * endpoint's semantics (no-crash cold deploy, clear error for operator).
 */
async function sessionGuard(
  c: {
    req: { header: (n: string) => string | undefined }
    env: { SESSION_SIGNING_KEY?: string; SESSION_SIGNING_KEY_PREVIOUS?: string }
  },
): Promise<Response | null> {
  if (!c.env.SESSION_SIGNING_KEY) {
    return new Response(JSON.stringify({ error: 'session auth not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '300' },
    })
  }
  const token = bearerToken(c.req.header('authorization'))
  // Rotation grace window (issue #198 item 4) — see verifySessionToken's doc
  // comment. SESSION_SIGNING_KEY_PREVIOUS is unset outside an active
  // rotation, so this is a no-op call shape the rest of the year.
  const verdict = await verifySessionToken(c.env.SESSION_SIGNING_KEY, token ?? undefined, undefined, c.env.SESSION_SIGNING_KEY_PREVIOUS)
  if (verdict.valid) return null
  // Surface reason in the response body so the SPA can distinguish "refresh"
  // (expired) from "re-mint" (missing / malformed / bad-signature).
  return new Response(JSON.stringify({ error: 'unauthorized', reason: verdict.reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Payload of the request's (already-guarded) session token, for tier checks.
 * Re-verifies the bearer token — a second HMAC over a small payload is
 * microseconds, and it keeps `sessionGuard`'s Response|null contract (and its
 * dozen call sites) untouched. Returns null when anything is off; callers
 * treat null as guest.
 */
async function sessionPayloadOf(
  c: {
    req: { header: (n: string) => string | undefined }
    env: { SESSION_SIGNING_KEY?: string; SESSION_SIGNING_KEY_PREVIOUS?: string }
  },
): Promise<SessionPayload | null> {
  const token = bearerToken(c.req.header('authorization'))
  const verdict = await verifySessionToken(c.env.SESSION_SIGNING_KEY, token ?? undefined, undefined, c.env.SESSION_SIGNING_KEY_PREVIOUS)
  return verdict.valid ? verdict.payload : null
}

publicRouter.get('/api/items.json', async (c) => {
  // Read-only surface — CF Pages preview origins allowed (#248 Phase 1).
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  // Phase 2d1: list endpoint now requires a valid session token. This
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
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3). This is the "bulk clone" surface
  // the per-isolate 10/min/IP budget above is sized to make expensive — and
  // therefore the one where the IP-rotation reset that budget is vulnerable
  // to matters most. Same 10/min shape, but globally consistent per token.
  const listPayload = await sessionPayloadOf(c)
  const listLimit = await globalLimit(c.env, 'list', subjectFor(ip, listPayload?.nonce), { limit: 10, windowMs: 60_000 })
  if (!listLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(listLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // National expansion (plan §2.0): the list endpoint is region-scoped.
  //
  // An omitted `?region=` means `bay`, NOT "every row" — today those are the
  // same response (migration 0016 defaults every existing row to 'bay', and
  // no national importer has run), so this ships as zero visible change. The
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
      // /cities/{metro} routes (#358/#387) and someone hand-translates a URL.
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
    // `city` is populated by the national static-place importers but is null
    // on every event ingester (they fold the city into `address`). The list +
    // calendar cards show a city so a distance number isn't the only sense of
    // place, so derive it from the address when the column is empty. Display
    // only — nothing is written back, so the suburb SEO pages still read the
    // real column.
    if (!out.city) out.city = cityFromAddress(it.address)
    return out
  })

  // Second pass, EVENTS ONLY: an event whose address is a bare venue name
  // ("Rinconada Library") or missing entirely still has no city after the
  // parse above, and an event card without a city is the case this whole
  // field exists to fix. Borrow one from nearby rows that do have a city —
  // including the events resolved in the first pass, which is why this runs
  // after it and not inside the map. Places are deliberately left alone: the
  // ask was events, and a place with no city is a data-coverage question for
  // the importers rather than something to infer per request.
  //
  // Built lazily: this is the hottest endpoint, and on a metro where every
  // event already resolved (or that has no events at all) indexing thousands
  // of donors would be pure overhead on every uncached request.
  const needsInference = items.filter((i) => !i.city && isGatedEventKind(i))
  if (needsInference.length > 0) {
    const donorIndex = new CityDonorIndex(
      items.flatMap((i) => (i.city ? [{ lat: i.lat, lng: i.lng, city: i.city }] : [])),
    )
    for (const item of needsInference) {
      item.city = donorIndex.lookup(item.lat, item.lng)
    }
  }

  // Phase 2d1: private, not public — CF edge must NOT share-cache since
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

// Current-weather lookup for the rainy-day banner. Unlike items/tiles this
// is not curated or per-session data, so it is unauthenticated and cached
// publicly — the opposite posture from the session-gated endpoints above,
// deliberately.
//
// Upstream is Open-Meteo (https://open-meteo.com/en/docs), which is free and
// keyless at this call volume (no API key to provision, rotate, or leak).
// The query point is the metro's own registry centroid (`initialView`), not
// the visitor's coordinates, so this never sends a visitor's location or IP
// to a third party — it only asks "is it raining in {metro}" once per cache
// window, from the Worker, on the metro's behalf.
publicRouter.get('/api/weather', async (c) => {
  // Read-only surface — CF Pages preview origins allowed, same as items.json.
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  // Reuses the detail budget (60/min/IP): real traffic here is "once per
  // page load per metro", and the `cf.cacheTtl` below keeps actual upstream
  // calls far below even that.
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: `weather:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const regionParam = c.req.query('region') ?? DEFAULT_REGION
  if (!isValidRegion(regionParam)) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'unknown region' }, 400)
  }
  if (!isPublishedRegion(regionParam)) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'region not published' }, 404)
  }
  const metro = getMetro(regionParam)!
  const { latitude, longitude } = metro.initialView

  const upstreamUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=precipitation,weather_code&timezone=auto`
  let upstream: Response
  try {
    // `cf.cacheTtl` caches this *subrequest* at the Cloudflare edge, so
    // repeat calls for the same metro within the window never reach
    // Open-Meteo at all — this is what keeps a free, keyless upstream
    // viable at any real traffic volume.
    upstream = await fetch(upstreamUrl, { cf: { cacheTtl: 1200, cacheEverything: true } })
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'weather upstream unreachable' }, 502)
  }
  if (!upstream.ok) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'weather upstream error' }, 502)
  }
  const body = (await upstream.json()) as { current?: { precipitation?: number; weather_code?: number } }
  const code = body.current?.weather_code
  const isRaining = isRainingFromWeather(code, body.current?.precipitation)

  // Public + cacheable at the CF edge too (unlike items/tiles, this isn't
  // per-session data) — a 20-minute window matches Open-Meteo's own current
  // -weather refresh cadence closely enough that a shorter TTL buys nothing.
  c.header('Cache-Control', 'public, max-age=1200')
  return c.json({ region: metro.id, isRaining, weatherCode: code ?? null, asOf: new Date().toISOString() })
})

// Per-item detail endpoint. Returns the full Item shape for one row. The
// SPA fetches from here on marker click / URL-param item. Separate rate
// limiter from the list endpoint (60/min/IP vs 10/min/IP) because real
// user flow is many detail fetches per one list fetch.
//
// Phase 2c: now requires a valid session token in Authorization header.
// Unauthenticated requests get 401; previous behaviour (any caller with
// correct Origin got detail) was Phase 1. Token gates off the bulk
// detail-scrape path that a determined adversary could have used even
// after Phase 1's list redaction.
publicRouter.get('/api/items/:id', async (c) => {
  // Read-only surface — CF Pages preview origins allowed (#248 Phase 1).
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3): globally-consistent budget keyed
  // by the session token's nonce (falls back to IP only if verification
  // somehow fails here after already passing sessionGuard above — defensive,
  // shouldn't happen). Same 60/min shape as the per-isolate limiter above,
  // but immune to the IP-rotation reset that limiter is vulnerable to.
  const detailPayload = await sessionPayloadOf(c)
  const detailLimit = await globalLimit(c.env, 'items-detail', subjectFor(ip, detailPayload?.nonce), { limit: 60, windowMs: 60_000 })
  if (!detailLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(detailLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const id = c.req.param('id')

  // Sequential-ID enumeration heuristic (issue #198 triage). A tile walk at
  // z=11-12 already yields every public id, so the rate limiter above caps
  // *volume* but not *pattern* — this catches an IP methodically walking
  // that harvested id list in sorted order, which no organic click session
  // does. See utils/enumerationGuard.ts for the decision logic.
  const ipHash = await hashIp(ip)
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
  // Same region gate as the list and tile endpoints (#371). An unpublished
  // metro's rows are `approved` in D1 from import time, so status alone would
  // have made every one of them fetchable by id. Returns 404 rather than 403
  // so an unpublished metro's ids aren't enumerable.
  if (!item || item.status !== 'approved' || !isPublishedRegion(item.region)) {
    return c.json({ error: 'not found' }, 404)
  }

  // Events sign-in gate — SERVER-side enforcement (2026-07-26 real sign-in).
  // Event curated fields require a member-tier session token (minted by
  // `POST /api/session` against a valid member credential). Without this the
  // SPA's gate was theater — the fields sat one devtools fetch away. The
  // list/tile teaser surface (name, category, coords, times) stays open to
  // every valid session; only the detail is membership-priced. Distinct
  // `signin-required` reason so the SPA can tell this 401 from a stale
  // session token. `no-store` — a browser-cached 401 would outlive sign-in.
  // Gate predicate is shared with the SPA (shared/eventsGate.ts): category
  // OR type — venue rows in the event category (type='place') gate too.
  if (c.env.EVENTS_REQUIRE_MEMBER === 'enabled' && isGatedEventKind(item)) {
    // Reuse the payload already verified for the global rate-limit subject
    // above instead of re-verifying the same bearer token a third time.
    if (detailPayload?.tier !== 'member') {
      c.header('Cache-Control', 'no-store')
      return c.json({ error: 'unauthorized', reason: 'signin-required' }, 401)
    }
  }

  // Browser caches 1h; CF edge does NOT cache (s-maxage=0). If we let the
  // shared edge cache hold a 200 response, subsequent unauthenticated
  // requests would be served the cached body *without* the worker running
  // (and thus without sessionGuard firing) — the exact hole Phase 2c was
  // meant to close. `s-maxage=0` tells CF edge to skip the shared cache;
  // each request runs the worker, re-checks the token, then re-queries D1.
  // Acceptable cost given D1 detail queries are ~5ms. See the data-
  // protection-plan.md threat model — this is the "token gates access,
  // not identity of cached content" discipline, simpler form: just don't
  // share-cache authenticated content at the edge at all. Phase 2d can
  // introduce a worker Cache API layer for per-request perf if needed.
  c.header('Cache-Control', 'private, max-age=3600')
  // Affiliate rewrite (#254): outbound URLs swap to affiliate-tagged
  // equivalents when a partner id is configured. No partner configured (or
  // no host match) returns `item` untouched — byte-identical response to the
  // pre-#254 worker. See utils/affiliate.ts.
  return c.json({ item: applyAffiliateToItem(item, affiliateConfigFromEnv(c.env)) })
})

// Minimal coordinate-only endpoint (#250 Phase 2d2 step (d)). Exists so
// `useUrlItem`'s `?item=<id>` fly-to lookup no longer needs the FULL
// `/api/items.json` catalog just to resolve one id's lat/lng — tile
// features carry no lat/lng-by-id index (a tile is scoped to its own bbox,
// so the item may not even be in a currently-loaded tile), and shipping a
// second full detail fetch just for coordinates would be wasteful and widen
// the curated-field exposure for no reason. Same guards, same rate budget,
// and the same anti-enumeration 404 as the full detail endpoint — this is
// deliberately NOT a lighter-weight version of that endpoint's protection,
// only of its response body.
//
// Shipped unconsumed in the #620 PR (so the eventual `useUrlItem` migration
// would be a pure frontend change with no worker deploy coupled to it); now
// consumed by `useUrlItem` via `useItemCoords` (#250 Phase 2d2 step (d),
// this PR) — see the #250 PR body for the phased plan.
publicRouter.get('/api/items/:id/coords', async (c) => {
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer, SAME scope as `/api/items/:id` (issue #198 item 1, 2d3) —
  // this endpoint shares that endpoint's per-isolate budget too (see the
  // route comment above), so it shares its global budget as well: an
  // adversary alternating between the two to spread load across counters
  // must not effectively double their allowance.
  const coordsPayload = await sessionPayloadOf(c)
  const coordsLimit = await globalLimit(c.env, 'items-detail', subjectFor(ip, coordsPayload?.nonce), { limit: 60, windowMs: 60_000 })
  if (!coordsLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(coordsLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const id = c.req.param('id')
  const item = await getById(c.env.DB, id)
  // Same region gate as detail/list/tiles (#371) — 404 rather than 403 so an
  // unpublished metro's ids aren't enumerable.
  if (!item || item.status !== 'approved' || !isPublishedRegion(item.region)) {
    return c.json({ error: 'not found' }, 404)
  }

  c.header('Cache-Control', 'private, max-age=3600')
  return c.json({ lat: item.lat, lng: item.lng })
})

// Vector tile endpoint (Phase 2b). Returns MVT-encoded points for one tile
// at (z, x, y). Phase 2c's frontend will consume this via a MapLibre vector
// source; for now the endpoint exists alongside `/api/items.json` without
// any client wired up — zero user impact.
//
// Payload contains only `{id, name, category, type}` as feature properties
// (geometry carries lat/lng). All curated fields stay behind the detail
// endpoint. Phase 2c may widen to include filter fields (cost, indoor,
// age, times) if we want to filter client-side off the tile payload.
//
// Rate-limited under the detail budget (60/min/IP) because real map usage
// fires many tile requests per session (pan/zoom generates 4-10 tiles at a
// time); the list budget (10/min) would be too tight. Same binding as
// detail so an attacker chaining tile + detail fetches burns one budget,
// not two.
//
// Edge-cached 1h per (z, x, y). Admin mutations don't purge tiles yet (the
// purge set would be all covering tiles — doable but deferred to Phase 2c
// along with the `status_rev` query-param-versioning the plan describes).
// 1h staleness on a pin appearance is acceptable given daily archive-
// expired + per-week routine cadence; same argument as the detail cache.
const TILE_PATH_RE = /^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/

// The real fairness boundary, enforced app-side by `fairCapByCategory`
// (#424) — see the comment above the tile query below.
const TILE_ROW_CAP = 10000
// A generous multiple of TILE_ROW_CAP so a pathological low-zoom tile
// (an entire dense metro) can't pull an unbounded row set into worker
// memory before the app-side cap runs; far above any realistic tile size.
const SQL_ROW_SAFETY_CAP = TILE_ROW_CAP * 3

publicRouter.get('/api/tiles/*', async (c) => {
  // Read-only surface — CF Pages preview origins allowed (#248 Phase 1).
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

  // Phase 2c: tiles require a valid session token. Without gating, the
  // tile endpoint would just be a different wire-format clone of the
  // list payload — same protection model as detail.
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3). Own scope, own — LOOSER — budget:
  // 120/min rather than the 60/min shared by items-detail/coords. A single
  // pan or zoom gesture fires 4-10 tile requests essentially at once (every
  // tile newly in view), so real map usage is bursty in a way single-item
  // detail fetches aren't; 60/min would throttle one enthusiastic pan by a
  // legitimate user. 120/min still bounds a tile-walk scrape (the enumeration
  // path the detail budget's 60/min is sized to make expensive) to a couple
  // of z11-12 tiles a second globally per token/IP, across every colo.
  const tilesPayload = await sessionPayloadOf(c)
  const tilesLimit = await globalLimit(c.env, 'tiles', subjectFor(ip, tilesPayload?.nonce), { limit: 120, windowMs: 60_000 })
  if (!tilesLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(tilesLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const { west, south, east, north } = tileBbox(z, x, y)
  // Draw-order strategy: MapLibre renders `circle` layer features in the
  // order they appear in the tile. Tile feature order = SQL ORDER BY order.
  //
  // Two UX rules encoded below:
  //   (A) Playground > Park > Museum > ... — smaller, more-specific pins
  //       render on top of larger-venue pins. `ORDER BY category` lands
  //       playgrounds last alphabetically (matches pre-Phase-2c2 behavior).
  //   (B) Within a category, earliest-upcoming event renders on TOP of
  //       later-upcoming events at the same coordinates. Users discovering
  //       "what's coming up" want the nearer-term pin to be the clickable
  //       one. `COALESCE(start_time, '9999-...')` DESC puts latest first,
  //       earliest last → earliest drawn last → on top. NULL start_times
  //       (places without a date) coalesce to a max value → sort first →
  //       drawn under dated events → dated events render on top. `name`
  //       is a stable tiebreak for fully equal keys.
  //
  // LIMIT 10000: at z=8-9 a single tile covers the whole Bay Area (~4600
  // rows). 500 was truncating 90% of the dataset. At z ≥ 11 each tile has
  // <500 rows anyway, so the higher cap only matters for the few low-zoom
  // tiles and is cheap for them.
  //
  // Fair thinning (#424). The SQL LIMIT below is a generous *safety valve*
  // (SQL_ROW_SAFETY_CAP), not the fairness boundary — a flat
  // `ORDER BY category, ... LIMIT 10000` picks its survivors by
  // category-alphabetical position, so once a tile's row count crosses the
  // cap every category *after* the cutoff point is wiped out wholesale
  // (e.g. `playground`/`upick`/`waterplay` vanish entirely) instead of
  // every category losing the same share. `fairCapByCategory` (utils/tile)
  // applies the real 10000-row cap app-side by round-robining one row per
  // category at a time, so truncation removes each category's tail evenly
  // instead of removing whole categories — same idea as the per-category
  // `ROW_NUMBER() OVER (PARTITION BY category ...)` fix already shipped for
  // the SEO pin-sample truncation in #414, done in JS here so the fairness
  // logic is unit-testable without a D1 fixture. No `ORDER BY RANDOM()` —
  // capping is a deterministic function of each row's draw-order position,
  // so the same tile query returns the same survivors on a cache miss
  // instead of visibly reshuffling which pins are visible. The SQL LIMIT
  // still bounds worst-case D1 read/memory for a pathological low-zoom
  // tile before the app-side cap runs.
  // Region gate (#371). `status='approved'` is NOT a visibility decision on
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
      'SELECT id, name, category, type, lat, lng, crops, crops_state, ' +
      'age_min, age_max, cost, indoor, start_time, end_time, rrule, exdates FROM items ' +
      "WHERE status = 'approved' " +
      `AND region IN (${regionPlaceholders}) ` +
      'AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ' +
      "ORDER BY category, COALESCE(start_time, '9999-99-99') DESC, name " +
      `LIMIT ${SQL_ROW_SAFETY_CAP}`,
    )
    .bind(...published, south, north, west, east)
    .all<TilePoint & { crops: string | null; crops_state: string | null }>()

  // #424: thin to the real row cap fairly across categories, not by
  // truncating the SQL-order tail. See TILE_ROW_CAP / SQL_ROW_SAFETY_CAP
  // above and fairCapByCategory (utils/tile) for the rationale.
  warnIfTileCapped(z, x, y, results.length, TILE_ROW_CAP)
  const capped = fairCapByCategory(results, TILE_ROW_CAP)

  // For upick rows, pre-resolve the per-farm primary_crop_emoji using the
  // rule in the v1-medium spec (see resolvePrimaryCropEmoji in utils/tile).
  // MapLibre expressions can't call JS, so this pre-computation lives on
  // the worker side. Non-upick rows pass through unchanged.
  const resolved: TilePoint[] = capped.map((row) => {
    const base: TilePoint = {
      id: row.id, name: row.name, category: row.category, type: row.type,
      lat: row.lat, lng: row.lng,
      // Filter fields (#250 Phase 2d2 step (a) — see TilePoint in utils/tile).
      age_min: row.age_min, age_max: row.age_max, cost: row.cost, indoor: row.indoor,
      start_time: row.start_time, end_time: row.end_time, rrule: row.rrule, exdates: row.exdates,
    }
    if (row.category === 'upick') {
      const emoji = resolvePrimaryCropEmoji(row.crops, row.crops_state)
      if (emoji) base.primary_crop_emoji = emoji
    }
    return base
  })

  const pbf = buildTile(z, x, y, resolved)

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
      // Phase 2d can introduce an explicit worker-Cache-API layer.
      'cache-control': 'private, max-age=3600',
    },
  })
})

// Session mint (Phase 2a). Issues a 5-minute HMAC-signed token. Shipped but
// NOT required anywhere yet — Phase 2c adds `Authorization: Bearer` checks
// on data endpoints. Shipping mint first means the frontend can start
// obtaining tokens and stashing them in memory without breaking anyone, then
// the enforcement flip is a pure server-side change.
//
// Behaviour when `SESSION_SIGNING_KEY` is unset: 503, `Retry-After: 300`.
// This is the cold-deploy path — code is live but the secret hasn't been
// set via `wrangler secret put SESSION_SIGNING_KEY`. Returning 503 (not 500)
// lets browsers treat this as transient and retry, and keeps the frontend's
// session-mint call idempotent.
publicRouter.post('/api/session', async (c) => {
  // Read-only surface — CF Pages preview origins allowed (#248 Phase 1). A
  // preview build must be able to mint a token to load tiles/items, but the
  // token grants only the read endpoints; writes re-check the exact allowlist.
  const blocked = originGuard(c, isAllowedOrigin)
  if (blocked) return blocked

  if (!c.env.SESSION_SIGNING_KEY) {
    c.header('Retry-After', '300')
    return c.json({ error: 'session minting not yet configured' }, 503)
  }

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  // Rate-limit session mints under the list budget (10/min/IP). A browser
  // legitimately needs one mint per page load + one refresh per 5 min; a
  // burst of mints is either broken client code or abuse.
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3), keyed by IP only — this is the
  // one gated route with no token to key off of yet (minting one is the
  // whole point of the call). 10/min/IP, matching the per-isolate budget
  // just above, but globally consistent: this is the endpoint an IP-rotating
  // adversary would hit hardest to keep manufacturing fresh per-isolate
  // buckets for every OTHER endpoint, so it's the one place a colo-local
  // reset is most valuable to close.
  const mintLimit = await globalLimit(c.env, 'session', subjectFor(ip, undefined), { limit: 10, windowMs: 60_000 })
  if (!mintLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(mintLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Real sign-in (2026-07-26): an optional JSON body `{credential}` upgrades
  // the mint to member tier. The credential is the 90-day token issued by
  // the sign-in endpoint (`/api/auth/google`); a valid one
  // stamps `tier:'member'` + `sub` into
  // the 5-minute session payload, which is what the event-detail enforcement
  // reads. An invalid/expired/absent credential mints a guest session — never
  // an error, so a stale credential can't break the map. `member` rides back
  // in the response so the SPA can drop a credential the server no longer
  // honors instead of silently browsing as a guest with a dead credential.
  let member: { sub: string } | undefined
  try {
    const body = await c.req.json<{ credential?: unknown }>()
    if (typeof body.credential === 'string') {
      const cred = await verifyMemberCredential(c.env.SESSION_SIGNING_KEY, body.credential, undefined, c.env.SESSION_SIGNING_KEY_PREVIOUS)
      if (cred.valid) member = { sub: cred.payload.sub }
    }
  } catch {
    // No body / not JSON — the pre-auth SPA sends none. Guest mint.
  }

  const token = await mintSessionToken(c.env.SESSION_SIGNING_KEY, undefined, undefined, member)
  // Never cache. Every mint must be fresh — a cached token would be shared
  // across users and handed out by CF edge for the 1h TTL.
  c.header('Cache-Control', 'no-store')
  return c.json({ token, ttl_seconds: 300, member: !!member })
})

// ── Real sign-in: Google-only (2026-07-27 operator call) ────────────────────
//
// "Account" = a row in `users` (migration 0022). ONE way in:
//   - POST /api/auth/google {idToken, region?} → Google-verified sign-in,
//     returning the 90-day member credential that `POST /api/session`
//     exchanges for member-tier session tokens (above) — which is what the
//     event-detail enforcement reads.
//
// An email+password register/login pair was built on this branch and then
// REMOVED before merge (operator: the audience is overwhelmingly Gmail;
// one button beats a form, and dead endpoints would be an account-pollution
// channel). The `users.password_hash/password_salt` columns and the
// `'password'` provider in migration 0022's CHECK stay reserved should an
// email option return. Address quality is a non-issue on this path: Google
// emails arrive VERIFIED (email_verified in the signed token).

/** Shared derivation for both sign-in waitlist rows: `city` keeps
 *  resolveSignupCity's invariant — published metro ids or NULL. */
function signupCityFor(region: string | null): string | null {
  return region && isPublishedRegion(region) ? region : null
}

/** Insert the events-gate demand-signal row (server-authored source — no
 *  resolveSignupSource round-trip). Returns true when the row is new. */
async function insertGateSignup(env: Env, email: string, region: string | null): Promise<boolean> {
  const source = region ? `events-gate:${region}` : 'events-gate'
  const result = await env.DB.prepare(
    'INSERT INTO waitlist_signups (email, source, city) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING'
  ).bind(email, source, signupCityFor(region)).run()
  return result.meta.changes === 1
}

/** Newsletter opt-in ticked on the sign-in surface (2026-08-09): unlike the
 *  events-gate side-effect row above, this is an AFFIRMATIVE opt-in — the
 *  source is `signin-optin[:{region}]`, which `shared/signupSource.ts`
 *  classifies as 'newsletter' (and the 500-sub gate therefore counts).
 *  Conflict rule: upgrade an events-gate demand-signal row in place (consent
 *  supersedes the side effect) and refresh a prior signin-optin row (a later
 *  opt-in from another metro must be able to move region/city — the digest
 *  segments on them), but NEVER overwrite a typed-in source (`signup_page`,
 *  `coming-soon:{metro}:{category}`) — those carry richer intent than this
 *  checkbox. GLOB matches SIGNUP_KIND_SQL's case-sensitive predicate in
 *  routes/admin.ts.
 *
 *  Returns true only when this call CREATED a newsletter subscription that
 *  didn't exist before (no row, or an events-gate row upgraded) — a repeat
 *  ticked login refreshes the row but is NOT a new subscription, and the
 *  SPA's `newsletter_signup` goal keys off this so /admin/behavior counts
 *  subscriptions, not login events. */
async function insertOptInSignup(env: Env, email: string, region: string | null): Promise<boolean> {
  const source = region ? `signin-optin:${region}` : 'signin-optin'
  const prior = await env.DB.prepare('SELECT source FROM waitlist_signups WHERE email = ?')
    .bind(email).first<{ source: string }>()
  await env.DB.prepare(
    `INSERT INTO waitlist_signups (email, source, city) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       source = excluded.source,
       city = COALESCE(excluded.city, waitlist_signups.city)
     WHERE waitlist_signups.source GLOB 'events-gate*'
        OR waitlist_signups.source GLOB 'signin-optin*'`
  ).bind(email, source, signupCityFor(region)).run()
  // Ticking the box is affirmative RE-consent too: without this, someone who
  // unsubscribed and later opted back in would see a success state and never
  // be mailed again (the source-protected upsert above can't clear it, and a
  // typed-in row's tombstone must also lift on an explicit new opt-in).
  await env.DB.prepare(
    'UPDATE waitlist_signups SET unsubscribed_at = NULL WHERE email = ? AND unsubscribed_at IS NOT NULL'
  ).bind(email).run()
  return !prior || signupKind(prior.source) !== 'newsletter'
}

// "Sign in with Google". The SPA's GIS button posts the Google-signed ID
// token here; we verify it against Google's JWKS (utils/googleIdToken.ts —
// signature, iss, aud=our client id, exp, email_verified) and establish the
// account + credential. One tap, and Google already verified the address.
// 503 when GOOGLE_CLIENT_ID is unset — the feature ships dark until the
// operator creates the OAuth client.
publicRouter.post('/api/auth/google', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  if (!c.env.GOOGLE_CLIENT_ID) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'google sign-in not configured' }, 503)
  }

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: `auth-google:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { idToken?: unknown; region?: unknown; newsletter?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (typeof body.idToken !== 'string' || !body.idToken) {
    return c.json({ error: 'idToken required' }, 400)
  }
  const region = typeof body.region === 'string' && isValidRegion(body.region) ? body.region : null
  // Strict === true: the flag is consent, so anything short of an explicit
  // boolean from our own client falls back to the no-consent path.
  const newsletterOptIn = body.newsletter === true

  const verdict = await verifyGoogleIdToken(body.idToken, c.env.GOOGLE_CLIENT_ID)
  if (!verdict.ok) {
    c.header('Cache-Control', 'no-store')
    // OUR outage (can't reach Google's JWKS), not the caller's token —
    // retryable 503, distinct from the uniform 401 below.
    if (verdict.reason === 'jwks-unavailable') {
      console.error('[auth-google] jwks unavailable — google sign-in degraded')
      c.header('Retry-After', '60')
      return c.json({ error: 'google sign-in temporarily unavailable — try again shortly' }, 503)
    }
    // Reason stays server-side detail except the log line — the client copy
    // is uniform ("sign-in didn't complete"), and a forged token learns
    // nothing from the response shape.
    console.warn(`[auth-google] rejected id token reason=${verdict.reason}`)
    return c.json({ error: 'google token not accepted' }, 401)
  }

  // Upsert: a Google sign-in on an email that already has an account (either
  // provider) is a login, not an error — and never touches an existing
  // password hash or provider label. `region` keeps the LAST seen metro
  // (migration 0023 — digest segmentation); COALESCE so a region-less
  // sign-in never wipes a previously known one.
  const userId = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, provider, last_login_at, region) VALUES (?, ?, 'google', datetime('now'), ?)
     ON CONFLICT(email) DO UPDATE SET
       last_login_at = datetime('now'),
       region = COALESCE(excluded.region, users.region)`
  ).bind(userId, verdict.email, region).run()
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(verdict.email).first<{ id: string }>()
  const sub = row?.id ?? userId

  // Verified address = premium demand signal; no welcome email on this path
  // (Google users' first touch is the newsletter launch itself). With the
  // opt-in ticked the row is a real newsletter subscription instead.
  // `subscribed` = a newsletter subscription NEWLY came into being on this
  // call (repeat ticked logins refresh the row and return false).
  let subscribed = false
  if (newsletterOptIn) {
    subscribed = await insertOptInSignup(c.env, verdict.email, region)
  } else {
    await insertGateSignup(c.env, verdict.email, region)
  }

  const credential = await mintMemberCredential(c.env.SESSION_SIGNING_KEY!, sub, verdict.email)
  c.header('Cache-Control', 'no-store')
  return c.json({ credential, email: verdict.email, ttl_seconds: CREDENTIAL_TTL_SECONDS, subscribed })
})

// Self-serve account deletion (#535). The privacy policy's §12 deletion right
// was previously only exercisable by emailing hello@ — workable at hundreds of
// members, not past that. Authenticated by the member credential alone (the
// same 90-day token `POST /api/session` exchanges): possessing it is what
// proves the account, and there is no second factor to re-confirm against on a
// Google-only sign-in. Guard stack matches `/api/auth/google` — prod-origin
// write, session-gated, per-IP rate-limited on its own key prefix so a
// deletion burst can't starve sign-in (or vice versa).
//
// Deletion is TOTAL: the `users` row AND the `waitlist_signups` row for the
// same address. Account deletion is a deletion request under privacy policy
// §12, which covers "the User's account record and newsletter subscription"
// together — leaving the subscription behind would keep mailing someone who
// just asked to be erased. Unsubscribing WITHOUT deleting is the separate
// `/api/unsubscribe` path (which tombstones rather than deletes).
//
// Delete by `sub` first: sign-in mints `sub` from `users.id` read back after
// the upsert (`ON CONFLICT(email) DO UPDATE` preserves the original id), so a
// live credential's `sub` is always the real row id, stable across logins.
// The email fallback covers the one case where it isn't — an account deleted
// and then re-created by a fresh sign-in gets a NEW uuid, so an older
// credential still in another tab's localStorage carries a dead `sub`. The
// fallback is safe because the email in the credential is HMAC-signed by us
// over a Google-verified address; it is not caller-supplied.
//
// Statelessness is accepted: the HMAC credential stays cryptographically
// valid until its 90-day expiry, and nothing here revokes it. That's fine —
// the row is gone, detail-gating only checks the session's tier (never the
// user row), and a re-sign-in simply creates a fresh account. Rotating
// SESSION_SIGNING_KEY remains the global kill switch. A revocation list would
// be the only stateful alternative, and it would mean storing the identifier
// of someone who asked to be forgotten.
//
// Idempotent: deleting an already-deleted account still answers 200 {ok:true}.
publicRouter.post('/api/auth/delete-account', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: `auth-delete:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { credential?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const credential = typeof body.credential === 'string' ? body.credential : undefined

  // Uniform 401 for missing / malformed / bad-signature / expired — the reason
  // stays server-side. A caller probing with forged credentials learns nothing.
  const verdict = await verifyMemberCredential(c.env.SESSION_SIGNING_KEY, credential, undefined, c.env.SESSION_SIGNING_KEY_PREVIOUS)
  if (!verdict.valid) {
    c.header('Cache-Control', 'no-store')
    console.warn(`[delete-account] rejected credential reason=${verdict.reason}`)
    return c.json({ error: 'unauthorized' }, 401)
  }

  const { sub, email } = verdict.payload
  const bySub = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(sub).run()
  if ((bySub.meta?.changes ?? 0) === 0) {
    await c.env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run()
  }
  await c.env.DB.prepare('DELETE FROM waitlist_signups WHERE email = ?').bind(email).run()

  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true })
})

// CORS for the report endpoint — same allowlist as the data endpoints.
publicRouter.use('/api/report', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

// User problem-reports ("closed", "wrong info", …) land in the admin
// ReportsView. Hardened to match the other public writes: origin-guarded,
// session-gated, and rate-limited via the Workers binding (this was
// previously the one public write with none of those — an in-memory
// per-isolate limiter and a spoofable x-forwarded-for fallback were the
// only defenses, leaving a free spam vector into the admin queue).
// List budget (10/min/IP): real users file roughly one report per session.
publicRouter.post('/api/report', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  // cf-connecting-ip only — XFF is attacker-forgeable (see items.json).
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { item_id?: unknown; reason?: unknown; note?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  // Clamp lengths to prevent pathological payloads. item_id matches the
  // outbound-click clamp (128); real ids are well under that.
  const itemId = typeof body.item_id === 'string' ? body.item_id.slice(0, 128) : null
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null
  if (!itemId || !reason) return c.json({ error: 'item_id and reason required' }, 400)

  await c.env.DB.prepare(
    'INSERT INTO reports (item_id, reason, note, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(itemId, reason, note, new Date().toISOString())
    .run()
  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true })
})

// CORS for outbound-click telemetry — same allowlist as the data endpoints.
publicRouter.use('/api/outbound-click', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

// Phase 0 instrumentation: outbound-click telemetry. Logs every popup
// outbound click (Google Maps / Apple Maps / Website / Source) so we can
// answer "we drove X clicks to your venue last month" come Phase 2 sales.
//
// Session-token gated (matches data endpoints) so a single curl loop
// can't pollute the data without first minting. Per-IP rate-limited
// at the detail-endpoint budget (60/min) — real users legitimately
// click multiple popup links per session; bulk POSTs are abuse.
//
// Body validation is narrow: `item_id` (<=128 chars) and `dest_host`
// (<=255 chars, the canonical hostname stripped of path/query). The
// frontend's analytics util computes `dest_host` from the link's
// `href`, so curl callers can't smuggle full URLs into the column.
publicRouter.post('/api/outbound-click', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3). Own scope so an adversary can't
  // spend the items-detail/tiles/list budgets by routing traffic through
  // this endpoint instead — same 60/min shape as the per-isolate budget
  // above, but globally consistent per token.
  const outboundPayload = await sessionPayloadOf(c)
  const outboundLimit = await globalLimit(c.env, 'outbound-click', subjectFor(ip, outboundPayload?.nonce), { limit: 60, windowMs: 60_000 })
  if (!outboundLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(outboundLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { itemId?: unknown; destHost?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const itemId = typeof body.itemId === 'string' ? body.itemId.slice(0, 128) : null
  const destHost = typeof body.destHost === 'string' ? body.destHost.slice(0, 255) : null
  if (!itemId || !destHost) {
    return c.json({ error: 'itemId and destHost required (strings)' }, 400)
  }

  // Affiliate attribution (#254): classify the destination host SERVER-side
  // (never a client-sent flag — the telemetry body stays unspoofable). The
  // rewrite in the detail endpoint never changes a URL's host, so "partner
  // host AND that partner is configured" ⇔ the served link carried our tag.
  // With no partner configured this is always null/0 — identical rows to
  // the pre-#254 handler.
  const partner = affiliatePartnerForHost(destHost, affiliateConfigFromEnv(c.env))
  await c.env.DB.prepare(
    'INSERT INTO outbound_clicks (item_id, dest_host, is_affiliate, partner) VALUES (?, ?, ?, ?)'
  )
    .bind(itemId, destHost, partner ? 1 : 0, partner)
    .run()

  // 204 No Content keeps the response empty; analytics is fire-and-forget.
  // Cache-Control no-store so CF edge / browsers never replay or cache.
  c.header('Cache-Control', 'no-store')
  return c.body(null, 204)
})

// CORS for ui-event telemetry — same allowlist as the data endpoints.
publicRouter.use('/api/ui-event', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

// Allowlisted UI-interaction goals (#481), from the shared single source of
// truth in `shared/uiEventGoals.ts` — the same list the client's `GoalName`
// union derives from, so the two sides cannot drift (a goal added on one side
// only would 400 silently forever; the client swallows telemetry failures).
// `outbound_click` is deliberately absent from the shared list: it has its own
// `outbound_clicks` table (migration 0008) and the client never posts it here,
// so accepting it would double-report. Any goal not in this set is rejected
// 400 — the column must never hold an attacker-chosen string.
const UI_EVENT_GOAL_SET = new Set<string>(UI_EVENT_GOALS)

// Phase 0 instrumentation: UI-interaction telemetry (#481). Persists the
// `trackGoal` goals (newsletter bell, coffee/support, filter chips, near-me,
// view toggle, share, popup opens, coming-soon taps) to D1 so user behavior
// is measurable — CF Web Analytics goals are unqueryable on the free tier.
//
// Mirrors `/api/outbound-click`'s guard stack: prod-origin-only write (NOT
// preview origins — a preview build must never pollute prod telemetry),
// session-token gated, per-IP rate-limited, capped JSON body.
//
// The rate-limit key is namespaced (`ui-event:` prefix): a bare `ip` key
// would share one 60/min counter with tiles + detail + outbound-click (same
// binding, same key), letting high-frequency telemetry starve tile serving
// during heavy map use. The prefix gives telemetry its own 60/min counter —
// when the budget runs out it's the (silently dropped) events that throttle,
// never the map.
//
// `goal` is validated against the shared allowlist (unknown → 400). `context`
// is an optional length-capped hint — the item id behind popup_open/share, the
// category id behind filter_chip/coming_soon_tap, the target view behind
// view_toggle — stored NULL when absent/blank. The 128 cap matches the
// outbound-click item_id clamp: aggregator item ids run past 64 chars, and a
// truncated id can't be joined back against `items`. Aggregate-only: no PII,
// no user id, no IP stored.
publicRouter.post('/api/ui-event', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: `ui-event:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Second layer (issue #198 item 1, 2d3). Own scope, same reasoning as the
  // `ui-event:` prefix on the per-isolate key above — high-frequency
  // telemetry must throttle on its own budget, never starve tiles/detail's
  // global counters (or vice versa: a tile-walk scrape spending its
  // items-detail/tiles budget must not also burn the telemetry budget).
  const uiEventPayload = await sessionPayloadOf(c)
  const uiEventLimit = await globalLimit(c.env, 'ui-event', subjectFor(ip, uiEventPayload?.nonce), { limit: 60, windowMs: 60_000 })
  if (!uiEventLimit.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(uiEventLimit.resetAt)))
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { goal?: unknown; context?: unknown; region?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const goal = typeof body.goal === 'string' ? body.goal : null
  if (!goal || !UI_EVENT_GOAL_SET.has(goal)) {
    return c.json({ error: 'unknown goal' }, 400)
  }
  // context is optional; cap at 128 chars (see route comment), NULL if absent/blank.
  const context =
    typeof body.context === 'string' && body.context.trim() !== ''
      ? body.context.slice(0, 128)
      : null

  // region is optional per-city attribution (0021). Validated against the
  // metro registry — an absent, unknown, or garbage value stores NULL
  // ("unattributed") rather than rejecting the event: telemetry must never
  // 400 over its own attribution, and the column must only ever hold a real
  // metro id (bounded param, so no injection surface regardless).
  const region =
    typeof body.region === 'string' && isValidRegion(body.region) ? body.region : null

  await c.env.DB.prepare(
    'INSERT INTO ui_events (goal, context, region) VALUES (?, ?, ?)'
  )
    .bind(goal, context, region)
    .run()

  c.header('Cache-Control', 'no-store')
  return c.body(null, 204)
})

// CORS for user submissions (#226) — write path, same allowlist as
// outbound-click/ui-event/report. NOT preview-origin-allowed: a CF Pages
// PR-preview build must never be able to write a pending submission
// (member-only member data flowing into moderation for a real curator).
publicRouter.use('/api/submissions', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))
publicRouter.use('/api/submissions/mine', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

const SUBMISSION_MAX_PENDING_PER_USER = 10
// Per-user velocity cap (#683): at most 5 submissions per rolling hour,
// enforced globally by the DO limiter keyed on the member token's `sub` (the
// user id — NOT the per-mint nonce, which resets on every 5-min token refresh).
const SUBMISSION_VELOCITY_LIMIT = 5
const SUBMISSION_VELOCITY_WINDOW_MS = 60 * 60_000
// Honeypot field name (#683). Visually hidden in SubmitModal; real users never
// fill it. Deliberately NOT an autofill-prone name (`company*`, `url`,
// `website`, `email`… map to browser/password-manager autofill types, and an
// autofilled trap would silently swallow a real member's submission).
const SUBMISSION_HONEYPOT_FIELD = 'extra_info'

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}

function isValidIso(s: string): boolean {
  return Number.isFinite(Date.parse(s))
}

/**
 * "Suggest a place or event" (#226) — a signed-in member proposes a row for
 * the map. Lands in `submissions`, NEVER `items` directly: a curator must
 * approve it (`POST /api/admin/submissions/:id/approve`) before it's visible
 * to anyone else. Guard order mirrors every other write endpoint here
 * (origin → session → rate limit), plus two submission-specific checks: the
 * session must carry the MEMBER tier (guests can browse the map but not
 * write to it — same `signin-required` reason the event-detail gate uses,
 * so the SPA's existing sign-in prompt handles this 401 too), and a per-user
 * pending cap so one account can't flood the queue faster than a curator
 * can ever clear it.
 */
publicRouter.post('/api/submissions', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth
  const payload = await sessionPayloadOf(c)
  if (payload?.tier !== 'member' || !payload.sub) {
    return c.json({ error: 'unauthorized', reason: 'signin-required' }, 401)
  }
  const userId = payload.sub

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: `submit:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  // Fails open (no-op) when the DO binding is absent or errors.
  const velocity = await globalLimit(c.env, 'submissions', `user:${userId}`, {
    limit: SUBMISSION_VELOCITY_LIMIT,
    windowMs: SUBMISSION_VELOCITY_WINDOW_MS,
  })
  if (!velocity.success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', String(retryAfterSeconds(velocity.resetAt)))
    return c.json({ error: 'too many submissions, try again later' }, 429)
  }

  const pending = await countPendingByUser(c.env.DB, userId)
  if (pending >= SUBMISSION_MAX_PENDING_PER_USER) {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'too many pending submissions' }, 429)
  }

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  // Honeypot: a filled hidden field means a bot. Respond exactly like a
  // success (201 + a fake pending id) but persist nothing, so the bot gets no
  // signal to adapt to — same posture as the client-side `isLikelyBot()` guard,
  // which also drops bot traffic silently rather than erroring.
  const trap = body[SUBMISSION_HONEYPOT_FIELD]
  if (typeof trap === 'string' && trap.trim() !== '') {
    // Logged so a false positive (a real member whose browser filled the
    // trap anyway) is visible in `wrangler tail` rather than a silent loss.
    console.warn(`[submissions] honeypot tripped user=${userId}`)
    c.header('Cache-Control', 'no-store')
    return c.json({ id: `sub-${crypto.randomUUID()}`, status: 'pending' }, 201)
  }

  const type = body.type === 'place' || body.type === 'event' ? body.type : null
  if (!type) return c.json({ error: 'type must be "place" or "event"' }, 400)

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  if (!name) return c.json({ error: 'name is required' }, 400)

  const category = typeof body.category === 'string' ? body.category : null
  if (!category || !(ALL_CATEGORIES as readonly string[]).includes(category)) {
    return c.json({ error: 'unknown category' }, 400)
  }

  const lat = typeof body.lat === 'number' ? body.lat : NaN
  const lng = typeof body.lng === 'number' ? body.lng : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return c.json({ error: 'lat/lng must be valid coordinates' }, 400)
  }
  // Region is DERIVED from the coordinate (never client-supplied) — same
  // trust boundary as every ingester. A coordinate outside every metro's
  // ingestion bbox (plan §1.1) is out of scope for now rather than silently
  // filed under the nearest metro.
  const metro = metroForCoords(lat, lng)
  if (!metro || !isPublishedRegion(metro.id)) {
    return c.json({ error: 'coordinates are outside any published metro' }, 400)
  }

  const address = typeof body.address === 'string' && body.address.trim() !== '' ? body.address.trim().slice(0, 300) : null
  const description = typeof body.description === 'string' && body.description.trim() !== '' ? body.description.trim().slice(0, 2000) : null

  const website = typeof body.website === 'string' && body.website.trim() !== '' ? body.website.trim().slice(0, 500) : null
  if (website && !isHttpsUrl(website)) return c.json({ error: 'website must be an https:// URL' }, 400)
  const sourceUrl = typeof body.source_url === 'string' && body.source_url.trim() !== '' ? body.source_url.trim().slice(0, 500) : null
  if (sourceUrl && !isHttpsUrl(sourceUrl)) return c.json({ error: 'source_url must be an https:// URL' }, 400)

  let startTime: string | null = null
  let endTime: string | null = null
  if (type === 'event') {
    if (typeof body.start_time !== 'string' || !isValidIso(body.start_time)) {
      return c.json({ error: 'events require a valid ISO 8601 start_time' }, 400)
    }
    startTime = body.start_time
    if (body.end_time !== undefined && body.end_time !== null) {
      if (typeof body.end_time !== 'string' || !isValidIso(body.end_time)) {
        return c.json({ error: 'end_time must be a valid ISO 8601 timestamp' }, 400)
      }
      endTime = body.end_time
    }
  }

  const cost = body.cost === 'free' || body.cost === 'paid' ? body.cost : null

  const clampAge = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    return Math.min(Math.max(Math.trunc(v), 0), 18)
  }
  const ageMin = clampAge(body.age_min)
  const ageMax = clampAge(body.age_max)

  const indoor = body.indoor === true ? 1 : body.indoor === false ? 0 : null

  const id = `sub-${crypto.randomUUID()}`
  await insertSubmission(c.env.DB, {
    id,
    user_id: userId,
    region: metro.id,
    type,
    name,
    category,
    lat,
    lng,
    address,
    description,
    website,
    source_url: sourceUrl,
    start_time: startTime,
    end_time: endTime,
    cost,
    age_min: ageMin,
    age_max: ageMax,
    indoor,
    created_at: new Date().toISOString(),
  })

  c.header('Cache-Control', 'no-store')
  return c.json({ id, status: 'pending' }, 201)
})

/** A member's own submissions — id, name, status, created_at, item_id — so
 *  the SPA can show "here's what you suggested and where it stands" without
 *  a dedicated admin credential. Same member-tier gate as the write side. */
publicRouter.get('/api/submissions/mine', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth
  const payload = await sessionPayloadOf(c)
  if (payload?.tier !== 'member' || !payload.sub) {
    return c.json({ error: 'unauthorized', reason: 'signin-required' }, 401)
  }

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_DETAIL_RATE_LIMITER.limit({ key: `submissions-mine:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  const submissions = await listSubmissionsByUser(c.env.DB, payload.sub)
  c.header('Cache-Control', 'private, max-age=60')
  return c.json({ submissions })
})

// Phase 0 monetization gate: waitlist email capture (issue #165).
//
// Single opt-in. Inserts the email into `waitlist_signups` (idempotent
// via UNIQUE(email) + ON CONFLICT DO NOTHING) and dispatches a welcome
// email via Resend on the first insert only — duplicate re-submits don't
// re-email.
//
// Returns a neutral 200 in all success-shaped paths (new row, duplicate)
// to prevent address-enumeration: a curl loop iterating known emails
// against this endpoint can't distinguish "this address was already
// signed up" from "this address is new." Validation errors and rate
// limits return 400/429 as usual.
//
// Session-gated + IP-rate-limited under the list budget (10/min) — same
// as `POST /api/session` and `/api/items.json`. Tighter than the detail
// budget because successful signups are roughly one per user per session;
// burst beyond 10/min is abuse.
//
// Email validation is intentionally permissive (`a@b.c`) — the welcome
// email itself proves deliverability. Tighter regex would reject valid
// addresses (e.g. plus-aliasing, IDN domains) for no real benefit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate a signup attribution tag. Accepted shapes:
 *   - 'signup_page' (the default)
 *   - 'coming-soon:{region}:{category}' — a coming-soon chip tap (#359),
 *     with region checked against the metro registry and category against
 *     the shared union.
 *   - 'events-gate:{region}' — an events sign-in gate unlock (2026-07-26
 *     interest-gauge experiment): the per-metro count of these rows against
 *     gate impressions is the experiment's primary commercialization signal.
 * Anything else — junk, an unknown metro, a curl experiment — falls back to
 * 'signup_page' instead of 400ing: attribution must never block a signup.
 */
function resolveSignupSource(raw: unknown): string {
  if (typeof raw !== 'string') return 'signup_page'
  const m = /^coming-soon:([a-z0-9-]{1,32}):([a-z]{1,20})$/.exec(raw)
  if (m && isValidRegion(m[1]) && (ALL_CATEGORIES as readonly string[]).includes(m[2])) {
    return raw
  }
  const g = /^events-gate:([a-z0-9-]{1,32})$/.exec(raw)
  if (g && isValidRegion(g[1])) {
    return raw
  }
  return 'signup_page'
}

/**
 * Resolve the metro the signup is for (issue #428). Accepts a metro registry
 * id (`bay`, `seattle`, …) matching `items.region`, validated against the
 * *published* registry so an unlaunched metro's id can't be stored. Anything
 * else — absent, junk, an unpublished or unknown metro — coerces to NULL
 * rather than 400ing: same rule as `resolveSignupSource`, attribution must
 * never block a signup. A NULL city means "unattributed", distinct from any
 * particular metro.
 */
function resolveSignupCity(raw: unknown): string | null {
  return typeof raw === 'string' && isPublishedRegion(raw) ? raw : null
}

publicRouter.post('/api/signup', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { email?: unknown; source?: unknown; city?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!raw || raw.length > 255 || !EMAIL_RE.test(raw)) {
    return c.json({ error: 'valid email required' }, 400)
  }

  // Attribution (#359 deep-review fix). The coming-soon flow's whole value is
  // the {metro, category} pair riding on the signup — that pairing is the
  // demand signal that picks the next depth metro (plan §4B), and until this
  // was added it never left the browser. Strictly validated against the
  // registry + category union so the attribution column can't accumulate
  // junk, and an invalid tag silently falls back rather than rejecting: an
  // email capture must never fail over its own analytics.
  const source = resolveSignupSource(body.source)

  // City attribution (#428). The chosen metro rides on the signup so the
  // future per-metro newsletter can segment instead of one Bay-Area blast.
  // Validated against the published registry; invalid/absent coerces to NULL
  // (same never-block-a-signup rule as `source`).
  const city = resolveSignupCity(body.city)

  // ON CONFLICT DO NOTHING means duplicates leave `meta.changes === 0`.
  // We only fire the welcome email when changes === 1 (new row), so
  // re-submits don't trigger repeat sends.
  const result = await c.env.DB.prepare(
    'INSERT INTO waitlist_signups (email, source, city) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING'
  )
    .bind(raw, source, city)
    .run()

  if (result.meta?.changes === 1) {
    await sendWaitlistWelcome(c.env, raw)
  }

  // A fresh typed submission on an existing row is affirmative re-consent —
  // lift an unsubscribe tombstone so "sign up again" actually re-subscribes
  // (DO NOTHING above can't; no welcome re-send, changes stayed 0).
  await c.env.DB.prepare(
    'UPDATE waitlist_signups SET unsubscribed_at = NULL WHERE email = ? AND unsubscribed_at IS NOT NULL'
  ).bind(raw).run()

  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true })
})

// CORS for the unsubscribe endpoint — a write, so the exact prod/dev
// allowlist, never preview origins.
publicRouter.use('/api/unsubscribe', cors({ origin: writeCorsOrigin, credentials: false, maxAge: 600 }))

// Newsletter unsubscribe (#535). The `unsubscribed_at` column was reserved by
// migration 0009 for exactly this; until now the channel was "Reply STOP" in
// the welcome email, which doesn't scale past a handful and isn't a channel
// the digest footer can link. Stamps the tombstone rather than deleting the
// row: the audit trail is what proves we honoured the request, and a deleted
// row would be silently re-created by the next sign-in opt-in. Full erasure is
// the separate `/api/auth/delete-account` path.
//
// ALWAYS answers 200 {ok:true} on a well-formed address — subscribed,
// unknown, or already unsubscribed are indistinguishable to the caller. Same
// address-enumeration rule as `/api/signup`: a curl loop over guessed emails
// must not be able to read the list back out. Malformed input still 400s
// (that's a format verdict, not a membership one).
//
// Guard stack matches the other public writes — prod-origin, session-gated,
// per-IP rate-limited at the list budget (10/min) on its own key prefix.
// Nobody legitimately unsubscribes ten addresses a minute.
publicRouter.post('/api/unsubscribe', async (c) => {
  const blocked = originGuard(c)
  if (blocked) return blocked
  const unauth = await sessionGuard(c)
  if (unauth) return unauth

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.ITEMS_RATE_LIMITER.limit({ key: `unsubscribe:${ip}` })
  if (!success) {
    c.header('Cache-Control', 'no-store')
    c.header('Retry-After', '60')
    return c.json({ error: 'rate limit exceeded' }, 429)
  }

  let body: { email?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!raw || raw.length > 255 || !EMAIL_RE.test(raw)) {
    return c.json({ error: 'valid email required' }, 400)
  }

  // `AND unsubscribed_at IS NULL` keeps the FIRST unsubscribe timestamp — a
  // second click on a digest footer link months later must not rewrite when
  // consent was actually withdrawn.
  await c.env.DB.prepare(
    'UPDATE waitlist_signups SET unsubscribed_at = unixepoch() WHERE email = ? AND unsubscribed_at IS NULL'
  )
    .bind(raw)
    .run()

  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true })
})
