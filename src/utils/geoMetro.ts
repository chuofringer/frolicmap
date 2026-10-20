import { metroForCoords, type Metro } from '@shared/metros'

/**
 * What the metro picker's "Use my location" button should do once the browser
 * hands back a coordinate. Kept as a pure function (no React, no `window`) so
 * it's testable independent of the picker's rendering (see #386, the issue
 * that shipped the multi-metro picker this resolves geolocation for).
 */
export type GeoAction =
  | { kind: 'navigate'; href: string }
  | { kind: 'here' }
  | { kind: 'fallback' }

/**
 * Resolve a coordinate against the metro registry, relative to the metro
 * currently on screen.
 *
 * - Inside a *published* metro that isn't the current one → navigate to its
 *   `/cities/{slug}` page. The caller does this in-app with react-router's
 *   `navigate`, so the running SPA is never reloaded and the prerendered
 *   crawler fallback in that page's `#root` is never shown.
 * - Inside the current metro → nothing to navigate to; the caller just closes.
 * - Anywhere else — inside an *unpublished* metro (its data is API-gated #371
 *   and must not leak here) or outside every bbox — → the Bay Area fallback.
 *
 * `metroForCoords` matches the first metro by registry (population) order, so
 * an unpublished metro still claims its own coordinates and correctly routes to
 * the fallback rather than to a neighbouring published metro.
 */
export function resolveGeoAction(current: Metro, lat: number, lng: number): GeoAction {
  const metro = metroForCoords(lat, lng)
  if (!metro || !metro.published) return { kind: 'fallback' }
  if (metro.id === current.id) return { kind: 'here' }
  return { kind: 'navigate', href: `/cities/${metro.slug}` }
}
