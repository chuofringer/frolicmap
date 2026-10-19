#!/usr/bin/env node
/**
 * Static SEO page generator — issue #356, plan §3.2 (simplified by #387).
 *
 * Reads published metros out of D1 and writes static HTML into the Pages
 * build output, alongside the SPA.
 *
 *   node worker/scripts/build-seo-pages.mjs --remote --out dist
 *   node worker/scripts/build-seo-pages.mjs --metro seattle --local --dry-run
 *
 * The SPA can't rank — Google gets an empty shell — so these pages are the
 * crawlable surface. Since #387 the crawlable surface IS the map: each metro's
 * `/cities/{slug}` page is the built SPA shell with a rewritten head and
 * crawler-visible fallback, so the page a crawler indexes and the page a
 * person lands on are the same bytes. The generator emits exactly:
 *
 *   - `/cities`            — the city index (one card per published metro)
 *   - `/cities/{slug}`     — one prerendered map page per published metro
 *   - sitemaps             — index + one per metro
 *
 * The category pages, place pages and the separate `/map/{slug}` shell that
 * earlier versions emitted are gone (#387): the city page carries the category
 * breakdown itself, as on-page `?cat=` deep links.
 *
 * **Only published metros are emitted.** Same gate as the API (#371): a metro
 * whose data is loaded but which hasn't passed QA must not appear in the
 * sitemap, or Google indexes a metro that was never launched.
 *
 * Never adds a `404.html`: on Pages a static file wins and anything else falls
 * through to the SPA, so a 404 page would kill the SPA fallback that `?cat=`
 * and `?item=` deep links depend on (plan §3.2).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderCitiesIndex, renderSitemap, renderSitemapIndex, nearestMetros,
  HUB_MIN_PLACES, CATEGORY_MIN_PLACES,
} from './lib/seoPages.mjs'
import { renderCityShell, assertShellTags } from './lib/prerenderShell.mjs'
import { formatWranglerError, withRetry } from './lib/wranglerExec.mjs'
import { makeZhContext } from './lib/localeCopy.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')

if (!process.features.typescript && !process.env.__SEO_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __SEO_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro } = await import('../../shared/metros.ts')
const { CATEGORY_PLURAL, CATEGORY_FOLD } = await import('../../shared/categorySlugs.ts')
const { ALL_CATEGORIES } = await import('../../shared/types.ts')

// Chinese pages (#693) take their copy from the SPA's own zh locale slices —
// nothing is duplicated into the generator. Importing the leaf files (not
// `zh/index.ts`, whose extensionless re-exports Node's type-stripping can't
// resolve) keeps this dependency-free: each slice only has a type import.
const { pages: zhPages } = await import('../../src/i18n/zh/pages.ts')
const { categories: zhCategories } = await import('../../src/i18n/zh/categories.ts')
const { metro: zhMetro } = await import('../../src/i18n/zh/metro.ts')
const zh = makeZhContext({
  citySeo: zhPages.citySeo,
  categories: zhCategories,
  names: zhMetro.names,
})

/**
 * Categories a hub page will mention — everything in the vocabulary. Ones
 * without data render as "coming soon" rather than being hidden, so the page
 * carries the search vocabulary and the roadmap stays visible (plan §4B).
 * Folded categories (zoo → the combined "Aquariums/Zoos" entry, #323) never
 * get a line of their own; their counts merge into the host below.
 */
const ALL_PAGE_CATEGORIES = ALL_CATEGORIES.filter(
  (c) => c !== 'event' && !(c in CATEGORY_FOLD),
)

