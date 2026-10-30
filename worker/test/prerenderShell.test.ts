import { describe, it, expect } from 'vitest'
import {
  renderCityShell, assertShellTags, cityFallbackHtml, REQUIRED_SHELL_TAGS, enCityTitle,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/prerenderShell.mjs'
import { getMetro, METROS } from '@shared/metros'
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
    nearbyMetros: [{ slug: 'portland', label: 'Portland' }],
  })

  it('writes to /cities/{slug} — the city page IS the map (#387)', () => {
    expect(page.path).toBe('/cities/seattle')
  })

  const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)![1]
  const descOf = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)![1]
  const LEGEND_PROSE =
    'playgrounds, parks, libraries, museums, aquariums and zoos, beaches, water play, hiking and campgrounds'

  it('replaces the Bay-Area head with the metro’s own short title', () => {
    // The bug this fixes: one index.html served every SPA route, so a metro
    // route said "SF Bay Area" in the tab and in link previews.
    expect(titleOf(page.html)).toBe('Things to Do With Kids in Seattle | frolicmap')
    expect(page.html).not.toMatch(/<title>[^<]*Bay Area[^<]*<\/title>/)
  })

  it('keeps every metro’s title at or under 60 characters (what Google displays)', () => {
    for (const m of METROS) {
      const title = enCityTitle(m.label)
      expect(title.length, m.label).toBeLessThanOrEqual(60)
      expect(title, m.label).toContain(m.label)
      expect(title, m.label).toContain('| frolicmap')
    }
    expect(enCityTitle('San Francisco Bay Area')).toBe('Things to Do With Kids in San Francisco Bay Area | frolicmap')
    // An over-long name falls back to the shorter form, for that metro only.
    expect(enCityTitle('A'.repeat(40))).toBe(`${'A'.repeat(40)} Kids Activities Map | frolicmap`)
  })

  it('renders the short title for the Bay Area page and mirrors it in og:title / twitter:title', () => {
    const bay = renderCityShell({ shell: REAL_SHELL, metro: BAY })
    const title = titleOf(bay.html)
    expect(title).toBe('Things to Do With Kids in San Francisco Bay Area | frolicmap')
    expect(title.length).toBeLessThanOrEqual(60)
    expect(bay.html).toContain(`property="og:title" content="${title}"`)
    expect(bay.html).toContain(`name="twitter:title" content="${title}"`)
  })

  it('puts the city sentence first and the full legend in the description, under 160 characters', () => {
    for (const m of METROS) {
      const html = renderCityShell({ shell: REAL_SHELL, metro: m }).html
      const d = descOf(html)
      expect(d.startsWith(`Kids activities in ${m.label}`), m.label).toBe(true)
      expect(d, m.label).toContain(LEGEND_PROSE)
      expect(d.length, m.label).toBeLessThan(160)
      expect(html).toContain(`property="og:description" content="${d}"`)
      expect(html).toContain(`name="twitter:description" content="${d}"`)
    }
    expect(descOf(page.html)).not.toMatch(/& more|and more/i)
  })

  it('keeps the full category legend in an H2 on the page', () => {
    expect(page.html).toMatch(
      /<h2[^>]*>Playgrounds, parks, libraries, museums, aquariums and zoos, beaches, water play, hiking and campgrounds in Seattle<\/h2>/,
    )
  })

  it('points canonical, og:url and twitter:url at this metro’s /cities page', () => {
    for (const attr of ['href="https://frolicmap.app/cities/seattle"', 'content="https://frolicmap.app/cities/seattle"']) {
      expect(page.html).toContain(attr)
    }
    // No lingering homepage canonical — the duplicate-content failure mode.
    expect(page.html).not.toContain('<link rel="canonical" href="https://frolicmap.app/" />')
  })

  it('rewrites both social image tags and alt text to the metro’s own card', () => {
    const image = 'https://frolicmap.app/og/frolicmap-seattle.png'
    expect(page.html).toContain(`property="og:image" content="${image}"`)
    expect(page.html).toContain(`name="twitter:image" content="${image}"`)
    expect(page.html).toContain(
      'content="frolicmap, a family-friendly web app for finding kid-friendly places in Seattle"',
    )
    expect(page.html).toContain(
      'name="twitter:image:alt" content="frolicmap, a family-friendly web app for finding kid-friendly places in Seattle"',
    )
    expect(page.html).not.toContain('frolicmap-home.png')
  })

  it('gives every published metro a distinct absolute 1200×630 social card', () => {
    const published = METROS.filter((metro) => metro.published)
    expect(published).toHaveLength(15)
    const urls = new Set<string>()
    for (const metro of published) {
      const html = renderCityShell({ shell: REAL_SHELL, metro }).html
      const expected = `https://frolicmap.app/og/frolicmap-${metro.slug}.png`
      expect(html, metro.label).toContain(`property="og:image" content="${expected}"`)
      expect(html, metro.label).toContain(`name="twitter:image" content="${expected}"`)
      expect(html, metro.label).toContain('property="og:image:width" content="1200"')
      expect(html, metro.label).toContain('property="og:image:height" content="630"')
      urls.add(expected)
    }
    expect(urls.size).toBe(published.length)
  })

  it('still renders the hand-written blurb in the page body', () => {
    expect(page.html).toContain('Seattle wraps families in green')
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
    expect(page.html).toContain('basemap.nationalmap.gov')
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

  it('omits a category with zero rows entirely: no link, no placeholder label', () => {
    // Filtering an empty layer would show an empty map, so a category with no
    // rows in the metro never becomes a ?cat= link and is not labelled either.
    expect(page.html).not.toContain('cat=waterplay')
    expect(page.html).not.toMatch(/soon/i)
    expect(page.html).not.toContain('class="soon"')
  })

  it('ends the crawler fallback with the data attribution footer', () => {
    expect(page.html).toContain(
      'Place data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL) · ' +
      'Institute of Museum and Library Services · National Park Service',
    )
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
    expect(page.html).toContain('"@type": "WebSite"')
    expect(page.html).toContain('"url": "https://frolicmap.app/cities/seattle"')
    expect(page.html).not.toContain('https://frolicmap.app/?q={search_term_string}')
    expect(page.html).not.toContain('across the SF Bay Area')
  })
})

describe('BreadcrumbList JSON-LD', () => {
  const ldOf = (html: string) =>
    JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]) as Array<{ '@type': string; itemListElement: unknown[] }>

  it('adds Home > Cities > City alongside the WebPage object', () => {
    const page = renderCityShell({ shell: REAL_SHELL, metro: SEATTLE })
    const ld = ldOf(page.html)
    expect(ld.map((o) => o['@type'])).toEqual(['WebPage', 'BreadcrumbList'])
    expect(ld[1].itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://frolicmap.app/' },
      { '@type': 'ListItem', position: 2, name: 'Cities', item: 'https://frolicmap.app/cities' },
      { '@type': 'ListItem', position: 3, name: 'Seattle', item: 'https://frolicmap.app/cities/seattle' },
    ])
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
