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

// Admin endpoints (`/api/admin/*`) are pinned to `api.frolicmap.app`
// because CF Access only intercepts that subdomain — not the apex
// same-origin path added in #194. Same-origin admin calls land at
// the worker without a `Cf-Access-Jwt-Assertion` header injected,
// so the worker's `cfAccess` middleware 401s. To unify on same-origin
// later, add `frolicmap.app/api/admin/*` to the CF Access Application's
// destinations and switch this back to `API_BASE`.
export const ADMIN_API_BASE = 'https://api.frolicmap.app'