function parseArgs(argv) {
  const args = { metros: null, remote: false, dryRun: false, out: path.join(REPO_ROOT, 'dist') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--out') args.out = path.resolve(next())
    else if (a === '--help' || a === '-h') {
      console.log(`
build-seo-pages.mjs — static SEO page generator (#356)

  --metro <ids>  Restrict to these metros (default: every PUBLISHED metro).
  --remote       Read the REMOTE D1 (default: local).
  --dry-run      Report what would be written; write nothing.
  --out <dir>    Output root (default dist/, the Pages build output).

Emits /cities and one /cities/{metro} map page per metro, their /zh/ twins
(#693), plus sitemaps.
Only published metros are emitted — same gate as the API (#371).
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

function d1(sql) {
  // Retry transient wrangler failures (#654): --remote reads run in the same
  // window the weekly aggregators merge is applying thousands of UPSERTs to
  // the same prod D1, and on 2026-W36 the third d1() call in a --remote run
  // failed mid-write-burst (a rerun of this script succeeded with no other
  // change). 4 attempts / 2s-4s-8s backoff; only a nonzero wrangler exit
  // throws inside the retried closure — a JSON.parse failure on a genuine
  // 0-exit result happens OUTSIDE it below and is never retried, since that
  // indicates a real bug (wrangler's output shape changed) rather than a
  // transient network/lock blip.
  const res = withRetry(
    () => {
      const r = spawnSync(
        'npx',
        ['wrangler', 'd1', 'execute', 'funradar-prod', args.remote ? '--remote' : '--local', '--json', '--command', sql],
        { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false },
      )
      if (r.status !== 0) throw new Error(formatWranglerError(r.stderr, r.status))
      return r
    },
    { attempts: 4, baseMs: 2000 },
  )
  const start = res.stdout.indexOf('[')
  if (start < 0) throw new Error('no JSON in wrangler output')
  return JSON.parse(res.stdout.slice(start))[0]?.results ?? []
}

function write(outRoot, urlPath, contents) {
  // Flat `foo.html`, NOT `foo/index.html`. Cloudflare Pages 301-redirects a
  // no-trailing-slash URL to the trailing-slash form when only an index.html
  // exists, and Search Console then reports every sitemap entry as "Page with
  // redirect" — the sister project hit exactly this and the fix was flat
  // files. Do not "tidy" this into directory-index style.
  const rel = urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}.html`
  const full = path.join(outRoot, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

async function main() {
  let metros = METROS.filter((m) => m.published)
  if (args.metros) {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
    // Still intersect with `published` — a metro that hasn't passed QA must
    // never reach the sitemap, even if someone names it explicitly.
    const wanted = new Set(args.metros)
    const skipped = args.metros.filter((id) => !getMetro(id).published)
    if (skipped.length) console.log(`skipping unpublished metro(s): ${skipped.join(', ')}`)
    metros = metros.filter((m) => wanted.has(m.id))
  }

  if (!metros.length) {
    console.log('no published metros — nothing to generate.')
    console.log('(promote-metro flips `published` once the QA harness passes.)')
    return
  }

  if (!args.dryRun && !existsSync(args.out)) mkdirSync(args.out, { recursive: true })

  // The built SPA shell IS the /cities/{metro} page (with a rewritten head).
  // Read once; a missing dist/index.html means `vite build` hasn't run. The
  // page cannot exist without it, so a real run fails loudly — but a --dry-run
  // still reports what WOULD be generated (the shell isn't needed to know the
  // paths and counts).
  const shellPath = path.join(args.out, 'index.html')
  let shell = null
  if (existsSync(shellPath)) {
    shell = readFileSync(shellPath, 'utf8')
    assertShellTags(shell)
  } else if (args.dryRun) {
    console.log(`note: ${path.relative(REPO_ROOT, shellPath)} not found — dry-run continues (a real run needs it).`)
  } else {
    console.error(`${path.relative(REPO_ROOT, shellPath)} not found.`)
    console.error('The /cities/{metro} page IS the built SPA shell with a rewritten head —')
    console.error('run `npm run build` first so the shell exists to rewrite.')
    process.exit(1)
  }

  // A --metro run regenerates only that subset's per-metro artifacts. The
  // SHARED artifacts (/cities index, /sitemap.xml index, nearby footers)
  // describe the FULL published set — a partial run must never rewrite them
  // from its subset, or `--metro austin` ships a one-card /cities page and a
  // two-entry sitemap index. Footers/eligibility below are therefore always
  // computed over every published metro; the index + sitemap-index writes are
  // skipped on partial runs.
  const partial = !!args.metros
  const publishedAll = METROS.filter((m) => m.published)

  const sitemapPaths = []
  const countsByMetro = {}
  const pinsByMetro = {}
  const renderedMetros = []
  let totalPages = 0

  // Pre-pass: which metros will actually get a page?
  //
  // Nearby-metro footers used to be built from every `published` metro, but a
  // page is only emitted above HUB_MIN_PLACES. A published-but-thin metro
  // therefore received inbound links to a URL that was never written: Pages
  // falls through to the SPA shell, whose canonical still points at `/`, so a
  // crawler is told the city page is a duplicate of the homepage — precisely
  // the failure prerenderShell.mjs calls "the worst possible failure and an
  // invisible one". One cheap grouped count decides eligibility up front —
  // over the FULL published set, so partial runs see the same link graph —
  // and it is the SINGLE source of truth for emission: the per-metro loop
  // must not re-derive eligibility from its own later query, or a count
  // shifting across the two reads (crons + admin write to the same prod D1)
  // reintroduces the linked-but-never-written page.
  const eligibleIds = new Set()
  {
    const ids = publishedAll.map((m) => `'${m.id}'`).join(',')
    const counts = ids
      ? d1(`SELECT region, COUNT(*) n FROM items WHERE status='approved' AND region IN (${ids}) GROUP BY region`)
      : []
    for (const r of counts) if (r.n >= HUB_MIN_PLACES) eligibleIds.add(r.region)
  }
  const linkable = publishedAll.filter((m) => eligibleIds.has(m.id))

  for (const metro of metros) {
    if (!eligibleIds.has(metro.id)) {
      console.log(`${metro.id.padEnd(14)} below the ${HUB_MIN_PLACES}-place threshold, skipped`)
      continue
    }
    // Only category + updated_at are needed now (#387): the city page carries a
    // per-category breakdown as ?cat= deep-link counts, and the newest row
    // dates the sitemap entry. The slug/place-page machinery is gone.
    const rows = d1(
      'SELECT category, updated_at FROM items ' +
      `WHERE region='${metro.id}' AND status='approved'`,
    )

    // Count only LIVE categories: a "coming soon" layer has no map data, so it
    // must never become a ?cat= deep link into an empty filtered view.
    const live = new Set(metro.liveCategories)
    const counts = {}
    for (const r of rows) {
      if (!live.has(r.category)) continue
      // Fold zoo rows into the combined "Aquariums/Zoos" line (#323) — the
      // ?cat= deep link stays the host value; useUrlCategory expands it to
      // the full display group on load.
      const display = CATEGORY_FOLD[r.category] ?? r.category
      counts[display] = (counts[display] ?? 0) + 1
    }

    const cityPath = `/cities/${metro.slug}`
    if (shell) {
      const page = renderCityShell({
        shell,
        metro,
        categoryCounts: counts,
        categoryPlural: CATEGORY_PLURAL,
        // Everything in the vocabulary with no live data → "coming soon".
        // Listed (never linked) so the page carries the search vocabulary and
        // the roadmap stays visible (plan §4B).
        allCategories: ALL_PAGE_CATEGORIES,
        nearbyMetros: nearestMetros(metro, linkable, 4),
      })
      if (!args.dryRun) write(args.out, page.path, page.html)
      // The Chinese twin: /zh/cities/{slug}. Same shell, same eligibility.
      const zhPage = renderCityShell({
        shell,
        metro,
        categoryCounts: counts,
        categoryPlural: CATEGORY_PLURAL,
        allCategories: ALL_PAGE_CATEGORIES,
        nearbyMetros: nearestMetros(metro, linkable, 4),
        loc: zh,
      })
      if (!args.dryRun) write(args.out, zhPage.path, zhPage.html)
      totalPages += 1
    }

    const sitemapPath = `/sitemaps/${metro.slug}.xml`
    if (!args.dryRun) {
      const full = path.join(args.out, sitemapPath.replace(/^\//, ''))
      mkdirSync(path.dirname(full), { recursive: true })
      // lastmod = the newest row in the metro. Coarse but honest: it tracks
      // real data changes rather than build time, which is what makes it
      // useful to a crawler deciding what to re-fetch.
      const lastmod = rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), '')
      writeFileSync(full, renderSitemap([
        { path: cityPath, lastmod: lastmod || undefined },
        // zh twin (#693) — only when the shell exists to have emitted it.
        ...(shell ? [{ path: `${zh.prefix}${cityPath}`, lastmod: lastmod || undefined }] : []),
      ]))
    }
    // A deterministic sample of approved coordinates for the /cities card map
    // overlay (category-coloured dots). The window function samples up to 40
    // rows PER category before capping at 280, so no single dominant category
    // (usually parks/playgrounds) crowds out the others — the card should show
    // that we cover many categories, in their legend colours. ORDER BY id (not
    // RANDOM()) keeps the build reproducible; the renderer drops any that fall
    // outside the card crop. D1 is SQLite and supports window functions.
    //
    // `ORDER BY rn` before the LIMIT is load-bearing: without it SQLite
    // truncates in (category, id) order, so with 11 live categories × 40 rows
    // = 440 candidates against a 280 cap, every category from `playground`
    // onward was cut entirely — the Bay card rendered zero playground dots,
    // the most legend-central colour. Ordering by rank interleaves the
    // categories, so the cap thins each evenly instead of amputating the
    // alphabetic tail. It also makes the result deterministic across builds,
    // which a bare LIMIT is not.
    const pinRows = d1(
      'SELECT lat, lng, category FROM (' +
      'SELECT lat, lng, category, ' +
      'ROW_NUMBER() OVER (PARTITION BY category ORDER BY id) AS rn ' +
      `FROM items WHERE region='${metro.id}' AND status='approved' AND lat IS NOT NULL` +
      ') WHERE rn <= 40 ORDER BY rn, category LIMIT 280',
    )
    pinsByMetro[metro.id] = pinRows.map((r) => ({ lat: r.lat, lng: r.lng, category: r.category }))

    sitemapPaths.push(sitemapPath)
    countsByMetro[metro.id] = rows.length
    renderedMetros.push(metro)
    totalPages += 1
    const deepLinks = Object.values(counts).filter((n) => n >= CATEGORY_MIN_PLACES).length
    console.log(
      `${metro.id.padEnd(14)} ${String(rows.length).padStart(6)} places → ` +
      `${cityPath} (${deepLinks} category deep-link(s))`,
    )
  }

  // /cities — the index page and internal-linking parent for every metro.
  // Skipped on --metro runs: the index and the sitemap INDEX describe the
  // full published set, and this run only queried a subset of it.
  if (partial) {
    console.log('partial --metro run: /cities index and /sitemap.xml left untouched (full run regenerates them)')
  } else if (renderedMetros.length) {
    const index = renderCitiesIndex({ metros: renderedMetros, countsByMetro, pinsByMetro })
    if (!args.dryRun) {
      write(args.out, index.path, index.html)
      const zhIndex = renderCitiesIndex({ metros: renderedMetros, countsByMetro, pinsByMetro, loc: zh })
      write(args.out, zhIndex.path, zhIndex.html)
      const idxSitemap = '/sitemaps/cities.xml'
      const full = path.join(args.out, idxSitemap.replace(/^\//, ''))
      mkdirSync(path.dirname(full), { recursive: true })
      // '/' rides in this sitemap: the homepage was the pre-national
      // sitemap's ONLY entry and silently fell out when the generator took
      // over /sitemap.xml — the site's highest-equity URL should stay
      // declared.
      writeFileSync(full, renderSitemap(['/', index.path, `${zh.prefix}${index.path}`]))
      sitemapPaths.unshift(idxSitemap)
    }
    totalPages += 1
    console.log(`${'/cities'.padEnd(14)} index page → ${renderedMetros.length} city card(s)`)
  }

  if (!partial && !args.dryRun && sitemapPaths.length) {
    writeFileSync(path.join(args.out, 'sitemap.xml'), renderSitemapIndex(sitemapPaths))
  }

  console.log(`\n${totalPages} pages across ${renderedMetros.length} metro(s)`)
  if (args.dryRun) console.log('[dry-run] nothing written.')
  else console.log(`written to ${path.relative(REPO_ROOT, args.out)}/`)
}

await main()
