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
import { getMetro } from '@shared/metros'
import { CATEGORY_PLURAL } from '@shared/categorySlugs'
import { pages } from '../../src/i18n/zh/pages'
import { categories } from '../../src/i18n/zh/categories'
import { metro as zhMetro } from '../../src/i18n/zh/metro'
// @ts-expect-error — ?raw text import, no type declaration.
import REAL_SHELL from '../../index.html?raw'

const SEATTLE = getMetro('seattle')!
const zh = makeZhContext({ citySeo: pages.citySeo, categories, names: zhMetro.names })

const cityPage = (loc: unknown) =>
  renderCityShell({
    shell: REAL_SHELL,
    metro: SEATTLE,
    categoryCounts: { playground: 89, park: 2534, beach: 4 },
    categoryPlural: CATEGORY_PLURAL,
    allCategories: ['playground', 'park', 'beach', 'waterplay'],
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
    expect(page.html).toContain('<title>西雅图亲子活动地图——儿童游乐场、公园、')
    expect(page.html).toMatch(/<meta name="description" content="西雅图亲子好去处互动地图/)
    expect(page.html).not.toMatch(/<title>[^<]*Kids Activities[^<]*<\/title>/)
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

  it('both locales cross-reference each other', () => {
    for (const html of [zhIndex.html, enIndex.html]) {
      expect(html).toContain('hreflang="en" href="https://frolicmap.app/cities"')
      expect(html).toContain('hreflang="zh-Hans" href="https://frolicmap.app/zh/cities"')
      expect(html).toContain('hreflang="x-default" href="https://frolicmap.app/cities"')
    }
    expect(enIndex.html).toContain('<html lang="en">')
    expect(enIndex.path).toBe('/cities')
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
