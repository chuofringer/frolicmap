#!/usr/bin/env node
/**
 * Cross-source dedup + Tier-B pass — issue #355, plan §2.2.
 *
 * Reads one metro's rows out of D1, clusters duplicates across sources, and
 * emits SQL that keeps a canonical row per cluster and archives the rest.
 * Outputs only; applying is a separate explicit step.
 *
 *   node worker/scripts/dedup-national.mjs --metro austin --local --dry-run
 *   node worker/scripts/dedup-national.mjs --metro austin --remote
 *
 * Losers are ARCHIVED, never deleted. `status='archived'` already means "was
 * real, no longer shown" in this schema, the row stays available for audit,
 * and a bad merge is one UPDATE away from being undone. Deleting would make
 * the pass irreversible and lose the evidence needed to tune the thresholds.
 *
 * Per-metro rather than national in one shot: a metro is 5–10K rows, which
 * fits comfortably in a wrangler JSON response, and a failure costs one metro
 * rather than the whole run.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupeRegion } from './lib/dedupPlaces.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')

if (!process.features.typescript && !process.env.__DEDUP_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __DEDUP_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, DEFAULT_REGION, getMetro } = await import('../../shared/metros.ts')

function parseArgs(argv) {
  const args = {
    metros: null, wave: false, all: false, dryRun: false, remote: false,
    includeBay: false,
    outDir: path.join(REPO_ROOT, 'data/dedup'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--wave') args.wave = true
    else if (a === '--all') args.all = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--include-bay') args.includeBay = true
    else if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--out') args.outDir = path.resolve(next())
    else if (a === '--help' || a === '-h') {
      console.log(`
dedup-national.mjs — cross-source dedup + Tier-B (#355)

  --metro <ids>   Comma-separated metro ids.
  --wave          The 12 September wave metros.
  --all           Every metro in the registry.
  --include-bay   Also dedup the 'bay' region. Off by default (the Bay Area was a
                  separate curated layer in the project this repo came from);
                  pass it once the Bay Area has been loaded.
  --local         Read from the LOCAL D1 (default).
  --remote        Read from the REMOTE D1. Read-only; this script never writes.
  --dry-run       Report only, write no SQL file.
  --out <dir>     Output directory (default data/dedup).

Emits SQL that archives duplicate rows and lifts multi-source-confirmed
places to Tier B. Applying is a separate, explicit step.
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
  // Bay guard: every importer skips the Bay Area by default, so this script
  // does too. Same opt-in flag as the importers.
  if (!args.includeBay) {
    const before = list.length
    list = list.filter((m) => m.id !== DEFAULT_REGION)
    if (before !== list.length) {
      console.log(`note: skipping '${DEFAULT_REGION}' — not deduped by default. Pass --include-bay to override.`)
    }
  }
  return list
}

/** Read a region's rows out of D1 via wrangler's JSON output. */
function readRegion(regionId) {
  const sql =
    'SELECT id, name, category, lat, lng, source_type, status, confidence, ' +
    'address, website, opening_hours, description, photo_url, city, attributes ' +
    `FROM items WHERE region='${regionId}' AND status IN ('pending','approved')`
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
  const results = parsed[0]?.results ?? []
  return results.map((r) => ({
    ...r,
    attributes: r.attributes ? safeJson(r.attributes) : null,
  }))
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
/** Collapse all whitespace to single spaces — safe inside a `--` comment. */
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

function buildSql(metro, result, rowCount) {
  const lines = [
    `-- Dedup + Tier-B pass — ${metro.label} (${metro.id}) (#355)`,
    `-- Generated ${new Date().toISOString()} by worker/scripts/dedup-national.mjs`,
    `-- ${rowCount} rows → ${result.archived} archived ` +
      `(${(result.dedupRate * 100).toFixed(1)}%), ${result.tierB} lifted to Tier B`,
    `-- pass 1 (grid+token): ${result.pass1Clusters} clusters; ` +
      `pass 2 (exact-name/near-coord, #398): ${result.pass2Clusters} clusters`,
    '-- Losers are ARCHIVED, not deleted: reversible, and the audit trail survives.',
    '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
    '',
  ]
  for (const m of result.merges) {
    const w = m.winner
    // Name the cluster in a comment. A curator reviewing 12,000 archive
    // statements cannot audit opaque ids; seeing "Zilker Park [parkserve] ←
    // Zilker Metropolitan Park [osm]" makes a bad merge obvious at a glance.
    // Collapse whitespace: some upstream names carry embedded newlines
    // (ParkServe ships "Sullivan Oval Park And Playground\n\nPark"), which
    // would break a `--` comment across lines and leave the remainder as a
    // bare statement the SQL parser chokes on.
    lines.push(
      `-- ${flat(w.name)} [${w.source_type}]` +
      `${m.confidence === 'high' ? ' → Tier B' : ''}` +
      ` ← ${m.losers.map((l) => `${flat(l.name)} [${l.source_type}]`).join(', ')}`,
    )
    const sets = [
      `confidence=${esc(m.confidence)}`,
      ...(m.attributes ? [`attributes=${esc(JSON.stringify(m.attributes))}`] : []),
      ...Object.entries(m.filled).map(([k, v]) => `${k}=${esc(v)}`),
      `updated_at=${esc(new Date().toISOString())}`,
    ]
    lines.push(`UPDATE items SET ${sets.join(', ')} WHERE id=${esc(w.id)};`)
    for (const l of m.losers) {
      // No `AND status!='approved'` guard here, deliberately.
      //
      // The obvious-looking guard is useless at national scale and silently
      // no-ops the entire pass: trusted structured sources auto-approve at
      // import (plan §1.6), so every national row is already `approved` and
      // nothing would ever be archived. The first run of this script archived
      // 0 of 12,054 intended rows for exactly that reason.
      //
      // What actually protects a curator's decision is `mergeCluster`, which
      // sorts an approved row to the front of the cluster. So when any row in
      // a cluster is curator-approved it is the *winner*, and a loser can only
      // be approved when the winner is too — i.e. both are machine-approved
      // duplicates, and archiving one is the whole point.
      lines.push(
        `UPDATE items SET status='archived', updated_at=${esc(new Date().toISOString())} ` +
        `WHERE id=${esc(l.id)};`,
      )
    }
  }
  return lines.join('\n') + '\n'
}

async function main() {
  const metros = selectMetros()
  if (!args.dryRun) mkdirSync(args.outDir, { recursive: true })
  console.log(`dedup: ${metros.length} metro(s), reading ${args.remote ? 'REMOTE' : 'LOCAL'} D1\n`)
  console.log(`${'metro'.padEnd(16)}${'rows'.padStart(7)}${'pass1'.padStart(8)}${'pass2'.padStart(8)}${'archived'.padStart(10)}${'rate'.padStart(8)}${'tierB'.padStart(8)}`)
  console.log('-'.repeat(65))

  let totRows = 0, totArch = 0, totTierB = 0, totP1 = 0, totP2 = 0
  const written = []

  for (const metro of metros) {
    let rows
    try {
      rows = readRegion(metro.id)
    } catch (err) {
      console.log(`${metro.id.padEnd(16)} FAILED: ${err.message}`)
      continue
    }
    if (!rows.length) {
      console.log(`${metro.id.padEnd(16)}${'0'.padStart(7)}   (no rows)`)
      continue
    }
    const result = dedupeRegion(rows)
    totRows += rows.length; totArch += result.archived; totTierB += result.tierB
    totP1 += result.pass1Clusters; totP2 += result.pass2Clusters
    console.log(
      metro.id.padEnd(16) +
      String(rows.length).padStart(7) +
      String(result.pass1Clusters).padStart(8) +
      String(result.pass2Clusters).padStart(8) +
      String(result.archived).padStart(10) +
      `${(result.dedupRate * 100).toFixed(1)}%`.padStart(8) +
      String(result.tierB).padStart(8),
    )
    if (args.dryRun || !result.merges.length) continue
    const outFile = path.join(args.outDir, `${metro.id}.sql`)
    writeFileSync(outFile, buildSql(metro, result, rows.length))
    written.push(outFile)
  }

  console.log('-'.repeat(65))
  console.log(
    'TOTAL'.padEnd(16) + String(totRows).padStart(7) +
    String(totP1).padStart(8) + String(totP2).padStart(8) +
    String(totArch).padStart(10) +
    `${totRows ? (100 * totArch / totRows).toFixed(1) : '0.0'}%`.padStart(8) +
    String(totTierB).padStart(8),
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
