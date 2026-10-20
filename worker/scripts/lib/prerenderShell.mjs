/**
 * SPA-shell prerender for `/cities/{metro}` — the city page IS the map (#387).
 *
 * The problem it solves: one `index.html` serves every SPA route, so a metro
 * route shipped a head that says "SF Bay Area" — wrong in the tab, wrong in a
 * shared link's preview card, and invisible to a crawler that sees an empty
 * `<div id="root">`.
 *
 * The technique: take the
 * BUILT shell (hashed script tags and all), rewrite its head tags in place,
 * inject crawler-visible fallback content into the root div, and write the
 * result as `cities/{slug}.html`. React's `createRoot()` replaces the fallback
 * on hydration, so one URL is both the indexable page and the full interactive
 * app — no funnel hop.
 *
 * #387 collapsed the old three-page-kinds-plus-a-map-shell design into this
 * single page. The fallback now carries what the deleted static hub carried —
 * an h1, the blurb, an overview thumbnail, the category breakdown and a
 * nearby-metros footer — except the category breakdown links are `?cat=`
 * deep links on THIS page (the map, pre-filtered) rather than links to
 * standalone category pages that no longer exist. Query strings are ignored by
 * Pages static matching, so `/cities/seattle?cat=playground` serves the same
 * bytes as `/cities/seattle`; the SPA reads the param after hydration.
 *
 * Pure string manipulation; the caller does the IO.
 */

import { renderMapCard, CATEGORY_MIN_PLACES, DATA_ATTRIBUTION_HTML, legalLinksHtml } from './seoPages.mjs'
import { escapeHtml as esc } from './htmlEscape.mjs'
import { hreflangLinks, EN_LEGEND_PROSE } from './localeCopy.mjs'

const SITE = 'https://frolicmap.app'

/**
 * The category list for title and og:image:alt — hardcoded to the SPA legend
 * (`src/config/categories.ts`), verbatim and in legend order, identical for
 * every metro. Deliberately NOT derived from per-metro data: the user wants
 * one list everywhere.
 */
const LEGEND_CATEGORIES = [
  'Playground', 'Park', 'Library', 'Museum', 'Aquarium/Zoo', 'Beach',
  'Water Play', 'Hiking', 'Campground',
]
const LEGEND_LIST =
  `${LEGEND_CATEGORIES.slice(0, -1).join(', ')} & ${LEGEND_CATEGORIES[LEGEND_CATEGORIES.length - 1]}`

/**
 * Replace the CONTENT of a meta/link tag that already exists in the shell.
 *
 * Deliberately non-creating: if the tag isn't in the template this is a
 * no-op, which is why `assertShellTags` runs first. A silent miss here would
 * ship a page whose canonical still points at `/`, quietly telling Google the
 * metro page is a duplicate of the homepage — the worst possible failure and
 * an invisible one.
 */
function replaceTagContent(html, matcher, attr, value) {
  const re = new RegExp(`(<(?:meta|link)[^>]*${matcher}[^>]*${attr}=")[^"]*(")`, 'i')
  return html.replace(re, `$1${esc(value)}$2`)
}

