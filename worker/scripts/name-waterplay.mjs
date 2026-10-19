#!/usr/bin/env node
/**
 * Waterplay naming pass — issue #435 follow-up.
 *
 * Many national OSM waterplay rows ship with a generic fallback name ("Splash
 * pad" / "Water park" — see `shared/osm.ts::fallbackName`) because splash pads
 * and spray grounds are usually mapped as an unnamed feature of a park rather
 * than a named POI. Most of them sit inside or next to a NAMED park/playground
 * we already hold, so this pass lifts the donor's name onto the water feature:
 * "Splash pad" → "Splash pad at Volunteer Park".
 *
 * Reads one metro's rows out of D1 and emits reviewable SQL — one UPDATE per
 * renamed row. Applying is a separate, explicit step; this script NEVER writes
 * to remote.
 *
 *   node worker/scripts/name-waterplay.mjs --metro chicago --local --dry-run
 *   node worker/scripts/name-waterplay.mjs --metro chicago --remote
 *
 * Run it after any OSM waterplay import + dedup pass, per metro.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc } from './lib/seedSql.mjs'
import { nameWaterplayRows } from './lib/nameWaterplay.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')

if (!process.features.typescript && !process.env.__NAMEWP_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __NAMEWP_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro } = await import('../../shared/metros.ts')

// Default donor radius. Donors are park CENTROIDS, so in a large park the
// splash pad legitimately sits several hundred meters from the donor point —
// the 2026-07-21 first pass at 250m left 100 rows donor-less for exactly this
// reason. Overridable via --max-distance for a wider second pass.
const DEFAULT_MAX_DISTANCE_M = 250

function parseArgs(argv) {
  const args = {
    metros: null, wave: false, all: false, dryRun: false, remote: false,
    maxDistanceM: DEFAULT_MAX_DISTANCE_M, revisit: false,
    outDir: path.join(REPO_ROOT, 'data/waterplay-names'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--max-distance') args.maxDistanceM = Number(next())
    else if (a === '--revisit') args.revisit = true
    else if (a === '--wave') args.wave = true
    else if (a === '--all') args.all = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--out') args.outDir = path.resolve(next())
    else if (a === '--help' || a === '-h') {
      console.log(`
name-waterplay.mjs — name generic OSM waterplay rows from nearby parks (#435)

  --metro <ids>   Comma-separated metro ids.
  --wave          The 12 September wave metros.
  --all           Every metro in the registry.
  --local         Read from the LOCAL D1 (default).
  --remote        Read from the REMOTE D1. Read-only; this script never writes.
  --dry-run       Report only, write no SQL file.
  --out <dir>     Output directory (default data/waterplay-names).
  --max-distance <m>  Donor search radius in meters (default 250). Donors are
                  park centroids, so large parks may need a wider pass (500).
  --revisit       Also recompute names a previous pass composed ("Splash pad
                  at X") so improved donor selection supersedes them.
                  Idempotent — unchanged names are skipped.

Emits one UPDATE per renamed row into data/waterplay-names/<metro>.sql.
Applying is a separate, explicit step.
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.metros && !args.wave && !args.all) {
    console.error('one of --metro / --wave / --all is required')
    process.exit(1)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

function selectMetros() {
  let list
  if (args.all) list = METROS
  else if (args.wave) list = METROS.filter((m) => m.wave)
  else {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
    list = METROS.filter((m) => args.metros.includes(m.id))
  }
  return list
}

/** Read a region's rows out of D1 via wrangler's JSON output. */
function readRows(sql) {
  const res = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'frolicmap-prod', args.remote ? '--remote' : '--local',
      '--json', '--command', sql],
    { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false },
  )
  if (res.status !== 0) throw new Error(`wrangler failed: ${(res.stderr || '').slice(0, 300)}`)
  // wrangler prints a banner before the JSON; take from the first bracket.
  const start = res.stdout.indexOf('[')
  if (start < 0) throw new Error('no JSON in wrangler output')
  const parsed = JSON.parse(res.stdout.slice(start))
  return parsed[0]?.results ?? []
}

/**
 * Generic-named waterplay rows for a region. The name filter matches the exact
 * fallback labels case-insensitively (so a real-but-generic "Splash Pad" OSM
 * tag is caught too, per nameWaterplay.isGenericWaterplayName).
 */
