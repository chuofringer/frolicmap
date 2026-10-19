#!/usr/bin/env node
/**
 * NPS (National Park Service) importer — plan §2.1 row 5, issue #383.
 *
 * Pulls the National Park Service's free API and emits SQL. Outputs only; this
 * script never writes to any database. Applying is a separate, explicit step.
 *
 * HOW TO RUN
 *   1. Get a free API key (no cost, instant): sign up at
 *        https://www.nps.gov/subjects/developer/get-started.htm
 *      then export it:  export NPS_API_KEY=xxxxxxxx
 *   2. Dry-run one metro to sanity-check counts (writes nothing):
 *        node worker/scripts/seed-nps.mjs --metro new-york --dry-run
 *   3. Emit the SQL (all metros):
 *        node worker/scripts/seed-nps.mjs
 *      → data/nps/nps.sql
 *   4. Apply it (review first — these rows land approved):
 *        cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ../data/nps/nps.sql
 *        cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/nps/nps.sql
 *
 * Testable / key-free: `--json <path>` reads a pre-downloaded parks payload
 * (either the raw API `{ data: [...] }` envelope or a bare array) instead of
 * hitting the network, so the importer runs in CI and offline.
 *
 * EXPECT A LOW ROW COUNT. There are only a few hundred NPS units nationally,
 * and most fall outside every metro bbox (deferred, plan §1.1) or carry a
 * historic-site designation this importer conservatively skips. A few hundred
 * → a few dozen rows is correct, not a bug.
 *
 * Requires Node >= 22.6 for TypeScript type-stripping (imports the metro
 * registry directly rather than keeping a second copy).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildImportSql, buildUpsertSet, maxStatementBytes, D1_MAX_STATEMENT_BYTES } from './lib/seedSql.mjs'
import { npsParkToItem, collect } from './lib/nps.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

if (!process.features.typescript && !process.env.__NPS_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __NPS_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro, metroForCoords } = await import('../../shared/metros.ts')

const API = 'https://developer.nps.gov/api/v1'
// The API caps a page at 500 records; the whole park system is well under 1000,
// so this is one or two requests.
const PAGE = 500
const UA = 'frolicmap/nps-import (+https://frolicmap.app)'
const SIGNUP = 'https://www.nps.gov/subjects/developer/get-started.htm'

const VALID_STATUS = ['pending', 'approved', 'rejected', 'archived']
const VALID_CONFIDENCE = ['high', 'medium', 'low']

function parseArgs(argv) {
  const args = {
    json: null, apiKey: process.env.NPS_API_KEY ?? null,
    metros: null, dryRun: false,
    status: 'approved', confidence: 'medium', throttleMs: 500, descMax: 500,
    out: path.join(REPO_ROOT, 'data/nps/nps.sql'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) { console.error(`${a} needs a value`); process.exit(1) }
      return v
    }
    if (a === '--json') args.json = path.resolve(next())
    else if (a === '--api-key') args.apiKey = next()
    else if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--status') args.status = next()
    else if (a === '--confidence') args.confidence = next()
    else if (a === '--throttle-ms') args.throttleMs = Number(next())
    else if (a === '--desc-max') args.descMax = Number(next())
    else if (a === '--out') args.out = path.resolve(next())
    else if (a === '--help' || a === '-h') { usage(); process.exit(0) }
    else { console.error(`unknown flag: ${a}`); usage(); process.exit(1) }
  }
  // Validate at parse time, not apply time: a bad --status would otherwise
  // generate a whole file that fails D1's CHECK constraint partway through.
  if (!VALID_STATUS.includes(args.status)) {
    console.error(`--status must be one of: ${VALID_STATUS.join(', ')} (got '${args.status}')`); process.exit(1)
  }
  if (!VALID_CONFIDENCE.includes(args.confidence)) {
    console.error(`--confidence must be one of: ${VALID_CONFIDENCE.join(', ')} (got '${args.confidence}')`); process.exit(1)
  }
  if (args.metros) {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
  }
  return args
}

function usage() {
  console.log(`
seed-nps.mjs — National Park Service park/trail importer (#383)

  --json <path>      Read a pre-downloaded parks payload instead of the API
                     (the {data:[...]} envelope or a bare array). Runs key-free.
  --api-key <key>    NPS API key (default: NPS_API_KEY env var).
  --metro <ids>      Comma-separated metro ids — restrict emitted rows.
  --dry-run          Fetch + report per-metro counts, write nothing.
  --status <s>       Row status (default approved — trusted source, Tier C).
  --confidence <c>   Row confidence (default medium — Tier C, plan §1.6).
  --throttle-ms <n>  Delay between paged API requests (default 500).
  --desc-max <n>     Description truncation length (default 500).
  --out <path>       Output SQL file (default data/nps/nps.sql).

Get a free key: ${SIGNUP}
Emits SQL. Applying to any database is a separate, explicit step.
`)
}

const args = parseArgs(process.argv.slice(2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Read a park payload from a file — accepts the API envelope or a bare array. */
function loadJson(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  return Array.isArray(json) ? json : (json.data ?? [])
}

