#!/usr/bin/env node
/**
 * IMLS public-library importer — plan §2.1 row 2, issue #353.
 *
 * Reads the Public Libraries Survey OUTLET file and emits SQL. Outputs only:
 * this script never touches a database. Applying is a separate explicit step.
 *
 *   # 1. Download "Public Libraries Survey FY 2023 Data Files (CSV)" from
 *   #    https://www.imls.gov/research-evaluation/surveys/public-libraries-survey-pls
 *   #    and unzip. The outlet file is PLS_FY23_Outlet_pud23i.csv.
 *   node worker/scripts/seed-imls-libraries.mjs --csv ~/Downloads/PLS_FY23_Outlet_pud23i.csv
 *
 * Uses the OUTLET file, not the parent-entity file: a library system
 * is one parent entity with many branches, and families go to
 * branches. Only CE (central) and BR (branch) outlets become pins —
 * bookmobiles and books-by-mail have no visitable address.
 *
 * Requires Node >= 22.6 (TypeScript type-stripping) to import the metro
 * registry directly rather than keeping a second copy of it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './lib/csv.mjs'
import {
  PLS_COLUMNS, assertColumns, libraryRowToItem, buildSeedSql, collect,
} from './lib/imls.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

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

const { metroForCoords } = await import('../../shared/metros.ts')

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
    csv: null, out: path.join(REPO_ROOT, 'data/imls/libraries.sql'),
    status: 'approved', confidence: 'medium', dryRun: false, limit: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--csv') args.csv = path.resolve(next())
    else if (a === '--out') args.out = path.resolve(next())
    else if (a === '--status') args.status = next()
    else if (a === '--confidence') args.confidence = next()
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--limit') args.limit = Number(next())
    else if (a === '--help' || a === '-h') {
      console.log(`
seed-imls-libraries.mjs — IMLS Public Libraries Survey outlet importer (#353)

  --csv <path>        PLS outlet CSV (required), e.g. PLS_FY23_Outlet_pud23i.csv
  --out <path>        Output SQL (default data/imls/libraries.sql)
  --status <s>        Row status (default approved — trusted source, Tier C)
  --confidence <c>    Row confidence (default medium — Tier C, plan §1.6)
  --dry-run           Report only; write nothing
  --limit <n>         Process only the first n records (smoke tests)

Emits SQL. Applying to any database is a separate, explicit step.
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.csv) { console.error('--csv is required (see --help)'); process.exit(1) }
  validateTier(args)
  return args
}

const args = parseArgs(process.argv.slice(2))

const text = readFileSync(args.csv, 'utf8')
const { headers, rows } = parseCsv(text)
assertColumns(headers, PLS_COLUMNS, path.basename(args.csv))

const source = args.limit ? rows.slice(0, args.limit) : rows
const { rows: items, skipped } = collect(
  source.map((rec) => libraryRowToItem(rec, metroForCoords, {
    status: args.status,
    confidence: args.confidence,
  })),
)

// Same OSM object can't collide here, but IMLS has been known to ship
// duplicate outlet keys across state submissions; last one wins and the
// count is reported rather than silently absorbed.
const byId = new Map()
let dupes = 0
for (const r of items) {
  if (byId.has(r.id)) dupes++
  byId.set(r.id, r)
}
const final = [...byId.values()]

const byRegion = {}
for (const r of final) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1

console.log(`read      ${rows.length} outlet records from ${path.basename(args.csv)}`)
console.log(`emitted   ${final.length} rows across ${Object.keys(byRegion).length} metros${dupes ? ` (${dupes} duplicate ids collapsed)` : ''}`)
console.log(`tier      confidence='${args.confidence}' status='${args.status}'`)
console.log('skipped:')
for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(6)}  ${reason}`)
}
console.log('top metros:')
for (const [region, n] of Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`   ${String(n).padStart(6)}  ${region}`)
}

if (args.dryRun) {
  console.log('\n[dry-run] nothing written.')
  process.exit(0)
}

mkdirSync(path.dirname(args.out), { recursive: true })
writeFileSync(args.out, buildSeedSql(final, [
  `-- IMLS Public Libraries Survey — outlet import (#353)`,
  `-- Generated ${new Date().toISOString()} from ${path.basename(args.csv)}`,
  `-- ${rows.length} records → ${final.length} rows (CE + BR outlets inside a metro bbox)`,
  `-- Tier C: confidence='${args.confidence}', status='${args.status}'`,
  '-- UPSERT preserves curator decisions: rejected/archived rows are never resurrected.',
  '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
]))
console.log(`\nwrote ${path.relative(REPO_ROOT, args.out)}`)
console.log('\nTo apply (review first):')
console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ${path.relative(path.join(REPO_ROOT, 'worker'), args.out)}`)
console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ${path.relative(path.join(REPO_ROOT, 'worker'), args.out)}`)
