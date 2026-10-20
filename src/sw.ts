/// <reference lib="webworker" />
/**
 * Service worker — issue #521. `vite-plugin-pwa`'s `injectManifest` strategy
 * bundles this file with Rollup/Workbox and injects the precache manifest at
 * `self.__WB_MANIFEST` (see `vite.config.ts`).
 *
 * Routing decisions live in `src/pwa/cachingStrategy.ts` (unit-tested there,
 * with no Workbox/self dependency) — this file only wires each
 * `CacheDecision` to a Workbox strategy. Keep new caching rules in that
 * module, not here, so they stay testable.
 */
import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { decideCachingStrategy } from './pwa/cachingStrategy'

declare const self: ServiceWorkerGlobalScope

// Constraint 4 (issue #521): with CI direct-upload deploys, an old client
// must not keep running an old shell against a new API for longer than
// necessary. `skipWaiting` + `clientsClaim` narrow that window; they don't
// close it (a request already in flight when the new worker activates still
// finishes on the old one) — the dynamic-import reload handler registered in
// `src/pwa/registerServiceWorker.ts` covers what's left.
self.skipWaiting()
clientsClaim()

// The manifest vite-plugin-pwa injects here already excludes the MapLibre
// chunk (see `injectManifest.globIgnores` in `vite.config.ts`); MapLibre gets
// its own cache-first route below.
precacheAndRoute(self.__WB_MANIFEST)

const NAV_CACHE = 'frolicmap-app-shell'
const MAPLIBRE_CACHE = 'frolicmap-maplibre-chunk'
const BASEMAP_CACHE = 'frolicmap-basemap-cdn'

// Rule 2 — network-first navigations, EXCLUDING /cities*
// (`decideCachingStrategy` returns 'network-only' for those; returning false
// here means "don't intercept," so the browser's normal request continues to
// Pages' static-file-wins resolution untouched).
registerRoute(
  ({ url, request }) => {
    if (request.mode !== 'navigate') return false
    return decideCachingStrategy({ url, isNavigation: true, sameOrigin: url.origin === self.location.origin }) === 'navigate-shell'
  },
  new NetworkFirst({
    cacheName: NAV_CACHE,
    networkTimeoutSeconds: 3,
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  }),
)

// Rule 1 — explicit, defense-in-depth NetworkOnly for /api/*. Unmatched
// requests already bypass the SW entirely, so this isn't load-bearing for
// correctness today, but it makes the "never cache /api" rule an assertion
// Workbox enforces rather than an absence someone could accidentally close
// over with a broader route later.
registerRoute(
  ({ url }) => decideCachingStrategy({ url, isNavigation: false, sameOrigin: url.origin === self.location.origin }) === 'network-only',
  new NetworkOnly(),
)

// Rule 4 — the MapLibre GL chunk. Content-hashed filename means cache-first
// is always safe: a new build ships a new URL, never a stale hit.
registerRoute(
  ({ url }) =>
    decideCachingStrategy({ url, isNavigation: false, sameOrigin: url.origin === self.location.origin }) ===
    'cache-first-maplibre',
  new CacheFirst({
    cacheName: MAPLIBRE_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
)

// Rule 5 — third-party basemap style/tile/glyph/sprite hosts. Public,
// unauthenticated, slow-changing; opportunistic cache-first with a bounded
// entry count (tiles are numerous) and a cap that trades staleness for
// "still renders something on a flaky connection."
registerRoute(
  ({ url }) =>
    decideCachingStrategy({ url, isNavigation: false, sameOrigin: url.origin === self.location.origin }) ===
    'cache-first-basemap-cdn',
  new CacheFirst({
    cacheName: BASEMAP_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
)
