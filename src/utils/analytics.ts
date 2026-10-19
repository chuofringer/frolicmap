// Lightweight client-side analytics shims.
//
// `trackGoal(name)` fires a custom event into the CF Web Analytics beacon
// queue. CF free tier doesn't expose a custom-events UI as of 2026-04-30,
// so these calls are usually no-ops in production — kept as cheap dead
// instrumentation that activates the moment we either upgrade the
// analytics backend (issue #232) or CF ships goals on free tier.
//
// `trackOutboundClick(itemId, destUrl)` posts to our own first-party
// telemetry endpoint backed by D1 — independent of CF. Foundation for
// the Phase 2 "we drove X clicks to your venue last month" sales pitch.

import { API_BASE } from '@/config/constants'
import { getSessionToken, useSessionStore } from '@/stores/useSessionStore'
import { useEngagementStore } from '@/stores/useEngagementStore'
import { isLikelyBot } from '@/utils/bot'
import type { UiEventGoal } from '@shared/uiEventGoals'

declare global {
  interface Window {
    _cfBeam?: {
      event?: (payload: { eventName: string }) => void
    }
  }
}

// The persistable goals live in `shared/uiEventGoals.ts` (one source of truth
// with the worker's /api/ui-event allowlist — per-goal docs there).
// `outbound_click` (Directions / Website / Source links in the detail
// panel/sheet) widens the union here only: it is a valid CF-beacon goal but is
// persisted via its own `outbound_clicks` table, never `/api/ui-event`.
export type GoalName = UiEventGoal | 'outbound_click'

// The metro (region id) attached to every subsequent `trackGoal` beacon. A
// module-level value rather than a call-site argument so the many existing
// `trackGoal` sites (CategoryChips, FunMap, IconBar, …) don't each have to
// thread the current metro through — it's ambient app state, set once where
// the metro is established (see `setAnalyticsRegion`, called from the map).
// `null` = off-metro (e.g. /signup) — the beacon then carries no `region`.
let currentRegion: string | null = null

/**
 * Set the metro attached to every subsequent `trackGoal` beacon. Called from
 * the metro-map effect (FunMap): the metro id while the map is mounted
 * (`bay` on `/`, a metro id on `/cities/{metro}`), `null` on unmount so
 * off-metro pages don't inherit a stale region. `region` is a
 * shared/metros.ts registry id, never PII — the no-tracking posture holds.
 */
export function setAnalyticsRegion(region: string | null): void {
  currentRegion = region
}

/**
 * Fire the per-city visit signal — `metro_view`, once per (session, metro).
 *
 * Guarded by a sessionStorage key (`funradar:metro-viewed:<id>`) so the map's
 * filter/pan/re-render churn logs a single visit per metro per tab session,
 * and by `isLikelyBot()` so crawlers don't inflate the count (matching the
 * other onboarding-affordance guards). The metro id rides on the beacon's
 * `region` field via `setAnalyticsRegion`, so this carries no `context`.
 *
 * This fires on map MOUNT — before `useSession()` has minted a token on a
 * cold load — so delivery depends entirely on the pre-session buffer in
 * `postTelemetry` below. (Dropping token-less events here is what zeroed the
 * city-visit counts on the behavior dashboard: the dedupe key was already
 * set, so the lost event never retried for the rest of the session.)
 */
export function trackMetroView(region: string): void {
  if (isLikelyBot()) return
  const key = `funradar:metro-viewed:${region}`
  try {
    if (sessionStorage.getItem(key)) return // already logged this session
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage blocked (private mode) — can't dedupe, fire anyway.
  }
  trackGoal('metro_view')
}

/**
 * Fire the per-session denominator — `session_start`, once per browser
 * session (tab), site-wide.
 *
 * The sessions baseline for /admin/behavior funnel rates: gate goals like
 * `welcome_gate_view` had impressions (606 in the first window) but nothing
 * to divide by. Mirrors `trackMetroView`'s guards — a sessionStorage key
 * (`funradar:session-started`) dedupes across re-mounts/metro switches
 * within the tab session, `isLikelyBot()` keeps crawlers out of the
 * denominator. Fired from the map app root (App), so it covers map/list/
 * calendar views in every metro and never fires on /admin or /signup.
 *
 * Like `metro_view`, this fires on mount before `useSession()` has minted a
 * token on a cold load — delivery relies on the pre-session buffer in
 * `postTelemetry` below.
 */
export function trackSessionStart(): void {
  if (isLikelyBot()) return
  const key = 'funradar:session-started'
  try {
    if (sessionStorage.getItem(key)) return // already logged this session
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage blocked (private mode) — can't dedupe, fire anyway.
  }
  trackGoal('session_start')
}

/**
 * Fire `rec_view` — a "Top picks" surface rendered with at
 * least one pick — once per browser session (sessionStorage-deduped) and
 * bot-guarded, mirroring `trackMetroView`/`trackSessionStart`. Callers
 * check the "has >=1 pick" condition themselves; this only owns the
 * once-per-session dedupe so a filter change or metro switch that keeps
 * re-rendering a non-empty rail doesn't reinflate the count.
 */