/** Tags the rewrite depends on. Missing any means a silently wrong page. */
export const REQUIRED_SHELL_TAGS = [
  { label: '<title>', test: (h) => /<title>[^<]*<\/title>/.test(h) },
  { label: 'meta description', test: (h) => /<meta\s+name="description"[^>]*content="/.test(h) },
  { label: 'link canonical', test: (h) => /<link\s+rel="canonical"[^>]*href="/.test(h) },
  { label: 'og:title', test: (h) => /property="og:title"[^>]*content="/.test(h) },
  { label: 'og:description', test: (h) => /property="og:description"[^>]*content="/.test(h) },
  { label: 'og:url', test: (h) => /property="og:url"[^>]*content="/.test(h) },
  { label: 'og:image:alt', test: (h) => /property="og:image:alt"[^>]*content="/.test(h) },
  { label: 'twitter:title', test: (h) => /name="twitter:title"[^>]*content="/.test(h) },
  { label: 'twitter:description', test: (h) => /name="twitter:description"[^>]*content="/.test(h) },
  { label: 'twitter:url', test: (h) => /name="twitter:url"[^>]*content="/.test(h) },
  { label: 'meta keywords', test: (h) => /<meta\s+name="keywords"[^>]*content="/.test(h) },
  { label: 'json-ld', test: (h) => /<script type="application\/ld\+json">/i.test(h) },
  { label: 'root div', test: (h) => h.includes('<div id="root"></div>') },
]

export function assertShellTags(shell) {
  const missing = REQUIRED_SHELL_TAGS.filter((t) => !t.test(shell)).map((t) => t.label)
  if (missing.length) {
    throw new Error(
      `index.html is missing tag(s) the /cities prerender rewrites: ${missing.join(', ')}.\n` +
      'The rewrite only replaces existing tags — a missing one would ship a metro page ' +
      "carrying the homepage's metadata (a duplicate-content signal to Google).",
    )
  }
}

/** Google shows about 60 Latin characters of a `<title>`; stay at or under. */
export const EN_TITLE_MAX = 60

/**
 * English city `<title>`. The standard form fits the budget for every metro
 * in the registry (the longest, "San Francisco Bay Area", is 58 characters);
 * a metro whose name would push it past 60 gets the shorter
 * "{City} Kids Activities Map" form instead, for that metro only.
 */
export function enCityTitle(name) {
  const title = `Things to Do With Kids in ${name} | frolicmap`
  return title.length <= EN_TITLE_MAX ? title : `${name} Kids Activities Map | frolicmap`
}

/** English city meta description: the city sentence first, then the full legend. */
export function enCityDescription(name) {
  return `Kids activities in ${name}: ${EN_LEGEND_PROSE}.`
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** `BreadcrumbList` JSON-LD: Home > Cities > {City}, in the page's locale. */
export function cityBreadcrumbLd({ loc, name, url }) {
  const prefix = loc ? loc.prefix : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: loc ? loc.t('breadcrumbHome') : 'Home', item: `${SITE}${prefix}/` },
      { '@type': 'ListItem', position: 2, name: loc ? loc.t('cities') : 'Cities', item: `${SITE}${prefix}/cities` },
      { '@type': 'ListItem', position: 3, name, item: url },
    ],
  }
}

/**
 * Categories eligible to appear as an on-page `?cat=` deep link, sorted
 * by size — the ones with enough places that a pre-filtered map isn't nearly
 * empty. Returned as `{ category, count }` in DB-value terms.
 */
function eligibleCategories(categoryCounts) {
  return Object.entries(categoryCounts)
    .filter(([, n]) => n >= CATEGORY_MIN_PLACES)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }))
}

/**
 * Crawler-visible fallback rendered inside `<div id="root">`.
 *
 * Replaced by React on hydration, so this is written for a crawler and for the
 * fraction of a second before the bundle boots. It carries what the deleted
 * static hub carried — heading, blurb, an overview thumbnail, the category
 * breakdown and a nearby-metros footer — but the category links are `?cat=`
 * deep links into THIS same page (the map, pre-filtered). A category with no
 * rows in the metro is omitted, never linked: filtering an empty layer would
 * show an empty map.
 */
export function cityFallbackHtml({ metro, categoryLinks = [], nearbyMetros = [], loc = null }) {
  const prefix = loc ? loc.prefix : ''
  const name = loc ? loc.metroName(metro) : metro.label
  const tx = loc ? loc.t : null
  const links = categoryLinks
    .map((c) => `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`)
    .join('\n')
  // The full category legend, in an H2 (it left the <title> for the meta
  // description and this heading).
  const legendHeading = tx
    ? tx('cityLegendHeading', { city: name, categories: loc.legend })
    : `${capitalize(EN_LEGEND_PROSE)} in ${name}`
  const nearby = nearbyMetros
    .map((m) => `<li><a href="${prefix}/cities/${esc(m.slug)}">${esc(loc ? loc.metroName(m) : m.label)}</a></li>`)
    .join('\n')

  return `<div style="max-width:64rem;margin:0 auto;padding:2rem 1.25rem;` +
    `font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2937">
  <nav style="font-size:.875rem;color:#6b7280;margin-bottom:1rem">` +
    `<a href="${prefix}/" style="color:#0369a1">${tx ? esc(tx('home')) : 'frolicmap'}</a> › ` +
    `<a href="${prefix}/cities" style="color:#0369a1">${tx ? esc(tx('cities')) : 'Cities'}</a> › ${esc(name)}</nav>
  <h1 style="font-size:1.9rem;line-height:1.2;margin:.25rem 0 .5rem">` +
    `${tx ? esc(tx('cityHeading', { city: name })) : `Kids activities in ${esc(name)}`}</h1>
  ${metro.blurb && !loc ? `<p style="color:#6b7280;margin:0 0 1rem">${esc(metro.blurb)}</p>` : ''}
  <div style="max-width:32rem;margin:0 0 1rem">${renderMapCard({
    metro,
    loc,
    containerStyle: 'border-radius:.5rem;border:1px solid #e5e7eb',
  })}</div>
  <p style="color:#6b7280;margin:0 0 1rem">${tx ? esc(tx('loadingMap')) : 'Loading the interactive map…'}</p>
  <h2 style="font-size:1.25rem;margin:1.5rem 0 .5rem">${esc(legendHeading)}</h2>
  ${links ? `<ul style="list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.5rem">${links}</ul>` : ''}
  ${nearby ? `<h2 style="font-size:1.25rem;margin:1.5rem 0 .5rem">${tx ? esc(tx('nearbyHeading')) : 'Nearby cities'}</h2>
  <ul style="list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.5rem">${nearby}</ul>` : ''}
  <p><a href="${prefix}/cities" style="color:#0369a1">${tx ? esc(tx('browseAll')) : 'Browse all cities →'}</a></p>
  <footer style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;font-size:.8125rem;color:#6b7280">
    <p>${DATA_ATTRIBUTION_HTML}</p>
    ${legalLinksHtml(loc, 'color:#0369a1')}
  </footer>
</div>`
}

/**
 * Rewrite the built SPA shell for one metro's `/cities/{slug}` page.
 * Returns `{ path, html }` in the same shape as the static page renderers.
 *
 * `categoryCounts` is DB-value → count for the categories that have rows in
 * the metro (zero-row categories are simply absent); `nearbyMetros` is a pre-filtered list of published `{ slug, label }`.
 */
export function renderCityShell({
  shell, metro, categoryCounts = {}, categoryPlural = {}, nearbyMetros = [],
  loc = null,
}) {
  // `loc` (see localeCopy.mjs::makeZhContext) switches the page to a
  // non-English locale (#693): `/zh/cities/{slug}`, self-canonical, with the
  // copy sourced from the SPA's own locale slice. Omitted → the English page,
  // byte-for-byte what it was before, plus the hreflang trio.
  const enPath = `/cities/${metro.slug}`
  const path = loc ? `${loc.prefix}${enPath}` : enPath
  const url = `${SITE}${path}`
  const name = loc ? loc.metroName(metro) : metro.label

  const eligible = eligibleCategories(categoryCounts)
  const categoryLinks = eligible.map(({ category, count }) => ({
    // DB value in the query param, not the search-term slug: paths carry
    // search-term slugs, query params carry internal vocabulary (plan §3.2).
    href: `${path}?cat=${esc(category)}`,
    label: `${loc ? loc.categoryLabel(category) : (categoryPlural[category] ?? category)} (${count.toLocaleString()})`,
  }))

  // Short title (<= 60 Latin / ~30 CJK characters, what Google displays); the
  // full category legend lives in the meta description and an on-page H2
  // instead, never as "& More". The blurb still renders in the page body.
  const legendList = loc ? loc.legendList : LEGEND_LIST
  const title = loc ? loc.t('cityTitle', { city: name }) : enCityTitle(name)
  const description = loc
    ? loc.t('cityDescription', { city: name, categories: loc.legend })
    : enCityDescription(name)

  let html = shell
  if (loc) html = html.replace(/<html lang="[^"]*"/, `<html lang="${loc.htmlLang}"`)
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  html = replaceTagContent(html, 'name="description"', 'content', description)
  html = replaceTagContent(html, 'rel="canonical"', 'href', url)
  html = replaceTagContent(html, 'property="og:title"', 'content', title)
  html = replaceTagContent(html, 'property="og:description"', 'content', description)
  html = replaceTagContent(html, 'property="og:url"', 'content', url)
  // The og:image itself stays the shared site card (a map screenshot) —
  // deliberate, see #385. But its alt must not claim "SF Bay Area" on another
  // metro's page: word it as the product per-city, carrying the same full
  // legend list as the title rather than trailing off with "and more".
  html = replaceTagContent(
    html, 'property="og:image:alt"', 'content',
    loc
      ? loc.t('cityImageAlt', { city: name, categories: legendList })
      : `${metro.label} kids activities map on frolicmap.app — ${LEGEND_LIST}.`,
  )
  html = replaceTagContent(html, 'name="twitter:title"', 'content', title)
  html = replaceTagContent(html, 'name="twitter:description"', 'content', description)
  html = replaceTagContent(html, 'name="twitter:url"', 'content', url)
  html = replaceTagContent(
    html, 'name="keywords"', 'content',
    loc
      ? loc.t('cityKeywords', { city: name })
      : `kids activities ${metro.label}, things to do with kids ${metro.label}, family activities ${metro.label}, playgrounds near me, weekend family outings, free kids activities`,
  )
  // Reciprocal hreflang: both locales' pages carry the same trio (en,
  // zh-Hans, x-default → English), placed right after the canonical link.
  html = html.replace(
    /(<link\s+rel="canonical"[^>]*>)/i,
    `$1\n${hreflangLinks(enPath)}`,
  )
  const jsonLd = JSON.stringify(
    [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        url,
        description,
        inLanguage: loc ? loc.htmlLang : 'en',
        isPartOf: { '@type': 'WebSite', name: 'frolicmap.app', url: 'https://frolicmap.app/' },
      },
      cityBreadcrumbLd({ loc, name, url }),
    ],
    null,
    2,
  ).replace(/</g, '\\u003c')
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${jsonLd}</script>`,
  )
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">${cityFallbackHtml({ metro, categoryLinks, nearbyMetros, loc })}</div>`,
  )
  return { path, html }
}
