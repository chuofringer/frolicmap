import { describe, it, expect } from 'vitest'
import {
  renderCityShell,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/prerenderShell.mjs'
import {
  renderCitiesIndex, renderSitemap, pageKindFor, roundedPlaces,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/seoPages.mjs'
import {
  makeZhContext, hreflangLinks, interpolate, joinList,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/localeCopy.mjs'
import { getMetro, METROS } from '@shared/metros'
import { CATEGORY_PLURAL } from '@shared/categorySlugs'
import { pages } from '../../src/i18n/zh/pages'
import { categories } from '../../src/i18n/zh/categories'
import { metro as zhMetro } from '../../src/i18n/zh/metro'
// @ts-expect-error — ?raw text import, no type declaration.
import REAL_SHELL from '../../index.html?raw'

const SEATTLE = getMetro('seattle')!
const zh = makeZhContext({ citySeo: pages.citySeo, categories, names: zhMetro.names })

const cityPage = (loc: unknown, metro = SEATTLE) =>
  renderCityShell({
    shell: REAL_SHELL,
    metro,
    categoryCounts: { playground: 89, park: 2534, beach: 4 },
    categoryPlural: CATEGORY_PLURAL,
    nearbyMetros: [{ slug: 'portland', label: 'Portland' }],
    loc,
  })

describe('localeCopy helpers', () => {
  it('interpolates {{vars}}', () => {
    expect(interpolate('{{a}}-{{b}}', { a: 1, b: 'x' })).toBe('1-x')
  })
  it('joins lists with locale separators', () => {
    expect(joinList(['a', 'b', 'c'], '、', '和')).toBe('a、b和c')
    expect(joinList(['a'], '、', '和')).toBe('a')
  })
  it('emits a reciprocal trio pointing x-default at English', () => {
    const links = hreflangLinks('/cities/seattle')
    expect(links).toContain('hreflang="en" href="https://frolicmap.app/cities/seattle"')
    expect(links).toContain('hreflang="zh-Hans" href="https://frolicmap.app/zh/cities/seattle"')
    expect(links).toContain('hreflang="x-default" href="https://frolicmap.app/cities/seattle"')
  })
})

describe('zh city page', () => {
  const page = cityPage(zh)

  it('lives at /zh/cities/{slug} and is self-canonical', () => {
    expect(page.path).toBe('/zh/cities/seattle')
    expect(page.html).toContain('<link rel="canonical" href="https://frolicmap.app/zh/cities/seattle"')
    expect(page.html).toContain('property="og:url" content="https://frolicmap.app/zh/cities/seattle"')
  })

  it('sets html lang=zh-Hans and Chinese title/description from the locale slice', () => {
    expect(page.html).toMatch(/<html lang="zh-Hans"/)
    expect(page.html).toContain('<title>西雅图亲子活动地图 | frolicmap</title>')
    expect(page.html).toMatch(/<meta name="description" content="西雅图亲子好去处互动地图/)
    expect(page.html).not.toMatch(/<title>[^<]*Kids Activities[^<]*<\/title>/)
  })

  it('keeps zh titles short and descriptions within 80 characters for every published metro', () => {
    // Unpublished metros have no zh name yet (they fall back to the English label).
    for (const m of METROS.filter((x) => x.published)) {
      const html = cityPage(zh, m).html
      const title = /<title>([^<]*)<\/title>/.exec(html)![1]
      const desc = /<meta name="description" content="([^"]*)"/.exec(html)![1]
      expect(title, m.label).toBe(`${zhMetro.names[m.id] ?? m.label}亲子活动地图 | frolicmap`)
      expect([...title].length, m.label).toBeLessThanOrEqual(30)
      expect([...desc].length, m.label).toBeLessThanOrEqual(80)
      expect(desc, m.label).toContain('游乐场、公园、图书馆、博物馆、水族馆和动物园、海滩、戏水、徒步和露营地')
      expect(html).toContain(`property="og:title" content="${title}"`)
      expect(html).toContain(`name="twitter:title" content="${title}"`)
      expect(html).toContain(`property="og:description" content="${desc}"`)
    }
  })

  it('keeps the shortened legend in an H2', () => {
    expect(page.html).toMatch(/<h2[^>]*>西雅图的游乐场、公园、图书馆、博物馆、水族馆和动物园、海滩、戏水、徒步和露营地<\/h2>/)
  })

  it('adds a zh BreadcrumbList using the zh paths and names', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page.html)![1])
    expect(ld.map((o: { '@type': string }) => o['@type'])).toEqual(['WebPage', 'BreadcrumbList'])
    expect(ld[1].itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: '首页', item: 'https://frolicmap.app/zh/' },
      { '@type': 'ListItem', position: 2, name: '城市', item: 'https://frolicmap.app/zh/cities' },
      { '@type': 'ListItem', position: 3, name: '西雅图', item: 'https://frolicmap.app/zh/cities/seattle' },
    ])
  })

  it('renders visible Chinese copy and keeps links inside /zh', () => {
    expect(page.html).toContain('西雅图亲子活动')
    expect(page.html).toContain('href="/zh/cities/seattle?cat=park"')
    expect(page.html).toContain('href="/zh/cities/portland"')
    expect(page.html).toContain('href="/zh/cities"')
    expect(page.html).not.toContain('href="/cities')
  })

  it('carries reciprocal hreflang', () => {
    expect(page.html).toContain('hreflang="en" href="https://frolicmap.app/cities/seattle"')
    expect(page.html).toContain('hreflang="zh-Hans" href="https://frolicmap.app/zh/cities/seattle"')
    expect(page.html).toContain('hreflang="x-default" href="https://frolicmap.app/cities/seattle"')
  })

  it('carries the (English, proper-noun) data attribution footer', () => {
    expect(page.html).toContain('<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL)')
    expect(page.html).toContain('National Park Service')
  })

  it('links the zh Privacy / Terms pages and Contact in the footer', () => {
    expect(page.html).toContain('href="/zh/privacy"')
    expect(page.html).toContain('href="/zh/terms"')
    expect(page.html).toContain('mailto:frolicmap.official@gmail.com')
    expect(page.html).toContain('隐私政策')
    expect(page.html).toContain('代码为开源（MIT 许可）；地点数据按各来源的许可证再分发。')
  })

  it('still boots the SPA shell (script tag + root div survive)', () => {
    expect(page.html).toMatch(/<script type="module"[^>]*src="[^"]+"/)
    expect(page.html).toContain('<div id="root">')
  })
})

