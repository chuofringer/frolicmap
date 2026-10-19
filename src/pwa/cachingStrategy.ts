/**
 * PWA service worker caching policy — issue #521.
 *
 * Pure so it can be unit-tested without a service worker/Workbox runtime.
 * `sw.ts` imports this directly and wires each `CacheDecision` to a Workbox
 * strategy; nothing here should import `workbox-*` or touch `self`.
 *
 * The policy, in order of what would break if it were wrong:
 *
 * 1. `/api/*` is NEVER cached. Sessions are 5-minute HMAC tokens
 *    (`src/api/session.ts`) and data responses are `Cache-Control: private` —
 *    a cached `/api/session` or a stale authorized response is a security bug,
 *    not a UX bug. `/api/tiles/*` additionally carries a per-request
 *    `Authorization` header (`src/components/Map/FunMap.tsx`); caching it
 *    keyed without that header would serve one visitor's gated tiles to
 *    another. Out of scope for v1 — network-only, full stop.
 *
 * 2. Navigations are network-first, EXCEPT the generated static surface.
 *    Since #387 (`worker/scripts/build-seo-pages.mjs:16-22`) that surface is
 *    exactly `/cities` and `/cities/{slug}` — prerendered HTML that Pages
 *    resolves as "static file wins, SPA shell is the fallback"
 *    (`CLAUDE.md`, plan §3.2). A cached app-shell response racing that
 *    resolution would serve the SPA shell instead of the prerendered page,
 *    which is the same failure mode the "never add 404.html" rule exists to
 *    prevent. So those paths are excluded from the SW's navigation handling
 *    entirely — the browser goes straight to the network and Pages'
 *    static-vs-fallback routing runs untouched.
 *
 * 3. The MapLibre GL chunk (`assets/maplibre-gl-*.js`, ~1MB) is cache-first
 *    and NOT precached — precaching 1MB on first paint is the thing to
 *    avoid. Its filename is content-hashed by Vite, so cache-first is safe:
 *    a new build ships a new URL, never a stale hit.
 *
 * 4. Third-party basemap tiles/styles/glyphs/sprites (CARTO, OpenFreeMap,
 *    Esri — see `src/config/mapStyle.ts`) are cache-first, opportunistic.
 *    They're public, unauthenticated, and slow-changing; a cache miss just
 *    falls through to the network, so this is purely a win for the "on cell
 *    data in a park" case the issue is about.
 *
 * Anything else (same-origin, non-navigation, not the MapLibre chunk) is
 * left to the precache manifest or the network — this module doesn't need
 * an opinion on it.
 */

export type CacheDecision =
  | 'network-only'
  | 'navigate-shell'
  | 'cache-first-maplibre'
  | 'cache-first-basemap-cdn'
  | 'unhandled'

/** Paths (locale-prefix aware) whose navigations must always hit the network. */
const NAVIGATION_DENYLIST = ['/cities']

/**
 * Only `en` (root) and `zh` (`/zh/...`) are real prefixes (`src/i18n/locale.ts`
 * — `localeFromPath`). Stripping an unrecognized first segment would treat
 * `/citiesfoo` as `/cities`, so this only strips the two known prefixes.
 */
function stripLocalePrefix(pathname: string): string {
  if (pathname === '/zh' || pathname.startsWith('/zh/')) {
    return pathname.slice(3) || '/'
  }
  return pathname
}

export function isDenylistedNavigation(pathname: string): boolean {
  const bare = stripLocalePrefix(pathname)
  return NAVIGATION_DENYLIST.some((p) => bare === p || bare.startsWith(`${p}/`))
}

/** Vite's content-hashed MapLibre chunk, e.g. `/assets/maplibre-gl-C3x9k2.js`. */
const MAPLIBRE_CHUNK_RE = /^\/assets\/maplibre-gl-.*\.js$/

/**
 * Basemap CDN hosts referenced by `src/config/mapStyle.ts`. Matched by exact
 * host or subdomain so a vendor's tile/sprite/glyph subdomains (which their
 * style.json — not our code — decides) are covered too.
 */
const BASEMAP_CDN_HOSTS = ['cartocdn.com', 'openfreemap.org', 'arcgisonline.com']

function matchesCdnHost(hostname: string): boolean {
  return BASEMAP_CDN_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

export interface CachingRequestInfo {
  url: URL
  /** `request.mode === 'navigate'` — a document/page load, not a subresource. */
  isNavigation: boolean
  /** Whether `url` shares the SW's own origin (same-origin app assets vs. third-party CDN). */
  sameOrigin: boolean
}

export function decideCachingStrategy({ url, isNavigation, sameOrigin }: CachingRequestInfo): CacheDecision {
  // Rule 1 — absolute: no path under /api/ is ever cached, navigation or not.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'network-only'

  if (isNavigation) {
    return isDenylistedNavigation(url.pathname) ? 'network-only' : 'navigate-shell'
  }

  if (sameOrigin) {
    return MAPLIBRE_CHUNK_RE.test(url.pathname) ? 'cache-first-maplibre' : 'unhandled'
  }

  return matchesCdnHost(url.hostname) ? 'cache-first-basemap-cdn' : 'unhandled'
}
