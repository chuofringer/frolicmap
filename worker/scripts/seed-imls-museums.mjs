#!/usr/bin/env node
/**
 * IMLS museum importer — plan §2.1 row 3, issue #353.
 *
 * Reads the Museum Data Files and emits SQL. Outputs only; this script never
 * touches a database.
 *
 *   # Download "CSV Data Files (ZIP)" from
 *   #   https://www.imls.gov/research-evaluation/data/museum-data-files
 *   # and unzip — three files, split by discipline. Pass each in turn, or
 *   # concatenate them (they share a header layout).
 *   node worker/scripts/seed-imls-museums.mjs --csv ~/Downloads/MuseumFile2018_File1.csv
 *
 * ⚠️  SOURCE VINTAGE — read before applying to production.
 *
 * The Museum Data Files are a RETIRED dataset. IMLS's own page states the
 * initiative was "last updated in 2018" and that "IMLS has no plans to update
 * the museum files." There is no successor dataset. Everything this importer
 * emits is therefore an 8-year-old snapshot: museums that closed, moved, or
 * renamed since 2018 will be wrong, and nothing upstream will ever correct
 * them.
 *
 * Because of that, rows default to `status='pending'` rather than the
 * `approved` the plan's trusted-source rule (§1.6) grants current datasets.
 * Auto-publishing stale venue data is the "trust-eroding bug (stale data)"
 * failure the repo's own P0 banding calls out — a family driving to a museum
 * that closed in 2021 is the worst outcome this product has.
 *
 * Pass `--status approved` to override once you've decided how to handle the
 * vintage. Note that OSM already supplies museums nationally via the #352
 * bootstrap (`tourism=museum`), so this importer is additive coverage rather
 * than the sole source, and #355's dedup pass will merge the overlap.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './lib/csv.mjs'
import {
  MDF_COLUMNS, MDF_CATEGORY_BY_DISCIPLINE, assertColumns, museumRowToItem,
  buildSeedSql, collect,
} from './lib/imls.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

const VINTAGE_NOTE =
  'Source: IMLS Museum Data Files (2018 release — retired dataset, not updated since). Verify before visit.'

if (!process.features.typescript && !process.env.__IMLS_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __IMLS_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { metroForCoords, DEFAULT_REGION } = await import('../../shared/metros.ts')

const VALID_STATUS = ['pending', 'approved', 'rejected', 'archived']
const VALID_CONFIDENCE = ['high', 'medium', 'low']

// Validate at parse time, not at apply time. `--status aproved` would
// otherwise generate a whole file that fails D1's CHECK constraint partway
// through, after earlier chunks had already landed.
function validateTier(args) {
  if (!VALID_STATUS.includes(args.status)) {
    console.error(`--status must be one of: ${VALID_STATUS.join(', ')} (got '${args.status}')`)
    process.exit(1)
  }
  if (!VALID_CONFIDENCE.includes(args.confidence)) {
    console.error(`--confidence must be one of: ${VALID_CONFIDENCE.join(', ')} (got '${args.confidence}')`)
    process.exit(1)
  }
}

function parseArgs(argv) {
  const args = {
    csv: [], out: path.join(REPO_ROOT, 'data/imls/museums.sql'),
    // Deliberately NOT 'approved' — see the vintage warning above.
    status: 'pending', confidence: 'low', dryRun: false, limit: null, includeBay: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--csv') args.csv.push(path.resolve(next()))
    else if (a === '--out') args.out = path.resolve(next())
    else if (a === '--status') args.status = next()
    else if (a === '--confidence') args.confidence = next()
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--include-bay') args.includeBay = true
    else if (a === '--limit') args.limit = Number(next())
    else if (a === '--help' || a === '-h') {
      console.log(`
seed-imls-museums.mjs — IMLS Museum Data Files importer (#353)

  --csv <path>        MDF CSV (repeatable — the release ships three files)
  --out <path>        Output SQL (default data/imls/museums.sql)
  --status <s>        Row status (default PENDING — the 2018 dataset is retired;
                      see the vintage warning at the top of this file)
  --confidence <c>    Row confidence (default low — 8-year-old snapshot)
  --dry-run           Report only; write nothing
  --include-bay       Emit Bay Area rows too. Off by default (the Bay Area was a separate
                      curated layer in the project this repo came from); pass it to
                      load the Bay Area from this source
  --limit <n>         Process only the first n records per file

Kept disciplines: ${Object.entries(MDF_CATEGORY_BY_DISCIPLINE).map(([d, c]) => `${d}→${c}`).join(', ')}
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.csv.length) { console.error('--csv is required (see --help)'); process.exit(1) }
  validateTier(args)
  return args
}

const args = parseArgs(process.argv.slice(2))

let totalRead = 0
const allResults = []
for (const file of args.csv) {
  const { headers, rows } = parseCsv(readFileSync(file, 'utf8'))
  assertColumns(headers, MDF_COLUMNS, path.basename(file))
  const source = args.limit ? rows.slice(0, args.limit) : rows
  totalRead += rows.length
  for (const rec of source) {
    allResults.push(museumRowToItem(rec, metroForCoords, {
      status: args.status,
      confidence: args.confidence,
      vintageNote: VINTAGE_NOTE,
      skipRegions: args.includeBay ? new Set() : new Set([DEFAULT_REGION]),
    }))
  }
}

const { rows: items, skipped } = collect(allResults)

const byId = new Map()
let dupes = 0
for (const r of items) {
  if (byId.has(r.id)) dupes++
  byId.set(r.id, r)
}
const final = [...byId.values()]

const byCategory = {}
for (const r of final) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
const byRegion = {}
for (const r of final) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1

console.log(`read      ${totalRead} museum records from ${args.csv.length} file(s)`)
console.log(`emitted   ${final.length} rows across ${Object.keys(byRegion).length} metros${dupes ? ` (${dupes} duplicate ids collapsed)` : ''}`)
console.log(`tier      confidence='${args.confidence}' status='${args.status}'`)
if (args.status === 'approved') {
  console.log('\n⚠️  status=approved on a dataset IMLS retired in 2018 — these rows publish straight to the map.')
}
console.log('by category:')
for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(6)}  ${c}`)
}
console.log('skipped:')
for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`   ${String(n).padStart(6)}  ${reason}`)
}

if (args.dryRun) {
  console.log('\n[dry-run] nothing written.')
  process.exit(0)
}

mkdirSync(path.dirname(args.out), { recursive: true })
writeFileSync(args.out, buildSeedSql(final, [
  `-- IMLS Museum Data Files import (#353)`,
  `-- Generated ${new Date().toISOString()} from ${args.csv.map((f) => path.basename(f)).join(', ')}`,
  `-- ${totalRead} records → ${final.length} rows (child-relevant disciplines inside a metro bbox)`,
  `-- Tier: confidence='${args.confidence}', status='${args.status}'`,
  `-- SOURCE VINTAGE: IMLS retired the Museum Data Files in 2018 and has no plans to update them.`,
  `-- Rows may reference museums that have since closed, moved, or renamed.`,
  '-- UPSERT preserves curator decisions: rejected/archived rows are never resurrected.',
  '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
]))
console.log(`\nwrote ${path.relative(REPO_ROOT, args.out)}`)
console.log('\nTo apply (review first):')
console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ${path.relative(path.join(REPO_ROOT, 'worker'), args.out)}`)