describe('English page gains hreflang but is otherwise unchanged', () => {
  const page = cityPage(null)
  it('keeps path, lang and canonical', () => {
    expect(page.path).toBe('/cities/seattle')
    expect(page.html).toMatch(/<html lang="en"/)
    expect(page.html).toContain('<link rel="canonical" href="https://frolicmap.app/cities/seattle"')
  })
  it('links Privacy, Terms and Contact in its footer', () => {
    expect(page.html).toContain('href="/privacy"')
    expect(page.html).toContain('href="/terms"')
    expect(page.html).toContain('mailto:frolicmap.official@gmail.com')
  })
  it('has the same hreflang trio as its zh twin', () => {
    expect(page.html).toContain('hreflang="zh-Hans" href="https://frolicmap.app/zh/cities/seattle"')
    expect(page.html).toContain('hreflang="x-default" href="https://frolicmap.app/cities/seattle"')
  })
})

describe('/zh/cities index', () => {
  const opts = { metros: [SEATTLE], countsByMetro: { seattle: 4400 }, pinsByMetro: {} }
  const zhIndex = renderCitiesIndex({ ...opts, loc: zh })
  const enIndex = renderCitiesIndex(opts)

  it('is self-canonical with Chinese chrome and zh-Hans lang', () => {
    expect(zhIndex.path).toBe('/zh/cities')
    expect(zhIndex.html).toContain('<html lang="zh-Hans">')
    expect(zhIndex.html).toContain('<link rel="canonical" href="https://frolicmap.app/zh/cities">')
    expect(zhIndex.html).toContain('<h1>按城市浏览亲子活动</h1>')
    expect(zhIndex.html).toContain('href="/zh/cities/seattle"')
    expect(zhIndex.html).toContain('4k+ 个地点')
  })

  it('the zh twin gets the same light-map thumbnail hooks and script', () => {
    for (const html of [zhIndex.html, enIndex.html]) {
      expect(html).toMatch(/<div class="thumb" data-bbox="[^"]+" data-points='\[\]'>/)
      expect(html).toContain('<img src="https://basemap.nationalmap.gov')
      expect(html).toContain('<script type="module" src="/cities-thumbs.js"></script>')
    }
  })

  it('both locales carry the data attribution footer', () => {
    for (const html of [zhIndex.html, enIndex.html]) {
      expect(html).toContain('<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL)')
      expect(html).toContain('Institute of Museum and Library Services · National Park Service')
    }
  })

  it('footer links Privacy / Terms / Contact under each locale prefix', () => {
    expect(zhIndex.html).toContain('href="/zh/privacy"')
    expect(zhIndex.html).toContain('href="/zh/terms"')
    expect(zhIndex.html).toContain('联系我们')
    expect(enIndex.html).toContain('href="/privacy"')
    expect(enIndex.html).toContain('href="/terms"')
    for (const html of [zhIndex.html, enIndex.html]) {
      expect(html).toContain('mailto:frolicmap.official@gmail.com')
    }
  })

  it('both locales cross-reference each other', () => {
    for (const html of [zhIndex.html, enIndex.html]) {
      expect(html).toContain('hreflang="en" href="https://frolicmap.app/cities"')
      expect(html).toContain('hreflang="zh-Hans" href="https://frolicmap.app/zh/cities"')
      expect(html).toContain('hreflang="x-default" href="https://frolicmap.app/cities"')
    }
    expect(enIndex.html).toContain('<html lang="en">')
    expect(enIndex.path).toBe('/cities')
  })

  it('uses the short zh index title and a legend description within 80 characters', () => {
    expect(zhIndex.html).toContain('<title>各城市亲子活动 | frolicmap</title>')
    const desc = /<meta name="description" content="([^"]*)"/.exec(zhIndex.html)![1]
    expect([...desc].length).toBeLessThanOrEqual(80)
    expect(desc).toContain('游乐场、公园、图书馆、博物馆、水族馆和动物园、海滩、戏水、徒步和露营地')
    expect(zhIndex.html).toContain('property="og:title" content="各城市亲子活动 | frolicmap"')
    expect(zhIndex.html).toMatch(/<h2>[^<]*水族馆和动物园[^<]*<\/h2>/)
  })

  it('lists the cities as ItemList ListItems with position and zh url', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(zhIndex.html)![1])
    expect(ld['@type']).toBe('ItemList')
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: '西雅图', url: 'https://frolicmap.app/zh/cities/seattle' },
    ])
  })

  it('formats counts per locale', () => {
    expect(roundedPlaces(4400)).toBe('4k+ places')
    expect(roundedPlaces(40, zh)).toBeNull()
  })
})

describe('sitemap', () => {
  it('treats /zh paths as the same page kind as their English twin', () => {
    expect(pageKindFor('/zh/cities')).toBe('index')
    expect(pageKindFor('/zh/cities/seattle')).toBe('city')
  })
  it('lists zh entries', () => {
    const xml = renderSitemap(['/cities/seattle', '/zh/cities/seattle'])
    expect(xml).toContain('<loc>https://frolicmap.app/zh/cities/seattle</loc>')
  })
})
