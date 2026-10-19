#!/usr/bin/env node
/**
 * One-off importer: place rows from the owner's older funradar D1 database →
 * frolicmap SQL. Reads one local JSON file and writes local SQL files; it never
 * touches a database or the network. Applying the SQL is a separate, explicit step.
 *
 * Licence boundary: only approved places whose source_type is one of the four
 * open datasets frolicmap already ships (osm, imls, parkserve, nps) are carried
 * over. Scraped, ics-*, bibliocommons, manual and LLM-derived rows are skipped.
 *
 * HOW TO RUN
 *   1. From the funradar repo, export one metro (select only frolicmap's columns):
 *        npx wrangler d1 execute funradar-prod --remote --json --command \
 *          "SELECT id,type,name,name_zh,description,category,lat,lng,address,age_min,age_max,cost,price_usd,indoor,opening_hours,photo_url,photo_attribution,website,source_url,source_type,confidence,status,last_verified,created_at,updated_at,region,city,attributes,slug,has_playground FROM items WHERE type='place' AND status='approved' AND source_type IN ('osm','imls','parkserve','nps') AND region='<metro>'" \
 *          > funradar-<metro>.json
 *      (the wrangler envelope `[{ "results": [...] }]` and a bare array are both accepted)
 *   2. Dry-run to see kept/skipped counts (writes nothing):
 *        node worker/scripts/import-funradar.mjs --json funradar-<metro>.json --dry-run
 *   3. Emit the SQL (add --metro <ids> to restrict):
 *        node worker/scripts/import-funradar.mjs --json funradar-<metro>.json
 *      → data/funradar/<metro>.sql
 *   4. Apply it (review first — these rows land approved):
 *        cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ../data/funradar/<metro>.sql
 *        cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/funradar/<metro>.sql
 *
 * Rows are grouped by their `region`, which must be a metro id from
 * shared/metros.ts (unknown regions are reported and skipped), and rows outside
 * that metro's contentBbox are skipped. Exits non-zero if nothing was kept.
 *
 * Requires Node >= 22.6 for TypeScript type-stripping (imports the metro
 * registry directly rather than keeping a second copy).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildUpsertSet, maxStatementBytes, D1_MAX_STATEMENT_BYTES } from './lib/seedSql.mjs'
import { loadRows, normalizeFunradarRow, buildFunradarSql } from './lib/funradar.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

if (!process.features.typescript && !process.env.__FUNRADAR_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __FUNRADAR_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { getMetro } = await import('../../shared/metros.ts')

function usage() {
  console.log(`
import-funradar.mjs — one-off import of open-source place rows from funradar

  --json <file>      Required. wrangler --json output (envelope) or a bare array of rows.
  --metro <ids>      Comma-separated metro ids — only emit rows for these regions.
  --dry-run          Report kept/skipped counts, write nothing.
  --out <dir>        Output directory (default data/funradar).

Only osm/imls/parkserve/nps places with status approved are kept.
Emits SQL. Applying to any database is a separate, explicit step.
`)
}

function parseArgs(argv) {
  const args = { json: null, metros: null, dryRun: false, outDir: path.join(REPO_ROOT, 'data/funradar') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) { console.error(`${a} needs a value`); process.exit(1) }
      return v
    }
    if (a === '--json') args.json = path.resolve(next())
    else if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--out') args.outDir = path.resolve(next())
    else if (a === '--help' || a === '-h') { usage(); process.exit(0) }
    else { console.error(`unknown flag: ${a}`); usage(); process.exit(1) }
  }
  if (!args.json) { console.error('--json <file> is required'); usage(); process.exit(1) }
  if (args.metros) {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

function main() {
  let rawRows
  try {
    rawRows = loadRows(JSON.parse(readFileSync(args.json, 'utf8')))
  } catch (err) {
    console.error(`FAILED to read ${args.json}: ${err.message}`)
    process.exit(1)
  }
  const source = path.relative(REPO_ROOT, args.json)
  const wanted = args.metros ? new Set(args.metros) : null

  // region -> { kept: Map<id,row>, skipped: {reason: n} }
  const perMetro = new Map()
  const unknownRegions = {}
  let filtered = 0
  const bucket = (id) => {
    if (!perMetro.has(id)) perMetro.set(id, { kept: new Map(), skipped: {} })
    return perMetro.get(id)
  }

  for (const raw of rawRows) {
    const region = typeof raw?.region === 'string' ? raw.region : ''
    const metro = region ? getMetro(region) : undefined
    if (wanted && metro && !wanted.has(metro.id)) { filtered++; continue }

    const res = normalizeFunradarRow(raw, { bbox: metro?.contentBbox ?? null })
    if (res.skip) {
      // Rows from unknown regions still report their real skip reason, under "(unknown)".
      const b = bucket(metro ? metro.id : '(unknown)')
      b.skipped[res.skip] = (b.skipped[res.skip] ?? 0) + 1
      continue
    }
    if (!metro) {
      unknownRegions[region] = (unknownRegions[region] ?? 0) + 1
      continue
    }
    bucket(metro.id).kept.set(res.row.id, res.row)
  }

  console.log(`${args.dryRun ? '[dry-run] ' : ''}funradar import from ${source}`)
  console.log(`read ${rawRows.length} row(s)${filtered ? `, ${filtered} ignored by --metro` : ''}\n`)

  console.log('metro'.padEnd(22) + 'kept'.padStart(7) + '  skipped')
  let totalKept = 0
  const written = []
  const metroIds = [...perMetro.keys()].sort()
  for (const id of metroIds) {
    const { kept, skipped } = perMetro.get(id)
    totalKept += kept.size
    const skipText = Object.entries(skipped).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(' ') || '-'
    console.log(id.padEnd(22) + String(kept.size).padStart(7) + `  ${skipText}`)
  }
  if (Object.keys(unknownRegions).length) {
    console.log('\nunknown region(s) — rows skipped (region must be a metro id in shared/metros.ts):')
    for (const [r, n] of Object.entries(unknownRegions)) console.log(`   ${String(n).padStart(5)}  ${r || '(empty)'}`)
  }
  console.log(`\ntotal kept: ${totalKept}`)

  if (totalKept === 0) { console.error('No rows kept; nothing written.'); process.exit(1) }
  if (args.dryRun) { console.log('[dry-run] nothing written.'); return }

  mkdirSync(args.outDir, { recursive: true })
  for (const id of metroIds) {
    const { kept, skipped } = perMetro.get(id)
    if (!kept.size || id === '(unknown)') continue
    const metro = getMetro(id)
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0)
    const sql = buildFunradarSql([...kept.values()], {
      setClause: buildUpsertSet([
        // Fields buildUpsertSet doesn't know about: never erase a stored value with a NULL.
        'name_zh=COALESCE(excluded.name_zh, items.name_zh)',
        'photo_attribution=COALESCE(excluded.photo_attribution, items.photo_attribution)',
        'has_playground=COALESCE(excluded.has_playground, items.has_playground)',
      ]),
      headerLines: [
        `-- funradar import — ${metro.label} (${metro.id})`,
        `-- Generated ${new Date().toISOString()} from ${source}`,
        `-- ${kept.size} rows kept, ${skippedTotal} skipped (only osm/imls/parkserve/nps approved places are carried over)`,
        '-- UPSERT preserves curator decisions: rejected/archived/approved rows keep their status.',
        '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
      ],
    })
    const biggest = maxStatementBytes(sql)
    if (biggest > D1_MAX_STATEMENT_BYTES) {
      console.error(`${id}: largest statement ${biggest}B exceeds D1's ${D1_MAX_STATEMENT_BYTES}B cap; not written.`)
      process.exit(1)
    }
    const outFile = path.join(args.outDir, `${id}.sql`)
    writeFileSync(outFile, sql)
    written.push(outFile)
  }

  console.log('\nTo apply (review first — these rows land approved):')
  for (const f of written) {
    const rel = path.relative(path.join(REPO_ROOT, 'worker'), f)
    console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ${rel}`)
    console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ${rel}`)
  }
}

main()
