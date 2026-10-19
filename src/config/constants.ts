import { DEFAULT_REGION, getMetro } from '@shared/metros'

// The Bay Area's geometry used to be hand-copied here and in
// `worker/src/utils/bbox.ts`. Both collapsed into `shared/metros.ts` with
// #351 — the registry is now the only place these numbers exist, so a metro
// edit can't silently desync the SPA from what the ingesters accept.
//
// This export keeps its pre-national name and shape because per-metro views
// (#358) still read it directly; the map's viewport bounds and initial view
// now come from `useMetro()` instead (their old Bay-pinned aliases here were
// dead code, removed in #426).
const BAY_AREA = getMetro(DEFAULT_REGION)
if (!BAY_AREA) throw new Error(`metro registry is missing the default region '${DEFAULT_REGION}'`)

export const CONTENT_BBOX = BAY_AREA.contentBbox

export const MIN_ZOOM = 8
export const MAX_ZOOM = 18

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

// Events sign-in gate (interest-gauge experiment, time-boxed — see
// docs/specs/2026-07-26-signin-gated-events-plan.md). Kill switch: flipping
// this to false reverts to fully open event details in one line + redeploy.
// (Flip the worker's EVENTS_REQUIRE_MEMBER var together with it.)
export const EVENTS_GATE_ENABLED = true

// WelcomeGate first-visit auto-show (#548). Dashboard read (7d ending
// 2026-08-14): welcome_gate_view→unlock converts 2.6% (189→5) vs. the
// per-event intent gate's 30% (10→3) — the first-visit interstitial pays
// first-impression attention cost without capturing accounts. Disabling this
// stops the once-per-device auto-show; the once-per-device bookkeeping
// (`markWelcomeGateSeen`/`welcomeGateSeen`) and the on-demand reopen path
// (`useGateRequestStore` — sign-in nudge, /signup redirect) are untouched, so
// flipping this back to true is the entire revert. See the decision-criteria
// addendum in docs/specs/2026-07-26-signin-gated-events-plan.md.
//
// REVERTED to true 2026-10-17 (#548 readout, PR #705 →
// docs/analytics/2026-10-gate-readout.md): under the decisive pre-registered
// rule, accounts/week fell from 20.5 (first-visit gate on) to 7.5 (intent-only),
// so the first-visit auto-show comes back. Intent gates are unchanged.
export const WELCOME_GATE_FIRST_VISIT_ENABLED = true

// Admin endpoints (`/api/admin/*`) are pinned to `api.frolicmap.app`
// because CF Access only intercepts that subdomain — not the apex
// same-origin path added in #194. Same-origin admin calls land at
// the worker without a `Cf-Access-Jwt-Assertion` header injected,
// so the worker's `cfAccess` middleware 401s. To unify on same-origin
// later, add `frolicmap.app/api/admin/*` to the CF Access Application's
// destinations and switch this back to `API_BASE`.
export const ADMIN_API_BASE = 'https://api.frolicmap.app'
