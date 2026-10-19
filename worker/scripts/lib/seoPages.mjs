/**
 * Static SEO page rendering — issue #356, plan §3.1 + §3.2.
 *
 * Pure string building: no filesystem, no D1. The generator script handles
 * IO; everything here is testable in isolation.
 *
 * Every page is map-first (plan §3.1 v2): the above-fold call to action is
 * "Open the map", pre-filtered to that page's metro and category. The pages
 * are the funnel; the map is the product.
 */

import { CATEGORY_COLOR } from '../../../shared/categorySlugs.ts'
import { escapeHtml as esc } from './htmlEscape.mjs'
import { hreflangLinks } from './localeCopy.mjs'

/** Amber fallback for a pin whose category isn't in CATEGORY_COLOR. */
const DEFAULT_PIN_COLOR = '#f59e0b'

/**
 * Metro pages live under `/cities/` (2026-07-19). Namespacing them frees the
 * top-level namespace entirely — a metro can no longer collide with `/api`
 * or a `public/` filename — and gives `/cities` a natural index
 * page. Adopted from the sister project's `/risk/{state}/{city}` shape, and
 * free to do now because nothing has been published or indexed yet.
 */
export const CITIES_PREFIX = '/cities'

export const metroPath = (metro) => `${CITIES_PREFIX}/${metro.slug}`

/**
 * Thresholds from plan §3.2.
 *
 * `HUB_MIN_PLACES` — below this a metro has too little to justify a page at
 * all, so no `/cities/{slug}` shell is emitted. `CATEGORY_MIN_PLACES` — below
 * this a category isn't offered as an on-page `?cat=` deep link (the city page
 * IS the map since #387, so a category with a handful of pins deep-links to a
 * near-empty filtered view — worse than not offering the shortcut).
 */
export const HUB_MIN_PLACES = 50
export const CATEGORY_MIN_PLACES = 5

/** JSON-LD must not contain a raw `</script>`; escaping `<` is enough. */
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c')

const SITE = 'https://frolicmap.app'

/**
 * Meta descriptions are truncated by search engines around 155-160 chars.
 * Cut on a word boundary so the snippet ends in a word, not mid-syllable.
 */
export function truncateForMeta(s, max = 158) {
  const flat = String(s).replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—-]$/, '') + '…'
}

/**
 * Social card image. Inherited by every generated page from the SPA's
 * existing asset — the sister project gets this for free because its pages
 * ARE the SPA shell; ours are hand-rolled, so the tags have to be explicit.
 * Without them a shared link renders as a bare text card.
 */
/**
 * Data attribution, on every generated page. OpenStreetMap's ODbL requires
 * the credit to be visible and to link to its copyright page; the other three
 * sources are credited by name. Proper nouns, so the same line serves every
 * locale.
 */
export const DATA_ATTRIBUTION_TEXT =
  'Place data © OpenStreetMap contributors (ODbL) · Institute of Museum and Library Services · ' +
  'National Park Service · Trust for Public Land ParkServe'
export const DATA_ATTRIBUTION_HTML =
  'Place data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL) · ' +
  'Institute of Museum and Library Services · National Park Service · Trust for Public Land ParkServe'

const OG_IMAGE = `${SITE}/og-image.png`
const OG_IMAGE_ALT =
  'frolicmap.app — a map of kid-friendly places: playgrounds, parks, libraries, museums and beaches.'