export function trackRecView(): void {
  if (isLikelyBot()) return
  const key = 'funradar:rec-view-fired'
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage blocked (private mode) — can't dedupe, fire anyway.
  }
  trackGoal('rec_view')
}

export function trackGoal(name: GoalName, context?: string): void {
  // Bump engagement counters used to arm the waitlist slide-in (#244)
  // and the popup signup CTA (#251). `popup_open` passes the item id context
  // to count distinct popups opened this session.
  if (name === 'popup_open') useEngagementStore.getState().bumpPopupOpen(context)
  else if (name === 'filter_chip') useEngagementStore.getState().bumpFilterToggle()
  // Event-intent signals for the sign-in nudge (#642): the Event chip and the
  // calendar view-toggle both flow through here with a stable context value.
  // Event pin/card taps can't be detected from `popup_open` alone (context is
  // just the item id), so those sites call `bumpEventIntent` themselves.
  if ((name === 'filter_chip' && context === 'event') || (name === 'view_toggle' && context === 'calendar'))
    useEngagementStore.getState().bumpEventIntent()
  try {
    window._cfBeam?.event?.({ eventName: name })
  } catch {
    // Never let analytics fail propagate to user actions.
  }
  // Also persist the goal to D1 via `/api/ui-event` (#481) so behavior is
  // queryable — CF Web Analytics goals are unqueryable on the free tier.
  // `outbound_click` is EXCLUDED: it has its own `outbound_clicks` table
  // (populated by `trackOutboundClick`), so posting it here would double-report.
  // The `!==` narrows GoalName to UiEventGoal, so the exclusion is
  // compiler-enforced, not convention-enforced.
  if (name !== 'outbound_click') postUiEvent(name, context)
}

// --- pre-session telemetry buffer -------------------------------------------
// Both telemetry endpoints are session-gated, but events can fire BEFORE the
// session token mints: `metro_view` fires synchronously on map mount while the
// `POST /api/session` mint is still in flight (~100–200ms), and a `?item=`
// deep link can open a popup just as fast. Dropping those events silently
// undercounts — city visits in particular were near-zero because the
// once-per-session visit signal always lost this race. Instead, buffer them
// (payload captured at fire time, so `region` reflects the metro that was
// actually on screen) and flush the moment the store gets a token. Bounded so
// a session that never mints (worker 503, offline) can't grow memory.
const PENDING_MAX = 32
let pendingTelemetry: Array<{ path: string; body: Record<string, unknown> }> = []

// Permanent module-level subscription: whenever a token becomes available and
// events are waiting, flush them. Refresh mints with an empty buffer no-op.
useSessionStore.subscribe((state) => {
  if (!state.token || pendingTelemetry.length === 0) return
  const batch = pendingTelemetry
  pendingTelemetry = []
  for (const e of batch) sendTelemetry(state.token, e.path, e.body)
})

/** Test-only: drop any buffered pre-session events. */
export function __clearPendingTelemetryForTest(): void {
  pendingTelemetry = []
}

/**
 * Fire-and-forget session-gated telemetry POST. A `fetch` with the session
 * token in an `Authorization` header (sendBeacon can't set headers, so the
 * endpoints are session-gated over `fetch`) and `keepalive: true` so the
 * request survives a same-tab navigation. Never throws or blocks the UI —
 * network failures are expected and swallowed.
 */
function sendTelemetry(token: string, path: string, body: Record<string, unknown>): void {
  void fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Network failures are expected (offline, blocked, slow), not actionable here.
  })
}

/** Send now if the session token exists, otherwise buffer until it mints. */
function postTelemetry(path: string, body: Record<string, unknown>): void {
  const token = getSessionToken()
  if (!token) {
    if (pendingTelemetry.length < PENDING_MAX) pendingTelemetry.push({ path, body })
    return
  }
  sendTelemetry(token, path, body)
}

/**
 * UI-event telemetry to D1 via `/api/ui-event` (#481).
 *
 * Attaches the current metro (`region`) so the worker can segment every goal
 * by city. Omitted when off-metro (`currentRegion === null`) — the worker
 * then stores NULL ("unattributed"). The worker re-validates the id against
 * the registry, so a stale/garbage value can't reach the column.
 */
function postUiEvent(goal: UiEventGoal, context?: string): void {
  const payload: { goal: UiEventGoal; context?: string; region?: string } = { goal }
  if (context != null) payload.context = context
  if (currentRegion != null) payload.region = currentRegion
  postTelemetry('/api/ui-event', payload)
}

/**
 * Fire-and-forget outbound-click telemetry to D1 via `/api/outbound-click`.
 *
 * - `keepalive: true` (via `postTelemetry`) so the request survives the user
 *   navigating away to the outbound destination.
 * - Errors are swallowed — analytics never blocks user actions; a click that
 *   lands before the session token mints is buffered and flushed on mint.
 * - `destUrl` is parsed client-side to extract the host; if parsing fails
 *   we silently skip rather than send a malformed payload to the worker.
 */
export function trackOutboundClick(itemId: string, destUrl: string): void {
  let destHost: string
  try {
    destHost = new URL(destUrl).host
  } catch {
    return // unparseable href, nothing useful to log
  }
  postTelemetry('/api/outbound-click', { itemId, destHost })
}
