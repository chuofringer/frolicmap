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
