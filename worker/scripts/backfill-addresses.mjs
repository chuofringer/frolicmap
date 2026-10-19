#!/usr/bin/env node
/**
 * NOTE ON BULK GEOCODING: the public Nominatim instance's usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/) forbids bulk
 * geocoding. This script keeps the policy's 1 req/s throttle (1.1 s between
 * requests) and an identifying User-Agent, which is only acceptable for small
 * pilots (the `--limit 100` run below). A bulk run (thousands of rows) MUST
 * point `NOMINATIM_URL` at a self-hosted Nominatim or Photon instance, or at
 * a paid geocoder with a Nominatim-compatible `/reverse` endpoint, e.g.
 *
 *   NOMINATIM_URL=http://localhost:8080/reverse node worker/scripts/backfill-addresses.mjs ...
 *
 * One-off reverse-geocode address backfill (issue #399, option 1).
 *
 * The problem: of 51,273 approved national rows, ~11,879 OSM parks/playgrounds
 * carry no street address — OSM rarely tags addr:* on ways. This script looks
 * each one up against Nominatim (OSM's reverse geocoder), composes a US street
 * address, and emits idempotent UPDATE batches for the reviewer to apply.
 *
 * LICENSE: Nominatim returns OpenStreetMap data under the ODbL. The rows we're
 * filling are themselves OSM-sourced (`source_type='osm'`), so writing an
 * ODbL-derived address alongside an ODbL-derived place is no new license
 * conflict — it's the same corpus, same attribution obligation the app already
 * carries. No proprietary geocoder is involved.
 *
 * SAFETY / SCOPE:
 *   - Only `address` and `updated_at` are ever written. No other column.
 *   - Every UPDATE is guarded `AND (address IS NULL OR address='')`, so an
 *     apply can never clobber a curated address and re-applies are no-ops.
 *   - region='bay' rows are asserted out of the input and never emitted.
 *   - Rows whose reverse-geocode has no street/road are SKIPPED, never faked.
 *   - This script NEVER applies SQL and NEVER runs wrangler writes. It only
 *     reads (optionally, via --fetch-remote) and writes local files.
 *
 * NOMINATIM USAGE POLICY (https://operations.osmfoundation.org/policies/nominatim/):
 *   - single-threaded, >= 1.1s between requests
 *   - a descriptive User-Agent identifying this app + a contact address
 *   - retry once on 429/5xx after a 10s backoff, then skip the row
 * Be a good citizen: ~12k rows at 1.1s is ~3.7h, which the public instance does
 * not allow (see the note at the top): use a self-hosted instance for that.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RUNBOOK
 *
 * 1. Export the rows to backfill (reviewer runs this — wrangler writes nothing):
 *
 *      cd worker && npx wrangler d1 execute frolicmap-prod --remote --json \
 *        --command "SELECT id, lat, lng FROM items WHERE region!='bay' \
 *          AND source_type='osm' AND status='approved' \
 *          AND (address IS NULL OR address='')" \
 *        | node -e "process.stdin.on('data',d=>0);let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s)[0].results)))" \
 *        > ../data/backfill/rows.json
 *
 *    (or just skip the export and use --fetch-remote below, which runs the
 *    same SELECT for you.)
 *
 * 2. Pilot on 100 rows and eyeball the output SQL before committing 3.7 hours:
 *
 *      node worker/scripts/backfill-addresses.mjs --input data/backfill/rows.json --limit 100
 *      # inspect data/backfill/addresses-0001.sql — do the addresses look right?
 *
 * 3. Full run (resumable — safe to Ctrl-C and re-run; the cache picks up):
 *
 *      node worker/scripts/backfill-addresses.mjs --input data/backfill/rows.json
 *      #   ...or, to run the SELECT itself:
 *      node worker/scripts/backfill-addresses.mjs --fetch-remote
 *
 * 4. Apply the batches (reviewer, deliberately, one at a time):
 *
 *      cd worker
 *      for f in ../data/backfill/addresses-*.sql; do
 *        npx wrangler d1 execute frolicmap-prod --remote --file "$f"
 *      done
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   --input <rows.json>  JSON array of {id, lat, lng[, region]} rows.
 *   --fetch-remote       Run the scoped SELECT against remote D1 instead.
 *   --limit N            Process at most N rows (pilot runs).
 *   --metro <ids>        Comma-separated region ids to scope to (filters input
 *                        and narrows the --fetch-remote SELECT).
 *   -h, --help           Print this and exit.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cacheKey, formatAddress, buildUpdateStatement, chunk, assertInputRows,
} from './lib/backfillAddresses.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')
const OUT_DIR = path.join(REPO_ROOT, 'data', 'backfill')
const CACHE_PATH = path.join(OUT_DIR, 'geocode-cache.jsonl')

// Override with NOMINATIM_URL for any bulk run (see the note at the top).
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'frolicmap.app-address-backfill/1.0 (contact: frolicmap.official@gmail.com)'
const MIN_INTERVAL_MS = 1100 // >= 1.1s between requests, single-threaded.
const RETRY_BACKOFF_MS = 10_000
const BATCH_SIZE = 500

function parseArgs(argv) {
  const args = { input: null, fetchRemote: false, limit: null, metros: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--input') args.input = path.resolve(next())
    else if (a === '--fetch-remote') args.fetchRemote = true
    else if (a === '--limit') args.limit = Number(next())
    else if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.input && !args.fetchRemote) {
    console.error('Provide --input <rows.json> or --fetch-remote. See --help.')
    process.exit(1)
  }
  if (args.input && args.fetchRemote) {
    console.error('Pass only one of --input / --fetch-remote.')
    process.exit(1)
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    console.error('--limit must be a positive integer.')
    process.exit(1)
  }
  return args
}

function printHelp() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const doc = src.match(/\/\*\*([\s\S]*?)\*\//)
  console.log(doc ? doc[1].replace(/^\s*\* ?/gm, '') : 'see file header')
}

/**
 * Run the scoped SELECT against remote D1 via wrangler, modelled on
 * build-seo-pages.mjs::d1(). READ-ONLY — a SELECT, never a write.
 */