function layout({ title, description, canonical, body, ld, htmlLang = 'en', enPath = null, footer = null }) {
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${enPath ? hreflangLinks(enPath) + '\n' : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="frolicmap.app">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="/favicon.ico">
<style>
:root{--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--accent:#0369a1}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink)}
.wrap{max-width:64rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
nav{font-size:.875rem;color:var(--muted);margin-bottom:1rem}
nav a{color:var(--muted)}
h1{font-size:1.9rem;line-height:1.2;margin:.25rem 0 .5rem}
h2{font-size:1.25rem;margin:2rem 0 .75rem}
.lede{color:var(--muted);margin:0 0 1rem}
.meta{color:var(--muted);font-size:.9375rem;margin:0 0 1.25rem}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
  padding:.7rem 1.1rem;border-radius:.5rem;font-weight:600}
.dot{position:absolute;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;
  box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));padding:0;list-style:none}
.card{border:1px solid var(--line);border-radius:.5rem;padding:.75rem .9rem}
.card a{text-decoration:none;color:var(--ink);font-weight:600}
.card p{margin:.25rem 0 0;font-size:.875rem;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;padding:0;list-style:none}
.chips a{display:inline-block;border:1px solid var(--line);border-radius:999px;
  padding:.35rem .8rem;text-decoration:none;color:var(--ink);font-size:.9rem}
.cities{display:grid;gap:1.25rem;grid-template-columns:1fr;
  padding:0;list-style:none;margin:1.5rem 0 0}
@media(min-width:64rem){.cities{grid-template-columns:repeat(3,1fr)}}
.cities a{display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);
  border-radius:.75rem;overflow:hidden;background:#fff}
.cities a:hover{border-color:var(--accent)}
.citymap{display:block;width:100%}
.city-name{display:block;padding:.7rem .85rem 0;font-weight:600;font-size:1.05rem}
.city-count{display:block;padding:.1rem .85rem .8rem;font-size:.85rem;color:var(--muted)}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);
  font-size:.8125rem;color:var(--muted)}
a{color:var(--accent)}
</style>
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}
</head>
<body><div class="wrap">
${body}
<footer>
  ${footer ?? '<p><a href="/">frolicmap.app</a> — a map of kids activities.</p>'}
  <p class="attribution">${DATA_ATTRIBUTION_HTML}</p>
