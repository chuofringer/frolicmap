import type { Item, Category } from '@shared/types'
import { DEFAULT_REGION } from '@shared/metros'
import {
  OSM_CATEGORIES,
  buildOverpassQueryForBbox,
  overpassElementToItem as toItem,
  parseOverpassResponse,
  splitBboxNS,
  bboxHeightDeg,
  TALL_BBOX_SPLIT_THRESHOLD_DEG,
  type OverpassElement,
} from '@shared/osm'
import type { Bbox } from '@shared/metros'
import { CONTENT_BBOX } from '../utils/bbox'

/**
 * Bay Area OSM ingester — the quarterly Worker cron.
 *
 * The Overpass query table and the element→Item mapping moved to
 * `shared/osm.ts` with #352 so the national bootstrap
 * (`worker/scripts/ingest-osm-national.mjs`) can reuse them from plain Node
 * instead of keeping a second copy. This module is now the Bay-Area-scoped
 * binding of that core: same exported signatures as before, same behavior.
 */

export type { OverpassElement }
export { CATEGORY_QUERY } from '@shared/osm'

export function buildOverpassQuery(category: Category): string {
  return buildOverpassQueryForBbox(category, CONTENT_BBOX)
}

/**
 * Bay Area element->Item mapping.
 *
 * `confidence: 'medium'` is the Tier C classification for raw single-source
 * OSM data (the national bootstrap emits the same value).
 */
export function overpassElementToItem(el: OverpassElement, category: Category): Item | null {
  return toItem(el, category, {
    region: DEFAULT_REGION,
    bbox: CONTENT_BBOX,
    confidence: 'medium',
    status: 'pending',
  })
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/**
 * Retry policy for HTTP 429/504 (loosely modeled on the national bootstrap's
 * `overpassRequest` in `scripts/ingest-osm-national.mjs`, which retries only
 * 429 and treats 504 as a split/cooldown signal at the bbox level).
 *
 * Wall-time bound: at most `OVERPASS_MAX_ATTEMPTS` (3) requests per call,
 * with at most 2 sleeps, each capped at `OVERPASS_MAX_DELAY_MS` (20s) even if
 * `Retry-After` asks for more -> <= 40s of sleeping per call (typically 5s +
 * 10s). A category can issue up to 3 calls (full bbox + two N/S halves), so
 * up to ~2 min per category — and runOsmIngest walks ~11 categories
 * sequentially, i.e. ~22 min of sleep alone, past the 15-min wall-clock
 * limit Cloudflare gives a cron invocation. So the per-call bound is not
 * enough on its own: runOsmIngest also hands every call a shared
 * `budget` (`OSM_RUN_BACKOFF_BUDGET_MS` for the whole run — once spent,
 * 429/504 fail fast) and stops starting new categories after
 * `OSM_RUN_DEADLINE_MS`, so `logRun` always gets to write its row.
 */
export const OVERPASS_MAX_ATTEMPTS = 3
export const OVERPASS_BASE_DELAY_MS = 5_000
export const OVERPASS_MAX_DELAY_MS = 20_000
/** Total backoff sleep allowed across one whole runOsmIngest. */
export const OSM_RUN_BACKOFF_BUDGET_MS = 120_000
/** No new category starts after this much wall time (cron limit is 15 min). */
export const OSM_RUN_DEADLINE_MS = 10 * 60_000

export interface OverpassDeps {
  /** Injectable for tests so backoff does not burn real time. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Shared, mutable remaining-backoff budget. When present, a retry whose
   * delay exceeds what is left is not attempted (the status is thrown as
   * `kind: 'http'`). Absent = per-call bound only.
   */
  budget?: { backoffMs: number }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Seconds form of Retry-After only (Overpass does not send HTTP dates). */
function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'))
  const ms = Number.isFinite(header) && header > 0
    ? header * 1000
    : OVERPASS_BASE_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(ms, OVERPASS_MAX_DELAY_MS)
}

/**
 * One Overpass POST with bounded backoff on 429/504. Unlike the pre-#253
 * version, this does NOT assume an HTTP-200 body is a complete result:
 * Overpass answers 200 with a `remark` field (and a partial or empty
 * `elements`) when a query ran out of time or memory mid-execution — see
 * `parseOverpassResponse` in `shared/osm.ts`.
 *
 * Failures carry `kind: 'http'` (non-OK / exhausted retries). Truncation is
 * tagged separately by `fetchOverpassBbox`.
 */
async function postOverpass(query: string, deps: OverpassDeps = {}) {
  const sleep = deps.sleep ?? realSleep
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Overpass asks clients to identify themselves so its operators can
        // reach out rather than silently blocking.
        'user-agent': 'frolicmap/osm-cron (+https://frolicmap.app)',
      },
    })
    const delay = retryDelayMs(res, attempt)
    if (
      (res.status === 429 || res.status === 504) &&
      attempt < OVERPASS_MAX_ATTEMPTS &&
      (!deps.budget || deps.budget.backoffMs >= delay)
    ) {
      if (deps.budget) deps.budget.backoffMs -= delay
      // Release the discarded response's connection before sleeping.
      await res.body?.cancel()
      console.warn(`[osm] Overpass ${res.status}; backing off ${delay}ms (attempt ${attempt}/${OVERPASS_MAX_ATTEMPTS})`)
      await sleep(delay)
      continue
    }
    if (!res.ok) {
      throw Object.assign(new Error(`Overpass ${res.status}`), { kind: 'http' as const })
    }
    return parseOverpassResponse(await res.json())
  }
}

