import { describe, it, expect } from 'vitest'
import { decideCachingStrategy, isDenylistedNavigation } from '../cachingStrategy'

function req(href: string, opts: { isNavigation?: boolean; sameOrigin?: boolean } = {}) {
  const url = new URL(href)
  return {
    url,
    isNavigation: opts.isNavigation ?? false,
    sameOrigin: opts.sameOrigin ?? url.origin === 'https://frolicmap.app',
  }
}

describe('decideCachingStrategy — /api is never cached', () => {
  it('is network-only for a plain /api request', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/api/items.json'))).toBe('network-only')
  })

  it('is network-only for the session mint endpoint', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/api/session'))).toBe('network-only')
  })

  it('is network-only for session-gated tiles, even though they look like static assets', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/api/tiles/10/163/396.pbf'))).toBe('network-only')
  })

  it('is network-only for /api itself with no trailing path', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/api'))).toBe('network-only')
  })

  it('overrides navigation status — an /api "navigation" is still network-only', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/api/items.json', { isNavigation: true }))).toBe(
      'network-only',
    )
  })
})

describe('decideCachingStrategy — navigations', () => {
  it('is navigate-shell for the map root', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/', { isNavigation: true }))).toBe('navigate-shell')
  })

  it('is navigate-shell for an arbitrary SPA route', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/terms', { isNavigation: true }))).toBe(
      'navigate-shell',
    )
  })

  it('excludes the generated /cities index — must hit the network, never the cached shell', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/cities', { isNavigation: true }))).toBe('network-only')
  })

  it('excludes a generated /cities/{slug} page', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/cities/seattle', { isNavigation: true }))).toBe(
      'network-only',
    )
  })

  it('does not exclude a path that merely starts with "cities" as a different segment', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/citiesfoo', { isNavigation: true }))).toBe(
      'navigate-shell',
    )
  })

  it('excludes /admin', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/admin', { isNavigation: true }))).toBe('network-only')
  })

  it('excludes a nested /admin/* route', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/admin/reports', { isNavigation: true }))).toBe(
      'network-only',
    )
  })

  it('excludes /admin under the locale-prefixed form', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/zh/admin', { isNavigation: true }))).toBe('network-only')
  })

  it('excludes /cities under the locale-prefixed form', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/zh/cities', { isNavigation: true }))).toBe(
      'network-only',
    )
  })

  it('still shells a locale-prefixed SPA route that is not on the denylist', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/zh/privacy', { isNavigation: true }))).toBe(
      'navigate-shell',
    )
  })
})

describe('decideCachingStrategy — MapLibre chunk', () => {
  it('is cache-first for the hashed maplibre-gl chunk', () => {
    expect(
      decideCachingStrategy(req('https://frolicmap.app/assets/maplibre-gl-C3x9k2.js', { sameOrigin: true })),
    ).toBe('cache-first-maplibre')
  })

  it('leaves other same-origin assets unhandled (precache manifest owns those)', () => {
    expect(decideCachingStrategy(req('https://frolicmap.app/assets/index-D8f1a0.js', { sameOrigin: true }))).toBe(
      'unhandled',
    )
  })
})

describe('decideCachingStrategy — basemap CDN hosts', () => {
  it('is cache-first for CARTO style/tile hosts', () => {
    expect(
      decideCachingStrategy(req('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', { sameOrigin: false })),
    ).toBe('cache-first-basemap-cdn')
  })

  it('is cache-first for a CARTO tile subdomain', () => {
    expect(
      decideCachingStrategy(req('https://a.basemaps.cartocdn.com/light_all/10/163/396.png', { sameOrigin: false })),
    ).toBe('cache-first-basemap-cdn')
  })

  it('is cache-first for OpenFreeMap', () => {
    expect(decideCachingStrategy(req('https://tiles.openfreemap.org/styles/liberty', { sameOrigin: false }))).toBe(
      'cache-first-basemap-cdn',
    )
  })

  it('is cache-first for the Esri imagery host', () => {
    expect(
      decideCachingStrategy(
        req('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/2/3', {
          sameOrigin: false,
        }),
      ),
    ).toBe('cache-first-basemap-cdn')
  })

  it('leaves an unrelated third-party host unhandled', () => {
    expect(decideCachingStrategy(req('https://static.cloudflareinsights.com/beacon.min.js', { sameOrigin: false }))).toBe(
      'unhandled',
    )
  })
})

describe('isDenylistedNavigation', () => {
  it('treats bare /cities and /admin as denylisted', () => {
    expect(isDenylistedNavigation('/cities')).toBe(true)
    expect(isDenylistedNavigation('/admin')).toBe(true)
  })

  it('does not denylist the map root', () => {
    expect(isDenylistedNavigation('/')).toBe(false)
  })
})
