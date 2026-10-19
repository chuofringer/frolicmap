import type { Item, ItemStatus, Submission, SubmissionStatus } from '@shared/types'
import type { SignupKind } from '@shared/signupSource'
import { ADMIN_API_BASE } from '@/config/constants'

/** Admin submissions-queue row: a member's submission plus their email
 *  (server LEFT JOINs `users` — a deleted account still shows the row). */
export interface AdminSubmission extends Submission {
  user_email: string | null
}

/** One waitlist row plus its server-computed provenance. */
export interface WaitlistSignup {
  id: number
  email: string
  source: string
  city: string | null
  unsubscribed_at: number | null
  created_at: number
  // Optional only because the SPA and the worker deploy separately: a worker
  // predating the split sends rows without it, and the admin view falls back
  // to classifying `source` itself.
  kind?: SignupKind
}

/** Per-kind count block (whole table, never narrowed by the `kind` filter). */
export interface WaitlistCounts {
  total: number
  active: number
  unsubscribed: number
}

export interface WaitlistResponse extends WaitlistCounts {
  newsletter: WaitlistCounts
  googleSignin: WaitlistCounts
  /** Echo of the active row filter (null = both kinds listed). */
  kind: SignupKind | null
  signups: WaitlistSignup[]
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...init,
    // CF Access cookies live on api.funradar.app; admin SPA is served from
    // funradar.app. `credentials: 'include'` lets the browser ride those
    // cookies cross-origin. Worker-side CORS at `/api/admin/*` pairs with this.
    // Pinned to ADMIN_API_BASE (api.funradar.app) instead of API_BASE because
    // CF Access only intercepts the subdomain — see constants.ts comment.
    credentials: 'include',
    headers: { ...(init?.headers ?? {}), 'x-dev-admin': 'yes' },
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

export interface AdminListOptions {
  region?: string
  sourceType?: string
  limit?: number
  offset?: number
}

export interface AdminFacets {
  regions: { value: string; n: number }[]
  sourceTypes: { value: string; n: number }[]
}

export interface AdminListResponse {
  items: Item[]
  total: number
  limit: number
  offset: number
  facets: AdminFacets
}

export interface BehaviorCount {
  count: number
}
export interface GoalCount extends BehaviorCount {
  goal: string
}
export interface DailyGoalCount extends BehaviorCount {
  day: string
  goal: string
}
export interface DailyCount extends BehaviorCount {
  day: string
}
export interface ContextCount extends BehaviorCount {
  context: string
}
export interface HostCount extends BehaviorCount {
  host: string
}
export interface ItemCount extends BehaviorCount {
  id: string
  name: string | null
  category: string | null
  // Metro (region id) of the item, or null when the id no longer resolves /
  // predates region attribution. Frontend labels it via getMetro; null → '—'.
  region: string | null
}
// Per-city (metro) aggregates. `region` is a metros.ts id, or null for
// historical / off-metro / removed-item rows (rendered "unattributed").
export interface RegionCount extends BehaviorCount {
  region: string | null
}
export interface DailyRegionCount extends BehaviorCount {
  day: string
  region: string | null
}
export interface RegionGoalCount extends BehaviorCount {
  region: string | null
  goal: string
}

export interface BehaviorResponse {
  days: number
  // Echo of the active drill-down region (null = all cities).
  region: string | null
  // The analytics epoch (UTC day, 2026-08-10): the dashboard reports nothing
  // older than this in ANY section, even where the underlying table keeps its
  // full history. Optional — a Pages deploy can land before the worker one,
  // and an older worker omits the field.
  epoch?: string
  // When each stream began collecting — MIN over the whole table (never
  // window- or region-scoped) but floored at `epoch`: the streams went live
  // months apart, so a 30/90-day window silently under-reports any stream
  // younger than itself and the dashboard flags those. UTC day strings;
  // null = no rows at or after the epoch yet.
  since: {
    uiEvents: string | null // first ui_events row (any goal)
    sessions: string | null // first session_start (the funnel denominator)
    outbound: string | null // first outbound_clicks row
    waitlist: string | null // first waitlist_signups row
    accounts: string | null // first users row
  }
  uiEvents: {
    total: number
    // Count of `session_start` in the window (the per-session funnel
    // denominator, 2026-08-09). Region-scoped with the rest of this section.
    // Excluded from `total`/`byGoal` (not a tap); 0 on windows predating the
    // goal's deploy — render rates as "—" then.
    sessions: number
    byGoal: GoalCount[]
    daily: DailyGoalCount[]
    topContexts: {
      filter_chip: ContextCount[]
      coming_soon_tap: ContextCount[]
    }
    topItems: ItemCount[]
  }
  outbound: {
    total: number
    daily: DailyCount[]
    topHosts: HostCount[]
    topItems: ItemCount[]
  }
  // Waitlist rows split by provenance (2026-08-08): `newsletter` = someone
  // typed their email into a form; `googleSignin` = the demand-signal row the
  // events gate writes when a visitor signs in with Google (nobody typed it).
  // `total` is both combined — kept so the raw table count stays available.
  waitlist: {
    total: number
    newsletter: { total: number; daily: DailyCount[] }
    googleSignin: { total: number; daily: DailyCount[] }
  }
  // Sign-in gate funnel (2026-07-26 events-gate experiment). `funnel` follows
  // the drill-down region; `byRegion` is always all-cities (its own bounded
  // query — the shared byRegion.ui panel's LIMIT could drop low-count gate
  // rows in a busy week); `accounts` counts `users` rows and is site-wide
  // (accounts carry no region), zeros if migration 0022 isn't applied yet.
  // `returners` (2026-08-09 retention signal) = accounts that signed in at
  // least twice (`last_login_at > created_at`), site-wide + all-time like
  // `total`.
  signin: {
    funnel: GoalCount[]
    byRegion: RegionGoalCount[]
    accounts: { total: number; window: number; returners: number }
  }
  // Cross-city overview (always all cities, independent of the drill-down).
  byRegion: {
    visits: RegionCount[]
    visitsDaily: DailyRegionCount[]
    ui: RegionGoalCount[]
    outbound: RegionCount[]
    // Waitlist signups (newsletter + Google-sign-in combined) by the metro
    // the visitor was on (#361) — sits next to visits/taps/outbound so a
    // curator can see which metros convert, not just which ones get traffic.
    waitlist: RegionCount[]
  }
}

/** One count row: a raw DB value (status / category / source_type) + count. */
export interface ValueCount {
  count: number
}
export interface StatusCount extends ValueCount {
  status: string
}
export interface CategoryCount extends ValueCount {
  category: string
}
export interface SourceTypeCount extends ValueCount {
  source_type: string
}

export interface CronHealth {
  source_id: string
  schedule: string
  cadence: string
  last_run_at: string | null
  last_inserted: number | null
  last_updated: number | null
  last_errors: string[] | null
  days_since: number | null
  status: 'healthy' | 'late' | 'failed' | 'unknown'
}

// The operator "is everything OK" snapshot (issue #243). Current-snapshot
// only — no time series, that's /admin/behavior's job.
export interface StatsResponse {
  items: {
    byStatus: StatusCount[]
    byCategory: CategoryCount[]
    bySourceType: SourceTypeCount[]
  }
  // Same per-source health card as `observability().crons` — reused here so
  // the Stats page's "which sources are stale" answer never drifts from the
  // Ingestion tab's.
  ingestion: { crons: CronHealth[] }
  reports: { active: number; resolved: number }
  // Active NEWSLETTER subscribers only (Google-sign-in rows aren't
  // subscribers — same convention as WaitlistView's Phase 1 gate tile).
  waitlist: { active: number }
  outbound: {
    total_last_30d: number
    top_hosts: { host: string; count: number }[]
  }
}

export const adminApi = {
  // Filtered + paginated (#368). `total` is the count behind the filter, not
  // the page size, so the UI can say "1–100 of 3,412" — the number that tells
  // a curator whether a national import just landed in their queue.
  listItems: (status: ItemStatus, opts: AdminListOptions = {}) => {
    const p = new URLSearchParams({ status })
    if (opts.region) p.set('region', opts.region)
    if (opts.sourceType) p.set('source_type', opts.sourceType)
    if (opts.limit != null) p.set('limit', String(opts.limit))
    if (opts.offset) p.set('offset', String(opts.offset))
    return http<AdminListResponse>(`/api/admin/items?${p}`)
  },
  getItem: (id: string) => http<{ item: Item }>(`/api/admin/items/${id}`),
  approve: (id: string) =>
    http<{ ok: boolean }>(`/api/admin/items/${id}/approve`, { method: 'POST' }),
  // One-shot approve of every pending row behind the current queue filter
  // (server-side UPDATE). Returns how many rows flipped.
  approveAll: (opts: { region?: string; sourceType?: string } = {}) =>
    http<{
      ok: boolean
      approved: number
      // Quality gate (#679): sources left pending because their latest sample
      // accuracy is below the bar, and sources approved with no sample on file.
      held?: { source_type: string; pending: number; accuracy: number; tier: string }[]
      unsampled?: { source_type: string; pending: number }[]
    }>('/api/admin/items/approve-all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region: opts.region, source_type: opts.sourceType }),
    }),
  reject: (id: string) =>
    http<{ ok: boolean }>(`/api/admin/items/${id}/reject`, { method: 'POST' }),
  edit: (id: string, patch: Partial<Item>) =>
    http<{ item: Item }>(`/api/admin/items/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  listReports: (resolved: boolean) =>
    http<{ reports: { id: number; item_id: string; reason: string; note: string | null; created_at: string }[] }>(
      `/api/admin/reports?resolved=${resolved ? 1 : 0}`
    ),
  resolveReport: (id: number) =>
    http<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, { method: 'POST' }),
  ingestionLog: () =>
    http<{ log: { id: number; source_id: string; started_at: string; finished_at: string; fetched: number; inserted: number; updated: number; errors: string | null }[] }>(
      '/api/admin/ingestion-log'
    ),
  runCron: (source: 'structured-feeds' | 'osm' | 'archive-expired') =>
    http<{
      source: string
      fetched?: number
      inserted?: number
      updated?: number
      errors?: string[]
      error?: string
    }>(`/api/admin/run/${source}`, { method: 'POST' }),
  // `kind` filters the returned rows to one provenance (newsletter opt-ins vs
  // rows written by a Google sign-in); the count blocks always carry both.
  listWaitlist: (limit = 100, kind?: SignupKind) => {
    const p = new URLSearchParams({ limit: String(limit) })
    if (kind) p.set('kind', kind)
    return http<WaitlistResponse>(`/api/admin/waitlist?${p}`)
  },
  observability: () =>
    http<{
      crons: {
        source_id: string
        schedule: string
        cadence: string
        last_run_at: string | null
        last_inserted: number | null
        last_updated: number | null
        last_errors: string[] | null
        days_since: number | null
        status: 'healthy' | 'late' | 'failed' | 'unknown'
      }[]
      outbound_clicks: {
        total_last_30d: number
        top_hosts: { host: string; count: number }[]
      }
    }>('/api/admin/observability'),
  // Behavior dashboard (#243). `days` is clamped server-side to 1..90.
  // `region` (optional metro id) scopes the uiEvents/outbound/waitlist
  // sections to one city — the by-region overview stays all-cities.
  behavior: (days = 7, region?: string) => {
    const p = new URLSearchParams({ days: String(days) })
    if (region) p.set('region', region)
    return http<BehaviorResponse>(`/api/admin/behavior?${p}`)
  },
  // Admin Stats dashboard (#243) — one round-trip snapshot.
  getStats: () => http<StatsResponse>('/api/admin/stats'),
  // User submissions moderation queue (#226).
  listSubmissions: (status: SubmissionStatus = 'pending', page: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams({ status })
    if (page.limit != null) qs.set('limit', String(page.limit))
    if (page.offset != null) qs.set('offset', String(page.offset))
    return http<{ submissions: AdminSubmission[]; total: number; limit: number; offset: number }>(
      `/api/admin/submissions?${qs}`,
    )
  },
  approveSubmission: (id: string) =>
    http<{ ok: boolean; item_id: string }>(`/api/admin/submissions/${id}/approve`, { method: 'POST' }),
  rejectSubmission: (id: string, reviewerNote?: string) =>
    http<{ ok: boolean }>(`/api/admin/submissions/${id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewer_note: reviewerNote }),
    }),
}