function fetchRemoteRows(metros) {
  let sql =
    "SELECT id, lat, lng, region FROM items WHERE region!='bay' " +
    "AND source_type='osm' AND status='approved' " +
    "AND (address IS NULL OR address='')"
  if (metros && metros.length) {
    const inList = metros.map((m) => `'${m.replace(/'/g, "''")}'`).join(',')
    sql += ` AND region IN (${inList})`
  }
  const res = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'frolicmap-prod', '--remote', '--json', '--command', sql],
    { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false },
  )
  if (res.status !== 0) throw new Error(`wrangler failed: ${(res.stderr || '').slice(0, 300)}`)
  const start = res.stdout.indexOf('[')
  if (start < 0) throw new Error('no JSON in wrangler output')
  return JSON.parse(res.stdout.slice(start))[0]?.results ?? []
}

function loadRows(args) {
  let rows = args.fetchRemote
    ? fetchRemoteRows(args.metros)
    : JSON.parse(readFileSync(args.input, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('input JSON must be an array of rows')
  if (args.metros && args.metros.length && !args.fetchRemote) {
    const set = new Set(args.metros)
    rows = rows.filter((r) => set.has(r.region))
  }
  assertInputRows(rows) // rejects region='bay' and malformed rows
  if (args.limit !== null) rows = rows.slice(0, args.limit)
  return rows
}

/** Load the JSON-lines cache into a Map keyed by "lat,lng". */
function loadCache() {
  const cache = new Map()
  if (!existsSync(CACHE_PATH)) return cache
  const text = readFileSync(CACHE_PATH, 'utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec && rec.key) cache.set(rec.key, rec)
    } catch { /* skip a torn last line from an interrupted append */ }
  }
  return cache
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Reverse-geocode one coordinate. Returns the raw Nominatim response object,
 * or null on a hard failure after the single retry. Honours the usage policy:
 * custom UA, one retry on 429/5xx after a 10s backoff.
 */
async function reverseGeocode(lat, lng) {
  const url =
    `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`
  for (let attempt = 0; attempt < 2; attempt++) {
    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } })
    } catch (err) {
      if (attempt === 0) { await sleep(RETRY_BACKOFF_MS); continue }
      console.error(`  network error for ${lat},${lng}: ${err.message}`)
      return null
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) { await sleep(RETRY_BACKOFF_MS); continue }
      console.error(`  ${res.status} for ${lat},${lng} after retry; skipping`)
      return null
    }
    if (!res.ok) {
      console.error(`  ${res.status} for ${lat},${lng}; skipping`)
      return null
    }
    try { return await res.json() } catch { return null }
  }
  return null
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })

  const rows = loadRows(args)
  const cache = loadCache()
  console.error(`Rows to process: ${rows.length}  |  cache entries loaded: ${cache.size}`)

  const nowIso = new Date().toISOString()
  const updates = []
  let geocoded = 0
  let skippedNoStreet = 0
  let cacheHits = 0
  let networkCalls = 0
  const started = Date.now()
  let lastRequestAt = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const key = cacheKey(row.lat, row.lng)

    let rec = cache.get(key)
    if (rec) {
      cacheHits++
    } else {
      // Rate-limit: ensure >= MIN_INTERVAL_MS since the last live request.
      const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
      if (wait > 0) await sleep(wait)
      const resp = await reverseGeocode(row.lat, row.lng)
      lastRequestAt = Date.now()
      networkCalls++
      const address = resp ? formatAddress(resp) : null
      rec = { key, address, at: new Date().toISOString() }
      cache.set(key, rec)
      appendFileSync(CACHE_PATH, JSON.stringify(rec) + '\n') // resumable: persist every response
    }

    if (rec.address) {
      updates.push(buildUpdateStatement(row.id, rec.address, nowIso))
      geocoded++
    } else {
      skippedNoStreet++
    }

    if ((i + 1) % 50 === 0 || i + 1 === rows.length) {
      const done = i + 1
      const elapsed = Date.now() - started
      // ETA is driven by remaining *live* requests, not cache hits.
      const remaining = rows.length - done
      const perCall = networkCalls > 0 ? MIN_INTERVAL_MS : 0
      const eta = remaining * perCall
      console.error(
        `  ${done}/${rows.length}  geocoded=${geocoded} skipped=${skippedNoStreet} ` +
        `cacheHits=${cacheHits}  elapsed=${fmtDuration(elapsed)} eta~${fmtDuration(eta)}`,
      )
    }
  }

  const batches = chunk(updates, BATCH_SIZE)
  batches.forEach((batch, idx) => {
    const file = path.join(OUT_DIR, `addresses-${String(idx + 1).padStart(4, '0')}.sql`)
    const header =
      `-- Address backfill batch ${idx + 1}/${batches.length} (issue #399)\n` +
      `-- ${batch.length} idempotent UPDATEs. Apply with:\n` +
      `--   cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/backfill/${path.basename(file)}\n`
    writeFileSync(file, header + batch.join('\n') + '\n')
  })

  console.error('\n── Summary ──────────────────────────────')
  console.error(`  geocoded (UPDATEs emitted): ${geocoded}`)
  console.error(`  skipped (no street/road):   ${skippedNoStreet}`)
  console.error(`  cache hits:                 ${cacheHits}`)
  console.error(`  live Nominatim calls:       ${networkCalls}`)
  console.error(`  batches written:            ${batches.length}  (${BATCH_SIZE}/file, in ${OUT_DIR})`)
}

main().catch((err) => { console.error(err); process.exit(1) })