function dedupeElements(elements: OverpassElement[]): OverpassElement[] {
  const seen = new Set<string>()
  const out: OverpassElement[] = []
  for (const el of elements) {
    const key = `${el.type}-${el.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(el)
  }
  return out
}

/**
 * Fetch one category over one bbox, retrying as an N/S split when Overpass
 * signals a truncated/partial response (#253 — "North Bay data coverage
 * gap"). The Bay Area content bbox is 1.71° tall (36.89–38.60), past
 * `TALL_BBOX_SPLIT_THRESHOLD_DEG`, and a truncated single-query run can drop
 * elements anywhere in the box with no guarantee the north edge (exactly
 * where Sonoma/Napa/Solano/Marin sit) survives.
 *
 * `allowSplit` is false on the recursive call so this only ever splits once
 * — a half that's STILL truncated after that is a genuinely oversized
 * category/bbox combination, not something worth quartering further inside
 * the quarterly Bay cron's execution budget (unlike the national bootstrap's
 * `quadrants` + cooldown dance in `ingest-osm-national.mjs`, which is worth
 * that complexity because it runs once per metro per quarter unattended).
 */
async function fetchOverpassBbox(
  category: Category,
  bbox: Bbox,
  allowSplit: boolean,
  deps: OverpassDeps = {},
): Promise<OverpassElement[]> {
  const query = buildOverpassQueryForBbox(category, bbox)
  const { elements, remark } = await postOverpass(query, deps)
  if (!remark) return elements

  console.error(
    `[osm] Overpass response truncated for category=${category} `
    + `bbox=${bboxHeightDeg(bbox).toFixed(2)}° tall: ${remark}`,
  )

  if (allowSplit && bboxHeightDeg(bbox) > TALL_BBOX_SPLIT_THRESHOLD_DEG) {
    console.error(`[osm] retrying ${category} as two N/S halves`)
    const [north, south] = splitBboxNS(bbox)
    // Sequential, not Promise.all: the query we just got a remark on may
    // well be Overpass's public instance under load rather than a
    // genuinely oversized query (the same ambiguity `ingest-osm-national.mjs`
    // documents for 504s). Firing both split halves at once would be two
    // concurrent requests against that same instance right after it signaled
    // trouble — the opposite of backing off, and against Overpass's usage
    // policy of not hammering with parallel requests. One at a time costs
    // an extra round-trip inside the quarterly cron's execution budget,
    // which is cheap.
    const northEls = await fetchOverpassBbox(category, north, false, deps)
    const southEls = await fetchOverpassBbox(category, south, false, deps)
    return dedupeElements([...northEls, ...southEls])
  }

  // No split available (bbox already halved, or too short to bother) — this
  // category's result set for this run cannot be trusted as complete.
  // Surface it as a failure (caught per-category in `runOsmIngest`, recorded
  // into `ingestion_log.errors`) rather than silently upserting a partial
  // slice: the next scheduled run retries the whole category, and upsert is
  // idempotent, so nothing is lost by declining the partial data now.
  throw Object.assign(
    new Error(`Overpass truncated (${category}): ${remark}`),
    { kind: 'truncated' as const },
  )
}

export async function fetchOverpass(
  category: Category,
  deps: OverpassDeps = {},
): Promise<OverpassElement[]> {
  return fetchOverpassBbox(category, CONTENT_BBOX, true, deps)
}

import { upsert, getById, hasNearbyFlaggedPark } from '../db/items'
import { logRun } from '../db/ingestionLog'

// Order: smallest categories first so the Worker's execution budget is spent
// on the missing ones before we re-upsert the already-populated categories.
// Keeps re-runs incrementally useful even if a single run times out.
//
// `waterplay` is filtered OUT (#435): OSM_CATEGORIES gained a waterplay leg
// for the national bootstrap, but Bay Area water play is a hand-curated seed
// (worker/scripts/seed-waterplay.sql). Letting the Bay cron fetch OSM splash
// pads would double-pin that curated layer and flood the admin queue with
// pending OSM rows the curator never asked for. The national splash-pad wave
// is deliberately Bay-excluded end to end.
const CATEGORIES_TO_INGEST: readonly Category[] = OSM_CATEGORIES.filter(
  (c) => c !== 'waterplay',
)

export async function runOsmIngest(
  db: D1Database,
  fetcher: (category: Category, deps?: OverpassDeps) => Promise<OverpassElement[]> = fetchOverpass,
  opts: { now?: () => number } = {},
): Promise<{
  fetched: number; inserted: number; updated: number; skippedOverlap: number;
}> {
  const now = opts.now ?? Date.now
  const startMs = now()
  const started = new Date().toISOString()
  let fetched = 0, inserted = 0, updated = 0, skippedOverlap = 0
  const errors: string[] = []
  // One backoff budget for the whole run (see OSM_RUN_BACKOFF_BUDGET_MS).
  const deps: OverpassDeps = { budget: { backoffMs: OSM_RUN_BACKOFF_BUDGET_MS } }

  for (const category of CATEGORIES_TO_INGEST) {
    // Stop starting categories near the cron wall-clock limit so logRun
    // below still records the run; a killed invocation logs nothing at all
    // (no dashboard row, no repeated-failure alert).
    if (now() - startMs > OSM_RUN_DEADLINE_MS) {
      errors.push(`${category}: [deadline] skipped — run exceeded ${OSM_RUN_DEADLINE_MS / 60_000} min`)
      continue
    }
    try {
      const elements = await fetcher(category, deps)
      fetched += elements.length
      for (const el of elements) {
        const item = overpassElementToItem(el, category)
        if (!item) continue
        const existing = await getById(db, item.id)
        if (existing && existing.status !== 'pending') item.status = existing.status

        // #217 ("Park + playground pins overlap on close zoom"): a brand-new
        // OSM playground node is frequently the exact on-site playground a
        // nearby park row already covers via #220's has_playground flag —
        // two pins for one amenity, indistinguishable at high zoom. Only
        // gates a NEW row (never `existing`): once a playground pin is
        // already in D1 — curator-reviewed or not — this never touches or
        // removes it, so this can't churn a row a curator already approved.
        // `park` runs before `playground` in CATEGORIES_TO_INGEST, so the
        // flagged park rows this checks against are already upserted for
        // this same run, not just a prior one.
        if (category === 'playground' && !existing && await hasNearbyFlaggedPark(db, item.lat, item.lng)) {
          skippedOverlap++
          continue
        }

        await upsert(db, item)
        if (existing) updated++
        else inserted++
      }
    } catch (err) {
      // Tag the failure class so ingestion_log.errors distinguishes a
      // truncated (oversized/partial) result from transport failures.
      const kind = err instanceof Error && 'kind' in err && typeof err.kind === 'string'
        ? err.kind
        : 'transport'
      errors.push(`${category}: [${kind}] ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await logRun(db, 'osm', {
    started,
    finished: new Date().toISOString(),
    fetched,
    inserted,
    updated,
    errors,
  })

  return { fetched, inserted, updated, skippedOverlap }
}