/** Fetch every park from the live API, paging on `total`. */
async function fetchAllParks(apiKey) {
  const all = []
  let start = 0
  for (;;) {
    const params = new URLSearchParams({ limit: String(PAGE), start: String(start), api_key: apiKey })
    const res = await fetch(`${API}/parks?${params}`, { headers: { 'user-agent': UA } })
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      throw new Error(`NPS ${body?.error?.code ?? 'HTTP 403'}: ${body?.error?.message ?? 'API key rejected'}`)
    }
    if (!res.ok) throw new Error(`NPS HTTP ${res.status}`)
    const json = await res.json()
    if (json.error) throw new Error(`NPS ${json.error.code}: ${json.error.message}`)
    const data = json.data ?? []
    all.push(...data)
    const total = Number(json.total ?? 0)
    start += data.length
    if (data.length === 0 || start >= total) break
    await sleep(args.throttleMs)
  }
  return all
}

async function main() {
  // Key-free path is `--json`; otherwise a key is mandatory.
  if (!args.json && !args.apiKey) {
    console.error(
      'No NPS API key. Set NPS_API_KEY (or pass --api-key), or run with --json <path> ' +
      'against a pre-downloaded payload.\n' +
      `Get a free key: ${SIGNUP}`,
    )
    process.exit(1)
  }

  let parks
  const source = args.json ? path.relative(REPO_ROOT, args.json) : 'developer.nps.gov/api/v1/parks'
  try {
    parks = args.json ? loadJson(args.json) : await fetchAllParks(args.apiKey)
  } catch (err) {
    console.error(`FAILED to load parks: ${err.message}`)
    process.exit(1)
  }

  const { rows: mapped, skipped } = collect(
    parks.map((p) => npsParkToItem(p, metroForCoords, {
      status: args.status, confidence: args.confidence, descMaxLen: args.descMax,
    })),
  )

  // Optional metro restriction (parkCode is unique, but dedup by id anyway).
  const wanted = args.metros ? new Set(args.metros) : null
  const byId = new Map()
  for (const r of mapped) {
    if (wanted && !wanted.has(r.region)) continue
    byId.set(r.id, r)
  }
  const rows = [...byId.values()]

  const byRegion = {}
  for (const r of rows) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1
  const byCategory = {}
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1

  console.log(`${args.dryRun ? '[dry-run] ' : ''}NPS import from ${source}`)
  console.log(`read      ${parks.length} park unit(s)`)
  console.log(`emitted   ${rows.length} row(s) across ${Object.keys(byRegion).length} metro(s)` +
    `${wanted ? ` (restricted to: ${[...wanted].join(', ')})` : ''}`)
  console.log(`category  ${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('  ') || '(none)'}`)
  console.log(`tier      confidence='${args.confidence}' status='${args.status}'`)
  console.log('skipped (top designations show what was conservatively dropped):')
  for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${reason}`)
  }
  console.log('per-metro:')
  for (const [region, n] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${region}`)
  }
  console.log(
    '\nNote: a low national total is expected — the NPS system is a few hundred units, ' +
    'most outside every metro bbox (deferred, plan §1.1) or historic-designation skips. Not a bug.',
  )

  if (args.dryRun) { console.log('\n[dry-run] nothing written.'); return }
  if (!rows.length) { console.log('\nNo rows to emit; nothing written.'); return }

  const sql = buildImportSql(rows, {
    setClause: buildUpsertSet(),
    headerLines: [
      '-- NPS import — National Park Service API (#383)',
      `-- Generated ${new Date().toISOString()} from ${source}`,
      `-- ${parks.length} units → ${rows.length} rows (park/trail designations inside a metro bbox)`,
      `-- Tier C: confidence='${args.confidence}', status='${args.status}'`,
      '-- UPSERT preserves curator decisions: rejected/archived/approved rows keep their status.',
      '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
    ],
  })
  mkdirSync(path.dirname(args.out), { recursive: true })
  writeFileSync(args.out, sql)
  const biggest = maxStatementBytes(sql)
  if (biggest > D1_MAX_STATEMENT_BYTES) console.log(`   ⚠️ largest statement ${biggest}B exceeds D1's cap`)

  console.log(`\nwrote ${path.relative(REPO_ROOT, args.out)}`)
  console.log('\nTo apply (review first — these rows land approved):')
  const rel = path.relative(path.join(REPO_ROOT, 'worker'), args.out)
  console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --local  --file ${rel}`)
  console.log(`  cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ${rel}`)
}

await main()