</footer>
</div></body>
</html>
`
}

/**
 * Slippy-tile coordinates for a lat/lng — used to pick one basemap tile as a
 * city thumbnail.
 */
export function tileXY(lat, lng, z) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  )
  return { x, y, z }
}

/**
 * Thumbnail for a city card: a single USGS Topo (The National Map, US public
 * domain, keyless) raster tile centred on the metro.
 *
 * Chosen over photography deliberately. We hold no photo rights for city
 * imagery, and licensing 50 city photos is a real cost
 * and a real legal risk. A map tile is free, needs no rights clearance, is
 * visually distinct per city, and is honest about what the product is. The
 * tiles are public domain; the OSM credit in every footer covers the data.
 *
 * z=10 puts roughly a metro in one 256px tile.
 */
export function cityThumbUrl(metro, z = 10) {
  const { x, y } = tileXY(metro.initialView.latitude, metro.initialView.longitude, z)
  return `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${z}/${y}/${x}`
}

/* ────────────────────────────────────────────────────────────────────────
 * Centered map-card composite (issue: /cities index overhaul).
 *
 * The single-tile `cityThumbUrl` above lands the metro wherever it falls
 * inside one slippy tile's grid — off-center by construction. The card image
 * is instead a CSS composite: a fixed-aspect container with the 4–9 USGS Topo
 * tiles that cover it absolutely positioned so the metro center sits dead
 * center, plus approved-place pins projected on top. Pure web-mercator
 * arithmetic — no canvas, no server-side raster.
 *
 * Everything below is expressed as PERCENTAGES of a reference card of
 * CARD_W×CARD_H so the markup scales with whatever size the responsive grid
 * renders the card at, as long as the container keeps the 4:3 aspect ratio.
 * ──────────────────────────────────────────────────────────────────────── */

/** Reference card image dimensions (CSS px) the composite is laid out against. */
export const CARD_W = 512
export const CARD_H = 384

/** Web-mercator normalized world position in [0,1]×[0,1] for a lat/lng. */
export function mercatorNormXY(lat, lng) {
  const x = (lng + 180) / 360
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  return { x, y }
}

/** Center `{lat, lng}` of a `{south, west, north, east}` bbox. */
export function bboxCenter(bbox) {
  return { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 }
}

/** `viewportBounds` ([[w,s],[e,n]]) → `{south, west, north, east}`. */
export function boundsToBbox(vb) {
  return { west: vb[0][0], south: vb[0][1], east: vb[1][0], north: vb[1][1] }
}

/**
 * The largest integer zoom at which `bbox` fits inside a `cardW×cardH` image.
 *
 * The web-mercator pixel span of the bbox doubles with each zoom level; we
 * want the deepest zoom (biggest map, most detail) whose span still fits both
 * axes. A huge bbox therefore resolves to a *smaller* zoom.
 */
export function fitZoom(bbox, cardW = CARD_W, cardH = CARD_H, minZoom = 2, maxZoom = 16) {
  const nw = mercatorNormXY(bbox.north, bbox.west)
  const se = mercatorNormXY(bbox.south, bbox.east)
  const dx = Math.abs(se.x - nw.x)
  const dy = Math.abs(se.y - nw.y)
  const zx = dx > 0 ? Math.log2(cardW / (dx * 256)) : maxZoom
  const zy = dy > 0 ? Math.log2(cardH / (dy * 256)) : maxZoom
  let z = Math.floor(Math.min(zx, zy))
  if (!Number.isFinite(z)) z = maxZoom
  return Math.max(minZoom, Math.min(maxZoom, z))
}

/**
 * Project a `{lat, lng}` point to `{xPct, yPct, visible}` within a card whose
 * center is `center` at `zoom`. `xPct`/`yPct` are 0–100 across the card;
 * `visible` is whether the point falls inside the [0,100]% crop.
 */
export function projectToCard(point, center, zoom, cardW = CARD_W, cardH = CARD_H) {
  const scale = 256 * 2 ** zoom
  const p = mercatorNormXY(point.lat, point.lng)
  const c = mercatorNormXY(center.lat, center.lng)
  const xPct = (((p.x - c.x) * scale + cardW / 2) / cardW) * 100
  const yPct = (((p.y - c.y) * scale + cardH / 2) / cardH) * 100
  return { xPct, yPct, visible: xPct >= 0 && xPct <= 100 && yPct >= 0 && yPct <= 100 }
}

/**
 * The slippy tiles covering a `cardW×cardH` card centered on `center` at
 * `zoom`, each with its top-left position and size as percentages of the card.
 */
export function tileLayout(center, zoom, cardW = CARD_W, cardH = CARD_H) {
  const scale = 256 * 2 ** zoom
  const n = 2 ** zoom
  const c = mercatorNormXY(center.lat, center.lng)
  const originX = c.x * scale - cardW / 2
  const originY = c.y * scale - cardH / 2
  const txMin = Math.floor(originX / 256)
  const txMax = Math.floor((originX + cardW) / 256)
  const tyMin = Math.floor(originY / 256)
  const tyMax = Math.floor((originY + cardH) / 256)
  const tiles = []
  for (let ty = tyMin; ty <= tyMax; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = txMin; tx <= txMax; tx++) {
      tiles.push({
        z: zoom,
        x: ((tx % n) + n) % n, // wrap longitude at the antimeridian
        y: ty,
        leftPct: ((tx * 256 - originX) / cardW) * 100,
        topPct: ((ty * 256 - originY) / cardH) * 100,
        wPct: (256 / cardW) * 100,
        hPct: (256 / cardH) * 100,
      })
    }
  }
  return tiles
}

const pctFmt = (n) => Number(n.toFixed(3)).toString()

/**
 * Centered USGS-Topo-tile composite for one metro, with approved-place pins as
 * category-coloured dots. Self-contained: aspect-ratio + inline-positioned
 * children, so it renders identically inside the CSS-classed index grid and the
 * inline-styled `/cities/{slug}` fallback shell.
 *
 * Dots reuse the `.dot` class from the `layout()` stylesheet for their shared
 * styling (size, offset, ring); only per-dot `left`/`top`/`background` are
 * inlined, keeping the page weight sane with ~280 pins/metro. The class only
 * exists on the `/cities` index — but the fallback shells pass no pins, so a
 * zero-pin card emits no `.dot` markup and needs no stylesheet.
 *
 * `pins` is `[{lat, lng, category?}]`; the dot colour is `CATEGORY_COLOR[category]`
 * (amber fallback for a missing/unknown category). Points outside the visible
 * crop are dropped.
 */
export function renderMapCard({
  metro, pins = [], cardW = CARD_W, cardH = CARD_H, className = 'citymap', containerStyle = '',
  loc = null,
}) {
  const bbox = boundsToBbox(metro.viewportBounds)
  const zoom = fitZoom(bbox, cardW, cardH)
  const center = bboxCenter(bbox)

  const tiles = tileLayout(center, zoom, cardW, cardH)
    .map((t) =>
      `<img src="https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${t.z}/${t.y}/${t.x}" alt="" ` +
      `aria-hidden="true" loading="lazy" style="position:absolute;` +
      `left:${pctFmt(t.leftPct)}%;top:${pctFmt(t.topPct)}%;` +
      `width:${pctFmt(t.wPct)}%;height:${pctFmt(t.hPct)}%">`)
    .join('')

  const dots = pins
    .map((p) => ({
      ...projectToCard({ lat: Number(p.lat), lng: Number(p.lng) }, center, zoom, cardW, cardH),
      color: CATEGORY_COLOR[p.category] ?? DEFAULT_PIN_COLOR,
    }))
    .filter((d) => d.visible)
    .map((d) =>
      `<span class="dot" aria-hidden="true" style="` +
      `left:${pctFmt(d.xPct)}%;top:${pctFmt(d.yPct)}%;background:${d.color}"></span>`)
    .join('')

  return `<div class="${className}" role="img" aria-label="${esc(loc ? loc.t('mapAriaLabel', { city: loc.metroName(metro) }) : `Map of ${metro.label}`)}" ` +
    `style="position:relative;overflow:hidden;aspect-ratio:${cardW}/${cardH};` +
    `background:#eef2f5;${containerStyle}">${tiles}${dots}</div>`
}

