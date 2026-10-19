import { describe, it, expect } from 'vitest'
import {
  renderCityShell, assertShellTags, cityFallbackHtml, REQUIRED_SHELL_TAGS,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/prerenderShell.mjs'
import { getMetro } from '@shared/metros'
import { CATEGORY_PLURAL } from '@shared/categorySlugs'
// The REAL SPA shell, imported as text — the same tags `vite build` emits
// into dist/index.html. Read through Vite rather than node:fs because the
// worker test pool sandboxes the filesystem. Testing against the actual file
// is the point: it makes assertShellTags a live contract rather than a check
// against a fixture that can drift from the real head.
// @ts-expect-error — ?raw text import, no type declaration.
import REAL_SHELL from '../../index.html?raw'

const SEATTLE = getMetro('seattle')!
const BAY = getMetro('bay')!

describe('shell contract', () => {
  it("the repo's index.html carries every tag the rewrite depends on", () => {
    // This is the guard that matters: the rewrite only REPLACES existing
    // tags. If someone removes the canonical link from index.html, every
    // metro page would silently keep the homepage's canonical — telling
    // Google the metro page is a duplicate of `/`. Fail in CI instead.
    expect(() => assertShellTags(REAL_SHELL)).not.toThrow()
  })

  it('names the missing tags rather than failing vaguely', () => {
    const stripped = REAL_SHELL.replace(/<link rel="canonical"[^>]*>/, '')
    expect(() => assertShellTags(stripped)).toThrow(/canonical/)
  })

  it('checks the root div, since the fallback injection targets it', () => {
    expect(REQUIRED_SHELL_TAGS.some((t: { label: string }) => t.label === 'root div')).toBe(true)
    expect(() => assertShellTags(REAL_SHELL.replace('<div id="root"></div>', '<div id="app"></div>')))
      .toThrow(/root div/)
  })
})

describe('renderCityShell', () => {
  const page = renderCityShell({
    shell: REAL_SHELL,
    metro: SEATTLE,
    categoryCounts: { playground: 89, park: 2534, library: 115, beach: 4 },
    categoryPlural: CATEGORY_PLURAL,
    allCategories: ['playground', 'park', 'library', 'beach', 'waterplay', 'upick'],
    nearbyMetros: [{ slug: 'portland', label: 'Portland' }],
  })

  it('writes to /cities/{slug} — the city page IS the map (#387)', () => {
    expect(page.path).toBe('/cities/seattle')
  })

  const LEGEND_LIST =
    'Playground, Park, Library, Museum, Aquarium/Zoo, Beach, Water Play, Hiking, ' +
    'Campground, Birthday Party, Restaurant, U-Pick Farm &amp; Event'

  it('replaces the Bay-Area head with the metro’s own title carrying the full legend list', () => {
    // The bug this fixes: one index.html served every SPA route, so a metro
    // route said "SF Bay Area" in the tab and in link previews. The category
    // list is HARDCODED to the SPA legend, verbatim and identical for every
    // metro (user directive) — never data-driven, never "& More".
    expect(page.html).toContain(`<title>Seattle Kids Activities Map — ${LEGEND_LIST}</title>`)
    expect(page.html).not.toContain('&amp; More<')
    expect(page.html).not.toMatch(/<title>[^<]*Bay Area[^<]*<\/title>/)
  })

  it('emits the identical title list for every metro regardless of its data', () => {
    // Detroit gets no category data at all here — the list must not change.
    const detroit = renderCityShell({ shell: REAL_SHELL, metro: getMetro('detroit')! })
    expect(detroit.html).toContain(`<title>Detroit Kids Activities Map — ${LEGEND_LIST}</title>`)
  })

  it('points canonical, og:url and twitter:url at this metro’s /cities page', () => {
    for (const attr of ['href="https://funradar.app/cities/seattle"', 'content="https://funradar.app/cities/seattle"']) {
      expect(page.html).toContain(attr)
    }
    // No lingering homepage canonical — the duplicate-content failure mode.
    expect(page.html).not.toContain('<link rel="canonical" href="https://funradar.app/" />')
  })

  it('rewrites og:image:alt per metro, carrying the same full legend list as the title', () => {
    // The image itself stays the shared site card (user decision on #385), so
    // the alt describes the product per-city rather than the Bay pixels — and
    // lists all categories rather than trailing off with "and more".
    expect(page.html).toContain(
      `content="Seattle kids activities map on funradar.app — ${LEGEND_LIST}."`,
    )
    expect(page.html).not.toContain('Map of the SF Bay Area')
  })

  it('uses the hand-written blurb as the description, inside the snippet budget', () => {
    expect(page.html).toContain('Seattle wraps families in green')
    const m = /<meta name="description" content="([^"]*)"/.exec(page.html)!
    expect(m[1].length).toBeLessThanOrEqual(160)
  })

  it('preserves the built shell — hashed asset tags survive the rewrite', () => {
    // The whole point of rewriting the BUILT shell rather than templating a
    // new page: the app still boots. Losing the script tag would ship a
    // static page where the map used to be.
    const scripts = (REAL_SHELL.match(/<script[^>]*src=/g) ?? []).length
    expect((page.html.match(/<script[^>]*src=/g) ?? []).length).toBe(scripts)
  })

  it('injects crawler-visible fallback: heading, thumbnail and links back to /cities', () => {
    expect(page.html).not.toContain('<div id="root"></div>')
    expect(page.html).toContain('Kids activities in Seattle')
    // The overview thumbnail the old static hub carried.
    expect(page.html).toContain('basemaps.cartocdn.com')
    expect(page.html).toContain('loading="lazy"')
    // Internal linking: the page must not be a dead end.
    expect(page.html).toContain('href="/cities"')
  })

  it('links live categories as ?cat= deep links using DB values, not URL slugs', () => {
    // paths carry search-term slugs, query params carry internal vocabulary.
    expect(page.html).toContain('href="/cities/seattle?cat=park"')
    expect(page.html).toContain('href="/cities/seattle?cat=playground"')
    expect(page.html).not.toContain('cat=parks')       // the slug form
    expect(page.html).not.toContain('cat=playgrounds')
    // beach (4) is below CATEGORY_MIN_PLACES → no near-empty deep link.
    expect(page.html).not.toContain('cat=beach')
  })

  it('lists coming-soon categories as plain text, never linked', () => {
    // Filtering an empty layer would show an empty map, so a coming-soon
    // category must not become a ?cat= link.
    expect(page.html).toContain('(coming soon)')
    expect(page.html).toContain('Water Play')
    expect(page.html).not.toContain('cat=waterplay')
    expect(page.html).not.toContain('cat=upick')
  })

  it('renders the nearby-metros footer with /cities links', () => {
    // The generator passes only published metros as candidates, so a footer
    // can only ever contain published metros (see nearestMetros coverage).
    expect(page.html).toContain('href="/cities/portland"')
    expect(page.html).toContain('Portland')
  })

  it('uses every metro’s own blurb — all 50 are hand-written, none fall back', () => {
    const detroit = getMetro('detroit')!
    expect(detroit.blurb.length).toBeGreaterThan(100)
    const p = renderCityShell({ shell: REAL_SHELL, metro: detroit })
    expect(p.html).toContain('Metro Detroit')
  })

  it('uses the Bay Area URL slug, not its region id', () => {
    expect(renderCityShell({ shell: REAL_SHELL, metro: BAY }).path).toBe('/cities/bay-area')
  })

  it('rewrites keywords so they are not the Bay Area homepage list', () => {
    expect(page.html).toContain('kids activities Seattle')
    expect(page.html).not.toContain('kids activities san francisco')
    expect(page.html).not.toContain('things to do with kids bay area')
  })

  it('rewrites JSON-LD to this metro’s URL, not the homepage WebSite + SearchAction', () => {
    expect(page.html).toContain('"@type": "WebPage"')
    expect(page.html).toContain('"url": "https://funradar.app/cities/seattle"')
    expect(page.html).not.toContain('https://funradar.app/?q={search_term_string}')
    expect(page.html).not.toContain('across the SF Bay Area')
  })
})

describe('escaping', () => {
  it('escapes a metro label so it cannot break out of an attribute', () => {
    const evil = { ...SEATTLE, label: 'Ev"il <script>', slug: 'evil' }
    const html = renderCityShell({ shell: REAL_SHELL, metro: evil }).html
    expect(html).not.toContain('Ev"il <script>')
    expect(html).toContain('&quot;il &lt;script&gt;')
  })

  it('escapes category link labels in the fallback', () => {
    const html = cityFallbackHtml({
      metro: SEATTLE,
      categoryLinks: [{ href: '/x', label: '<b>Parks</b>' }],
    })
    expect(html).toContain('&lt;b&gt;Parks&lt;/b&gt;')
  })
})
