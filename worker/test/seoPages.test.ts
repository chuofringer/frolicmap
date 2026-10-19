import { describe, it, expect } from 'vitest'
import {
  HUB_MIN_PLACES, CATEGORY_MIN_PLACES,
  renderCitiesIndex, cityThumbUrl, nearestMetros,
  renderSitemap, renderSitemapIndex, pageKindFor,
  fitZoom, projectToCard, boundsToBbox, bboxCenter, roundedPlaces, renderMapCard,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/seoPages.mjs'
import { getMetro, METROS, type Metro } from '@shared/metros'
import { CATEGORY_SLUG, categoryForSlug, slugify } from '@shared/categorySlugs'

const SEATTLE = getMetro('seattle')!

describe('category slugs are search terms, not DB values (plan §3.2)', () => {
  it('maps internal vocabulary to what people actually search', () => {
    // "waterplay" and "aquarium" are our words; nobody types them.
    expect(CATEGORY_SLUG.waterplay).toBe('splash-pads')
    expect(CATEGORY_SLUG.aquarium).toBe('zoos-aquariums')
    expect(CATEGORY_SLUG.hiking).toBe('hiking-trails')
  })

  it('round-trips slug back to category', () => {
    expect(categoryForSlug('splash-pads')).toBe('waterplay')
    expect(categoryForSlug('nonsense')).toBeUndefined()
  })

  it('strips diacritics rather than dropping them', () => {
    // Dropping the character would collide "Peña Park" with "Pea Park".
    expect(slugify('Peña Adobe Park')).toBe('pena-adobe-park')
    expect(slugify('  Zilker/Barton  Springs ')).toBe('zilker-barton-springs')
  })
})

describe('thresholds', () => {
  it('matches the plan', () => {
    expect(HUB_MIN_PLACES).toBe(50)
    expect(CATEGORY_MIN_PLACES).toBe(5)
  })
})

describe('/cities index (the welcome page)', () => {
  const bay = getMetro('bay')!
  const index = renderCitiesIndex({
    metros: [bay, SEATTLE],
    countsByMetro: { bay: 5569, seattle: 2858 },
    // Mixed categories near the card centre so every dot is inside the crop:
    // waterplay (#0369a1), museum (#8b5cf6), plus one unknown category that
    // must fall back to amber.
    pinsByMetro: {
      bay: [
        { lat: 37.55, lng: -122.33, category: 'waterplay' },
        { lat: 37.58, lng: -122.30, category: 'museum' },
        { lat: 37.52, lng: -122.36, category: 'mystery' },
      ],
      seattle: [],
    },
  })

  it('lives at /cities and is self-canonical', () => {
    expect(index.path).toBe('/cities')
    expect(index.html).toContain('<link rel="canonical" href="https://frolicmap.app/cities">')
  })

  it('names every category in the title and description, including unbuilt ones', () => {
    // The vocabulary is the point: "splash pads in Denver" is a real query
    // whether or not we have the data yet.
    for (const term of [
      'playgrounds', 'parks', 'libraries', 'museums', 'aquariums', 'beaches',
      'water play', 'hiking', 'campgrounds',
    ]) {
      expect(index.html.toLowerCase(), term).toContain(term)
    }
  })

  it('never writes "& More" / "and more" in metadata or copy', () => {
    expect(index.html.toLowerCase()).not.toContain('& more')
    expect(index.html.toLowerCase()).not.toContain('and more')
  })

  it('renders one card per metro with a composite map thumbnail', () => {
    expect((index.html.match(/class="city"/g) ?? []).length).toBe(2)
    // The single-tile <img> thumbnail is replaced by a centered CSS composite
    // of CARTO tiles inside an aspect-ratio container.
    expect(index.html).toContain('basemaps.cartocdn.com')
    expect((index.html.match(/class="citymap"/g) ?? []).length).toBe(2)
  })

  it('rounds place counts and never shows an exact figure', () => {
    expect(index.html).toContain('5k+ places')
    expect(index.html).toContain('2k+ places')
    expect(index.html).not.toContain('5,569')
    expect(index.html).not.toContain('2,858')
  })

  it('overlays approved-place pins as category-coloured dots when supplied', () => {
    // The bay pins sit near the card center, so they are inside the crop. Each
    // dot carries its category colour; the unknown category falls back to amber.
    expect(index.html).toContain('background:#0369a1')  // waterplay
    expect(index.html).toContain('background:#8b5cf6')  // museum
    expect(index.html).toContain('background:#f59e0b')  // unknown → amber fallback
    // Shared dot styling lives in a `.dot` class, not repeated inline.
    expect((index.html.match(/class="dot"/g) ?? []).length).toBe(3)
    expect(index.html).toContain('.dot{position:absolute')
  })

  it('drops the data-source attributions from the footer and meta line', () => {
    expect(index.html).not.toContain('OpenStreetMap')
    expect(index.html).not.toContain('ParkServe')
    expect(index.html).not.toContain('IMLS')
    expect(index.html).toContain('frolicmap.app</a> — a map of kids activities.')
  })

  it('carries no newsletter CTA (surface retired 2026-08-09)', () => {
    // The "✉ Newsletter" button to /signup was removed with the standalone
    // signup page: /signup now redirects into the sign-in gate, which is a
    // silent no-op for signed-in visitors — an advertised CTA must not
    // dead-end. Newsletter capture lives on the sign-in opt-in checkbox.
    expect((index.html.match(/class="cta-news"/g) ?? []).length).toBe(0)
    expect(index.html).not.toContain('href="/signup"')
    expect(index.html).not.toContain('✉ Newsletter')
    // The blue `.cta` class stays defined for reuse but is unused on this page.
    expect((index.html.match(/class="cta"/g) ?? []).length).toBe(0)
  })

  it('links cards at /cities/{slug}, using the Bay Area’s slug not its id', () => {
    expect(index.html).toContain('href="/cities/bay-area"')
    expect(index.html).toContain('href="/cities/seattle"')
    expect(index.html).not.toContain('href="/cities/bay"')
  })

  it('emits ItemList JSON-LD so the index is machine-readable', () => {
    expect(index.html).toContain('"@type":"ItemList"')
  })

  it('lazy-loads the composite tiles (no layout shift)', () => {
    expect(index.html).toContain('loading="lazy"')
    expect(index.html).toContain('aspect-ratio:512/384')
  })
})

describe('centered map-card composite', () => {
  const bay = getMetro('bay')!

  it('fit-zoom shrinks for a huge bbox and grows for a tight one', () => {
    const huge = { south: 0, west: -60, north: 60, east: 60 }
    const tight = { south: 37.7, west: -122.5, north: 37.9, east: -122.3 }
    expect(fitZoom(huge)).toBeLessThan(fitZoom(tight))
  })

  it('lands the metro center at 50% / 50%', () => {
    const bbox = boundsToBbox(bay.viewportBounds)
    const center = bboxCenter(bbox)
    const z = fitZoom(bbox)
    const p = projectToCard(center, center, z)
    expect(p.xPct).toBeCloseTo(50, 6)
    expect(p.yPct).toBeCloseTo(50, 6)
    expect(p.visible).toBe(true)
  })

  it('keeps a viewport-bbox corner inside the [0,100]% crop', () => {
    const bbox = boundsToBbox(bay.viewportBounds)
    const center = bboxCenter(bbox)
    const z = fitZoom(bbox)
    for (const corner of [
      { lat: bbox.north, lng: bbox.west },
      { lat: bbox.south, lng: bbox.east },
    ]) {
      const p = projectToCard(corner, center, z)
      expect(p.xPct).toBeGreaterThanOrEqual(0)
      expect(p.xPct).toBeLessThanOrEqual(100)
      expect(p.yPct).toBeGreaterThanOrEqual(0)
      expect(p.yPct).toBeLessThanOrEqual(100)
    }
  })

  it('emits 4–9 lazy CARTO tiles for a metro card', () => {
    const html = renderMapCard({ metro: bay })
    const tiles = html.match(/basemaps\.cartocdn\.com/g) ?? []
    expect(tiles.length).toBeGreaterThanOrEqual(4)
    expect(tiles.length).toBeLessThanOrEqual(9)
    expect(html).toContain('loading="lazy"')
  })

  it('drops pins that fall outside the visible crop', () => {
    // A point on the far side of the planet is never inside the card.
    const html = renderMapCard({ metro: bay, pins: [{ lat: -40, lng: 150 }] })
    expect(html).not.toContain('#f59e0b')
  })

  it('colours each dot by its category, with at least two distinct hues', () => {
    const html = renderMapCard({
      metro: bay,
      pins: [
        { lat: 37.55, lng: -122.33, category: 'waterplay' },
        { lat: 37.58, lng: -122.30, category: 'museum' },
      ],
    })
    expect(html).toContain('background:#0369a1')  // waterplay
    expect(html).toContain('background:#8b5cf6')  // museum
    // Shared styling comes from the `.dot` class; only left/top/background inline.
    expect((html.match(/class="dot"/g) ?? []).length).toBe(2)
    expect(html).not.toContain('border-radius:50%')  // moved to the stylesheet
  })

  it('falls back to amber for an unknown/missing category', () => {
    const html = renderMapCard({
      metro: bay,
      pins: [
        { lat: 37.55, lng: -122.33, category: 'not-a-category' },
        { lat: 37.58, lng: -122.30 },  // no category at all
      ],
    })
    expect((html.match(/background:#f59e0b/g) ?? []).length).toBe(2)
  })

  it('renders one dot per visible pin (caller-supplied cap, up to ~280)', () => {
    // renderMapCard itself never truncates — the 280/metro cap is enforced by
    // the generator's window-function query. Every supplied in-crop pin draws.
    const pins = Array.from({ length: 280 }, (_, i) => ({
      lat: 37.5 + (i % 20) * 0.01,
      lng: -122.4 + Math.floor(i / 20) * 0.01,
      category: 'park',
    }))
    const html = renderMapCard({ metro: bay, pins })
    expect((html.match(/class="dot"/g) ?? []).length).toBe(280)
  })
})

describe('roundedPlaces', () => {
  it('renders thousands as "Nk+ places"', () => {
    expect(roundedPlaces(5569)).toBe('5k+ places')
    expect(roundedPlaces(2858)).toBe('2k+ places')
  })
  it('floors hundreds to the hundred', () => {
    expect(roundedPlaces(730)).toBe('700+ places')
    expect(roundedPlaces(100)).toBe('100+ places')
  })
  it('omits the count under 100', () => {
    expect(roundedPlaces(99)).toBeNull()
    expect(roundedPlaces(0)).toBeNull()
  })
})

describe('city thumbnails', () => {
  it('computes the slippy tile containing the metro centre', () => {
    // Seattle sits in tile 10/164/357 — spot-checked against the standard
    // slippy formula.
    expect(cityThumbUrl(SEATTLE)).toBe('https://basemaps.cartocdn.com/light_all/10/164/357@2x.png')
  })

  it('gives visually distinct tiles to different metros', () => {
    const seen = new Set(['bay', 'seattle', 'miami', 'denver'].map((id) => cityThumbUrl(getMetro(id)!)))
    expect(seen.size).toBe(4)
  })
})

describe('nearestMetros (nearby-metros footer, #387)', () => {
  it('returns the nearest candidates by great-circle distance, excluding self', () => {
    const near = nearestMetros(SEATTLE, METROS as Metro[], 3)
    expect(near).not.toContain(SEATTLE)
    expect(near).toHaveLength(3)
    // Portland is Seattle's closest metro in the registry by a wide margin.
    expect(near[0].id).toBe('portland')
  })

  it('only ever returns metros from the candidate list — the generator passes published only', () => {
    // "Links only PUBLISHED metros" is enforced at the call site: the caller
    // passes the published set as candidates, and this helper never invents
    // one. So a footer built from the published set can only ever contain
    // published metros.
    const published = METROS.filter((m) => m.published)
    const near = nearestMetros(SEATTLE, published, 4)
    expect(near.every((m) => m.published)).toBe(true)
  })

  it('respects the limit', () => {
    expect(nearestMetros(SEATTLE, METROS as Metro[], 2)).toHaveLength(2)
  })
})

describe('sitemaps', () => {
  it('emits absolute URLs', () => {
    expect(renderSitemap(['/cities/seattle'])).toContain('<loc>https://frolicmap.app/cities/seattle</loc>')
  })

  it('stitches per-metro sitemaps into an index', () => {
    const idx = renderSitemapIndex(['/sitemaps/seattle.xml'])
    expect(idx).toContain('<sitemapindex')
    expect(idx).toContain('https://frolicmap.app/sitemaps/seattle.xml')
  })

  it('classifies /cities as the index tier and /cities/{slug} as the city tier', () => {
    // Only two page kinds remain since #387.
    expect(renderSitemap(['/cities'])).toContain('<priority>1.0</priority>')
    expect(renderSitemap(['/cities/seattle'])).toContain('<priority>0.9</priority>')
  })
})

describe('homepage stays in the sitemap', () => {
  it('classifies / as its own kind with top crawl priority', () => {
    // The pre-national sitemap's single entry WAS the homepage; when the
    // generator took over /sitemap.xml it silently fell out. The live Bay
    // map is the site's highest-equity URL and must stay declared.
    expect(pageKindFor('/')).toBe('home')
    const xml = renderSitemap(['/', '/cities'])
    expect(xml).toContain('<loc>https://frolicmap.app/</loc>')
    expect(xml).toContain('<changefreq>daily</changefreq><priority>1.0</priority>')
  })
})
