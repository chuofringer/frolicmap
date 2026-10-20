// Lightweight client-side analytics shims.
//
// `trackGoal(name)` fires a custom event into the Cloudflare Web Analytics
// beacon queue (the optional beacon in index.html). CF's free tier does not
// expose a custom-events UI, so in practice these calls are cheap no-ops that
// activate the moment the analytics backend supports goals. Nothing is sent
// to our own servers: there is no first-party telemetry endpoint.

import { isLikelyBot } from '@/utils/bot'

declare global {
  interface Window {
    _cfBeam?: {
      event?: (payload: { eventName: string }) => void
    }
  }
}

export type GoalName =
  | 'metro_view'
  | 'session_start'
  | 'filter_chip'
  | 'popup_open'
  | 'view_toggle'
  | 'near_me'
  | 'share'
  | 'lang_switch'
  | 'outbound_click'

/**
 * Fire the per-city visit signal, `metro_view`, once per (session, metro).
 * Guarded by a sessionStorage key so filter/pan/re-render churn logs a single
 * visit per metro per tab session, and by `isLikelyBot()` so crawlers don't
 * inflate the count.
 */
export function trackMetroView(region: string): void {
  if (isLikelyBot()) return
  const key = `frolicmap:metro-viewed:${region}`
  try {
    if (sessionStorage.getItem(key)) return // already logged this session
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage blocked (private mode): can't dedupe, fire anyway.
  }
  trackGoal('metro_view')
}

/**
 * Fire `session_start` once per browser session (tab), site-wide.
 * sessionStorage-deduped and bot-guarded, mirroring `trackMetroView`.
 */
export function trackSessionStart(): void {
  if (isLikelyBot()) return
  const key = 'frolicmap:session-started'
  try {
    if (sessionStorage.getItem(key)) return // already logged this session
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage blocked (private mode): can't dedupe, fire anyway.
  }
  trackGoal('session_start')
}

/** Fire a goal into the CF Web Analytics beacon. Never throws. */
export function trackGoal(name: GoalName): void {
  try {
    window._cfBeam?.event?.({ eventName: name })
  } catch {
    // Never let an analytics failure propagate to user actions.
  }
}