/**
 * Deliberately imprecise place count for a card or the total line. We never
 * publish an exact figure — it goes stale between builds and invites
 * comparison. n≥1000 → "5k+ places"; 100≤n<1000 → "700+ places" (floored to
 * the hundred); n<100 → null (the card omits the count line entirely).
 */
export function roundedPlaces(n, loc = null) {
  const count = roundedCount(n)
  if (count === null) return null
  return loc ? loc.t('placesApprox', { count }) : `${count}+ places`
}

/** The bare rounded figure ("5k", "700"), or null under 100. */
export function roundedCount(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1000) return `${Math.floor(n / 1000)}k`
  if (n >= 100) return `${Math.floor(n / 100) * 100}`
  return null
}

/** Great-circle distance in km between two `{latitude, longitude}` points. */
function haversineKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * The nearest metros to `metro`, by great-circle distance between initial-view
 * centres.
 *
 * Pass only the metros you want linkable as `candidates` — the generator passes
 * the PUBLISHED set, so an unlaunched neighbour can never leak into a
 * nearby-metros footer. Derived from the registry coordinates rather than a
 * hand-maintained adjacency table: adding a metro reshuffles everyone's
 * neighbours for free, and there's no second list to keep in sync.
 */
export function nearestMetros(metro, candidates, limit = 4) {
  return candidates
    .filter((m) => m.id !== metro.id)
    .map((m) => ({ metro: m, km: haversineKm(metro.initialView, m.initialView) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((x) => x.metro)
}

/**
 * `/cities` — the index of every published metro.
 *
 * Both the human welcome page and the internal-linking hub that gives every
 * metro page a parent. Only published metros appear: an unpublished metro is
 * gated at the API (#371) and excluded from the sitemap, so linking it here
 * would be the one place that leaked it.
 */
export function renderCitiesIndex({ metros, countsByMetro = {}, pinsByMetro = {}, loc = null }) {
  const total = Object.values(countsByMetro).reduce((a, b) => a + b, 0)
  // Full legend enumeration, never "& More" (locked vocabulary rule). Title
  // uses the singular legend labels; prose lowercases and pluralizes.
  const enTitle =
    'Kids Activities by City — Playground, Park, Library, Museum, Aquarium/Zoo, ' +
    'Beach, Water Play, Hiking & Campground'
  const enDescription = truncateForMeta(
    'Interactive maps of playgrounds, parks, libraries, museums, aquariums/zoos, beaches, ' +
    'water play, hiking and campgrounds — free to use.',
  )
  const prefix = loc ? loc.prefix : ''
  const title = loc ? loc.t('indexTitle', { categories: loc.legendList }) : enTitle
  const description = loc
    ? truncateForMeta(loc.t('indexDescription', { categories: loc.legendList }))
    : enDescription

  const cards = metros.map((m) => {
    const count = roundedPlaces(countsByMetro[m.id], loc)
    return `  <li class="city">
    <a href="${prefix}${metroPath(m)}">
      ${renderMapCard({ metro: m, pins: pinsByMetro[m.id] ?? [], loc })}
      <span class="city-name">${esc(loc ? loc.metroName(m) : m.label)}</span>
      ${count ? `<span class="city-count">${count}</span>` : ''}
    </a>
  </li>`
  }).join('\n')

  const totalLine = roundedPlaces(total, loc)
  const body = loc ? `
<nav><a href="${prefix}/">${esc(loc.t('home'))}</a> › ${esc(loc.t('cities'))}</nav>
<h1>${esc(loc.t('indexHeading'))}</h1>
<p class="lede">${esc(loc.t('indexLede', { categories: loc.legendList }))}</p>
${totalLine ? `<p class="meta">${esc(loc.t('indexTotal', { count: `${roundedCount(total)}+`, metros: metros.length }))}</p>` : ''}
<ul class="cities">
${cards}
</ul>` : `
<nav><a href="/">frolicmap</a> › Cities</nav>
<h1>Kids activities by city</h1>
<p class="lede">Interactive maps of playgrounds, parks, libraries, museums, aquariums/zoos,
beaches, water play, hiking and campgrounds — built for parents
deciding where to go this weekend.</p>
${totalLine ? `<p class="meta">${totalLine} across ${metros.length}
${metros.length === 1 ? 'metro' : 'metros'}.</p>` : ''}
<ul class="cities">
${cards}
</ul>`

  return {
    path: `${prefix}${CITIES_PREFIX}`,
    html: layout({
      title, description, canonical: `${SITE}${prefix}${CITIES_PREFIX}`, body,
      htmlLang: loc ? loc.htmlLang : 'en',
      enPath: CITIES_PREFIX,
      footer: loc ? `<p><a href="${prefix}/">frolicmap.app</a> — ${esc(loc.t('footer'))}</p>` : null,
      ld: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: title,
        numberOfItems: metros.length,
        itemListElement: metros.map((m, i) => ({
          '@type': 'ListItem', position: i + 1, name: loc ? loc.metroName(m) : m.label,
          url: `${SITE}${prefix}${metroPath(m)}`,
        })),
      },
    }),
  }
}

/**
 * Per-page crawl hints, by page kind.
 *
 * `lastmod` is what Google uses to prioritise recrawls; the tiers set how
 * often each kind's content actually changes. Since #387 there are only two
 * kinds: the `/cities` index and the per-metro `/cities/{slug}` map page. The
 * city page's place counts shift as imports land, so it carries the higher
 * changefreq the old map-shell tier had.
 */
const PAGE_HINTS = {
  // The homepage — the live map, the site's highest-equity URL. The
  // pre-national sitemap's single entry was exactly this; it must not fall
  // out of the sitemap just because the generator took over the file.
  home: { changefreq: 'daily', priority: '1.0' },
  index: { changefreq: 'weekly', priority: '1.0' },
  city: { changefreq: 'weekly', priority: '0.9' },
}

export function pageKindFor(path) {
  // The zh mirror (#693) carries the same hints as its English twin.
  if (path.startsWith('/zh/')) path = path.slice(3)
  if (path === '/') return 'home'
  if (path === CITIES_PREFIX) return 'index'
  // Everything else the generator emits is a `/cities/{slug}` map page.
  return 'city'
}

/**
 * Sitemap for one metro; the index stitches them together.
 *
 * `entries` may be plain path strings or `{ path, lastmod }` — the generator
 * passes the newest `updated_at` among a page's rows so recrawl priority
 * tracks real data changes rather than build time.
 */
export function renderSitemap(entries) {
  const rows = entries.map((e) => (typeof e === 'string' ? { path: e } : e))
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.map(({ path, lastmod }) => {
  const hint = PAGE_HINTS[pageKindFor(path)]
  return '  <url>' +
    `<loc>${SITE}${esc(path)}</loc>` +
    (lastmod ? `<lastmod>${esc(String(lastmod).slice(0, 10))}</lastmod>` : '') +
    `<changefreq>${hint.changefreq}</changefreq>` +
    `<priority>${hint.priority}</priority>` +
    '</url>'
}).join('\n')}
</urlset>
`
}

export function renderSitemapIndex(sitemapPaths) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <sitemap><loc>${SITE}${esc(p)}</loc></sitemap>`).join('\n')}
</sitemapindex>
`
}