function readGenericWaterplay(regionId) {
  // Fetch every waterplay row and let isGenericWaterplayName decide — the
  // token-based detection ("Sprayground", "Splash Park", "water sprinkler")
  // can't be expressed as a SQL IN list, and per-metro waterplay is ≤~150
  // rows so the wider read is cheap.
  const sql =
    "SELECT id, name, lat, lng FROM items " +
    "WHERE category='waterplay' AND source_type='osm' AND status='approved' " +
    `AND region='${regionId}'`
  return readRows(sql)
}

/** Candidate name donors: approved park/playground rows in the region. */
function readDonors(regionId) {
  const sql =
    "SELECT id, name, lat, lng, category FROM items " +
    "WHERE category IN ('park', 'playground') AND status='approved' " +
    `AND region='${regionId}' AND name IS NOT NULL AND name != ''`
  return readRows(sql)
}

/** Collapse whitespace so a name is safe inside a single-line `--` comment. */
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

function buildSql(metro, result, now) {
  const lines = [
    `-- Waterplay naming pass — ${metro.label} (${metro.id}) (#435)`,
    `-- Generated ${now} by worker/scripts/name-waterplay.mjs`,
    `-- ${result.genericCount} generic rows → ${result.renames.length} renamed, ` +
      `${result.noDonor} left alone (no park/playground within ${args.maxDistanceM}m)`,
    '-- Each UPDATE is guarded on status=\'approved\' so it no-ops on a curated/removed row.',
    '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
    '',
  ]
  for (const r of result.renames) {
    lines.push(`-- donor ${r.donorId} '${flat(r.donorName)}' at ${r.distanceM}m`)
    lines.push(
      `UPDATE items SET name=${esc(r.name)}, updated_at=${esc(now)} ` +
      `WHERE id=${esc(r.id)} AND status='approved';`,
    )
  }
  return lines.join('\n') + '\n'
}

async function main() {
  const metros = selectMetros()
  if (!args.dryRun) mkdirSync(args.outDir, { recursive: true })
  console.log(`waterplay naming: ${metros.length} metro(s), reading ${args.remote ? 'REMOTE' : 'LOCAL'} D1\n`)
  console.log(`${'metro'.padEnd(16)}${'generic'.padStart(9)}${'renamed'.padStart(9)}${'no-donor'.padStart(10)}`)
  console.log('-'.repeat(44))

  let totGeneric = 0, totRenamed = 0, totNoDonor = 0
  const written = []
  const now = new Date().toISOString()

  for (const metro of metros) {
    let genericRows, donors
    try {
      genericRows = readGenericWaterplay(metro.id)
      if (genericRows.length) donors = readDonors(metro.id)
      else donors = []
    } catch (err) {
      console.log(`${metro.id.padEnd(16)} FAILED: ${err.message}`)
      continue
    }
    if (!genericRows.length) {
      console.log(`${metro.id.padEnd(16)}${'0'.padStart(9)}   (none)`)
      continue
    }

    const result = nameWaterplayRows(genericRows, donors, {
      maxDistanceM: args.maxDistanceM, revisit: args.revisit,
    })
    totGeneric += result.genericCount
    totRenamed += result.renames.length
    totNoDonor += result.noDonor
    console.log(
      metro.id.padEnd(16) +
      String(result.genericCount).padStart(9) +
      String(result.renames.length).padStart(9) +
      String(result.noDonor).padStart(10),
    )

    if (args.dryRun || !result.renames.length) continue
    const outFile = path.join(args.outDir, `${metro.id}.sql`)
    writeFileSync(outFile, buildSql(metro, result, now))
    written.push(outFile)
  }

  console.log('-'.repeat(44))
  console.log(
    'TOTAL'.padEnd(16) +
    String(totGeneric).padStart(9) +
    String(totRenamed).padStart(9) +
    String(totNoDonor).padStart(10),
  )

  if (args.dryRun) { console.log('\n[dry-run] nothing written.'); return }
  if (written.length) {
    console.log('\nTo apply (review first):')
    for (const f of written) {
      console.log(`  npx wrangler d1 execute frolicmap-prod --remote --file ${path.relative(WORKER_DIR, f)}`)
    }
  }
}

await main()
