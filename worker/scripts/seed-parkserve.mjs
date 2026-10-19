#!/usr/bin/env node
/**
 * ParkServe importer — plan §2.1 row 4, issue #354.
 *
 * Queries the Trust for Public Land's public ArcGIS FeatureServer per metro
 * bbox and emits SQL. Outputs only; never writes to a remote database.
 *
 *   node worker/scripts/seed-parkserve.mjs --metro austin --dry-run
 *   node worker/scripts/seed-parkserve.mjs --wave
 *
 * Live query rather than the ZIP download (plan §2.1 said "CSV"): the
 * FeatureServer serves the same park inventory with a documented schema, is
 * queryable by bbox so we never handle national-scale files, and matches the
 * repo's existing ArcGIS ingest precedent (`local-cityparks-ingest.mjs`).
 * Centroids come from the service via `returnCentroid=true`, so no polygon
 * handling is needed — exactly the "centroids + amenity flags only" scope.
 *
 * NOT covered here: playground/trail amenity flags. Those live in separate
 * layers in the ZIP download, not in this feature service (the one public
 * ArcGIS playgrounds layer is a third-party regional subset with no national
 * coverage — 0 features in Austin). `attributes` is a JSON blob precisely so
 * a `playground` flag can be grafted on later without touching row identity.
 *
 * Requires Node >= 22.6 for TypeScript type-stripping (imports the metro
 * registry directly rather than keeping a second copy).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildImportSql, buildUpsertSet, maxStatementBytes, D1_MAX_STATEMENT_BYTES } from './lib/seedSql.mjs'
import { PS_OUT_FIELDS, PS_WHERE, parkserveFeatureToItem } from './lib/parkserve.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

if (!process.features.typescript && !process.env.__PARKSERVE_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __PARKSERVE_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, DEFAULT_REGION, getMetro, metroForCoords } = await import('../../shared/metros.ts')

const SERVICE =
  'https://services9.arcgis.com/90v9hhDSTUTen7c9/arcgis/rest/services/Parks_Project_web/FeatureServer/0/query'
// The service advertises maxRecordCount 2000; page at that size.
const PAGE = 2000

const VALID_STATUS = ['pending', 'approved', 'rejected', 'archived']
const VALID_CONFIDENCE = ['high', 'medium', 'low']

function parseArgs(argv) {
  const args = {
    metros: null, wave: false, dryRun: false, includeBay: false,
    status: 'approved', confidence: 'medium', throttleMs: 500,
    outDir: path.join(REPO_ROOT, 'data/parkserve'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) { console.error(`${a} needs a value`); process.exit(1) }
      return v
    }
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--wave') args.wave = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--include-bay') args.includeBay = true
    else if (a === '--status') args.status = next()
    else if (a === '--confidence') args.confidence = next()
    else if (a === '--throttle-ms') args.throttleMs = Number(next())
    else if (a === '--out') args.outDir = path.resolve(next())
    else if (a === '--help' || a === '-h') { usage(); process.exit(0) }
    else { console.error(`unknown flag: ${a}`); usage(); process.exit(1) }
  }
  if (!VALID_STATUS.includes(args.status)) {
    console.error(`--status must be one of: ${VALID_STATUS.join(', ')}`); process.exit(1)
  }
  if (!VALID_CONFIDENCE.includes(args.confidence)) {
    console.error(`--confidence must be one of: ${VALID_CONFIDENCE.join(', ')}`); process.exit(1)
  }
  return args
}

function usage() {
  console.log(`
seed-parkserve.mjs — TPL ParkServe park importer (#354)

  --metro <ids>      Comma-separated metro ids (default: every metro).
  --wave             Only the 12 September wave metros.
  --dry-run          Fetch + report, write nothing.
  --include-bay      Emit Bay Area rows too. Off by default — the Bay park layer
                     is already curated and these would double-pin the flagship map.
  --status <s>       Row status (default approved — trusted source, Tier C).
  --confidence <c>   Row confidence (default medium — Tier C, plan §1.6).
  --throttle-ms <n>  Delay between paged requests (default 500).
  --out <dir>        Output directory (default data/parkserve).

Emits SQL. Applying to any database is a separate, explicit step.
`)
}

const args = parseArgs(process.argv.slice(2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function selectMetros() {
  let list = METROS
  if (args.wave) list = list.filter((m) => m.wave)
  if (args.metros) {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) {
      console.error(`unknown metro id(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
    const wanted = new Set(args.metros)
    list = list.filter((m) => wanted.has(m.id))
  }
  if (!args.includeBay) list = list.filter((m) => m.id !== DEFAULT_REGION)
  return list
}

/** One page of features for a metro bbox. */
async function fetchPage(metro, offset) {
  const { south, west, north, east } = metro.contentBbox
  const params = new URLSearchParams({
    where: PS_WHERE,
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    // Coordinates MUST come back in WGS84; the service defaults to Web
    // Mercator, and the mapper rejects those loudly rather than writing
    // metres into a lat column.
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: PS_OUT_FIELDS,
    returnCentroid: 'true',
    returnGeometry: 'false',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: 'json',
  })
  const res = await fetch(`${SERVICE}?${params}`, {
    headers: { 'user-agent': 'funradar-app/parkserve-import (+https://funradar.app)' },
  })
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message}`)
  return { features: json.features ?? [], exceeded: json.exceededTransferLimit === true }
}

async function fetchMetro(metro) {
  const all = []
  let offset = 0
  for (;;) {
    const { features, exceeded } = await fetchPage(metro, offset)
    all.push(...features)
    // `exceededTransferLimit` is the service's own "there's more"; a short
    // page also means the end. Checking both avoids an infinite loop if the
    // flag is absent.
    if (!exceeded || features.length === 0) break
    offset += features.length
    await sleep(args.throttleMs)
  }
  return all
}

async function main() {
  const metros = selectMetros()
  if (!metros.length) { console.error('no metros selected'); process.exit(1) }
  if (!args.dryRun) mkdirSync(args.outDir, { recursive: true })

  console.log(`${args.dryRun ? '[dry-run] ' : ''}ParkServe: ${metros.length} metro(s)`)
  console.log(`tier: confidence='${args.confidence}' status='${args.status}'\n`)

  const written = []
  let grand = 0

  for (const metro of metros) {
    process.stdout.write(`${metro.label.padEnd(24)} `)
    let features
    try {
      features = await fetchMetro(metro)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      continue
    }

    const byId = new Map()
    const skipped = {}
    for (const f of features) {
      const r = parkserveFeatureToItem(f, metroForCoords, {
        status: args.status,
        confidence: args.confidence,
        skipRegions: args.includeBay ? new Set() : new Set([DEFAULT_REGION]),
      })
      if (r.skipped) { skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1; continue }
      byId.set(r.row.id, r.row)
    }
    const rows = [...byId.values()]
    grand += rows.length

    const topSkip = Object.entries(skipped).sort((a, b) => b[1] - a[1])[0]
    console.log(
      `${String(features.length).padStart(6)} features → ${String(rows.length).padStart(6)} rows` +
      `${topSkip ? `  (top skip: ${topSkip[1]} ${topSkip[0]})` : ''}`,
    )

    if (!rows.length || args.dryRun) continue

    const sql = buildImportSql(rows, {
      setClause: buildUpsertSet(['cost=excluded.cost', 'indoor=excluded.indoor']),
      headerLines: [
        `-- ParkServe import — ${metro.label} (${metro.id}) (#354)`,
        `-- Generated ${new Date().toISOString()} from the TPL ParkServe ArcGIS FeatureServer`,
        `-- ${features.length} features → ${rows.length} rows (Open Access + visitable status only)`,
        `-- Tier C: confidence='${args.confidence}', status='${args.status}'`,
        '-- UPSERT preserves curator decisions: rejected/archived/approved rows keep their status.',
        '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
      ],
    })
    const outFile = path.join(args.outDir, `${metro.id}.sql`)
    writeFileSync(outFile, sql)
    written.push(outFile)
    const biggest = maxStatementBytes(sql)
    if (biggest > D1_MAX_STATEMENT_BYTES) console.log(`   ⚠️ largest statement ${biggest}B exceeds D1's cap`)
  }

  console.log(`\ntotal: ${grand} rows across ${metros.length} metro(s)`)
  if (args.dryRun) { console.log('[dry-run] nothing written.'); return }
  if (written.length) {
    console.log('\nTo apply (review first — these rows land approved):')
    for (const f of written) {
      console.log(`  npx wrangler d1 execute funradar-prod --remote --file ${path.relative(path.join(REPO_ROOT, 'worker'), f)}`)
    }
  }
}

await main()
