#!/usr/bin/env node
/**
 * One-off photo backfill for OSM-sourced static places (issue #299).
 *
 * THE PROBLEM: `items.photo_url` has existed since the schema's first cut and
 * the frontend has been photo-ready since PR #477 (200px DetailPanel header /
 * 140px BottomSheet block, both collapsing cleanly when null) — but every row
 * is currently null. This is a pure data-sourcing task.
 *
 * LICENSE SCOPE — the only reason this script is allowed to write a URL into
 * `photo_url` at all. A candidate is accepted ONLY from:
 *
 *   1. an OSM `wikimedia_commons=File:*` tag on the same node/way, or
 *   2. an OSM `image=*` tag whose value resolves to a Wikimedia Commons file
 *      (a `commons.wikimedia.org/wiki/File:*` page or a raw
 *      `upload.wikimedia.org/.../<filename>` URL).
 *
 * Both are OSM mappers deliberately pointing at a specific photo of that
 * specific place, and Commons' `extmetadata` gives a real, attributable
 * license — that combination is what makes this safe to auto-apply-review.
 * Everything else is a SKIP:
 *   - `image=` pointing at a non-Commons host (arbitrary copyright status —
 *     could be a business's own marketing photo, a Yelp scrape, anything).
 *   - `wikimedia_commons=Category:*` (a category page, not one photo — which
 *     representative image to pick is a judgment call this script refuses
 *     to make on its own).
 *   - a Commons title that 404s, has no imageinfo, or whose resolved URL
 *     doesn't verify (see below).
 * See `worker/scripts/lib/backfillPhotos.mjs` for the resolution logic.
 *
 * NEVER FABRICATE: every candidate URL is verified live (HTTP GET, expect
 * 200 and a `Content-Type: image/*`) before it's allowed into the emitted
 * SQL. A candidate that doesn't verify is skipped and logged, never guessed.
 *
 * SAFETY / SCOPE:
 *   - Only rows with `source_type='osm'` and `photo_url IS NULL` are ever
 *     read or written (see `assertInputRows` in the lib).
 *   - Only `photo_url`, `photo_attribution`, `updated_at` are ever written.
 *   - Every UPDATE is guarded `WHERE photo_url IS NULL`, so re-applying a
 *     batch is a no-op and a photo set in the meantime is never clobbered.
 *   - This script NEVER applies SQL and NEVER runs a wrangler write. It only
 *     reads (optionally, via --fetch-remote) and writes local files. A
 *     human reviews and applies the emitted .sql, one batch at a time.
 *
 * OVERPASS USAGE: tags aren't stored on the ingested row, so this re-queries
 * Overpass by element id to get them back. Single request per batch (default
 * 300 ids/batch — comfortably under Overpass's response-size limits for a
 * tags-only query), politely spaced (>= 2s between requests, generous vs.
 * Nominatim's 1.1s policy since Overpass's own fair-use ask is looser but
 * this hits it far less often). ROWS INGESTED SINCE the #299 ingest
 * pass-through (`shared/osm.ts::resolvePhotoCandidateFromTags`) already carry
 * their candidate in `items.attributes.photo_candidate` and skip this
 * Overpass round-trip entirely — see `parseAttributesPhotoCandidate`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RUNBOOK
 *
 * 1. Export the candidate rows (reviewer runs this — wrangler writes nothing):
 *
 *      cd worker && npx wrangler d1 execute frolicmap-prod --remote --json \
 *        --command "SELECT id, source_type, photo_url, attributes FROM items \
 *          WHERE source_type='osm' AND status='approved' AND photo_url IS NULL" \
 *        > ../data/backfill/photo-rows-raw.json
 *      node -e "const j=require('../data/backfill/photo-rows-raw.json');\
 *        require('fs').writeFileSync('../data/backfill/photo-rows.json',JSON.stringify(j[0].results))"
 *
 *    (or skip both and use --fetch-remote below, which runs the same SELECT.)
 *
 * 2. Pilot on 100 rows and eyeball the output SQL + CSV before a full run:
 *
 *      node worker/scripts/backfill-photos.mjs --input data/backfill/photo-rows.json --limit 100
 *      # inspect data/backfill/photos-report.csv and data/backfill/photos-0001.sql
 *
 * 3. Full run (resumable — safe to Ctrl-C and re-run; the Overpass batch
 *    cache and Commons lookup cache both pick up where they left off):
 *
 *      node worker/scripts/backfill-photos.mjs --input data/backfill/photo-rows.json
 *      #   ...or, to run the SELECT itself:
 *      node worker/scripts/backfill-photos.mjs --fetch-remote
 *
 * 4. Apply the batches (reviewer, deliberately, one at a time):
 *
 *      cd worker
 *      for f in ../data/backfill/photos-*.sql; do
 *        npx wrangler d1 execute frolicmap-prod --remote --file "$f"
 *      done
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   --input <rows.json>  JSON array of {id, source_type, photo_url, attributes?} rows.
 *   --fetch-remote       Run the scoped SELECT against remote D1 instead.
 *   --limit N            Process at most N rows (pilot runs).
 *   -h, --help           Print this and exit.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseOsmItemId, buildOverpassTagsQuery, resolveCommonsTitle, commonsImageInfoUrl,
  parseCommonsPage, buildGuardedPhotoUpdate, isImageContentType, assertInputRows, chunk,
  parseAttributesPhotoCandidate,
} from './lib/backfillPhotos.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')
const OUT_DIR = path.join(REPO_ROOT, 'data', 'backfill')
const OVERPASS_CACHE_PATH = path.join(OUT_DIR, 'photo-overpass-cache.jsonl')
const COMMONS_CACHE_PATH = path.join(OUT_DIR, 'photo-commons-cache.jsonl')

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'frolicmap.app-photo-backfill/1.0 (contact: frolicmap.official@gmail.com)'
const OVERPASS_BATCH_SIZE = 300
const OVERPASS_MIN_INTERVAL_MS = 2000
const COMMONS_MIN_INTERVAL_MS = 500
const SQL_BATCH_SIZE = 500

function parseArgs(argv) {
  const args = { input: null, fetchRemote: false, limit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--input') args.input = path.resolve(next())
    else if (a === '--fetch-remote') args.fetchRemote = true
    else if (a === '--limit') args.limit = Number(next())
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

/** Read-only SELECT against remote D1 via wrangler. Modelled on backfill-addresses.mjs. */
function fetchRemoteRows() {
  const sql =
    "SELECT id, source_type, photo_url, attributes FROM items WHERE source_type='osm' " +
    "AND status='approved' AND photo_url IS NULL"
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
  let rows = args.fetchRemote ? fetchRemoteRows() : JSON.parse(readFileSync(args.input, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('input JSON must be an array of rows')
  assertInputRows(rows)
  if (args.limit !== null) rows = rows.slice(0, args.limit)
  return rows
}

function loadJsonlCache(cachePath) {
  const cache = new Map()
  if (!existsSync(cachePath)) return cache
  for (const line of readFileSync(cachePath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec && rec.key) cache.set(rec.key, rec)
    } catch { /* skip a torn last line from an interrupted append */ }
  }
  return cache
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fetch tags for one batch of OSM elements via Overpass. Returns a Map keyed by "type-id". */
async function fetchOverpassTagsBatch(elements) {
  const query = buildOverpassTagsQuery(elements)
  if (!query) return new Map()
  let res
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })
  } catch (err) {
    console.error(`  Overpass network error: ${err.message}`)
    return new Map()
  }
  if (!res.ok) {
    console.error(`  Overpass returned ${res.status}; skipping this batch`)
    return new Map()
  }
  const body = await res.json()
  const out = new Map()
  for (const el of body.elements ?? []) {
    out.set(`${el.type}-${el.id}`, el.tags ?? {})
  }
  return out
}

/** Look up + verify one Commons candidate. Returns {url, attribution} or null. */
async function resolveAndVerify(candidate) {
  let res
  try {
    res = await fetch(commonsImageInfoUrl(candidate.title), { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    console.error(`  Commons API network error for "${candidate.title}": ${err.message}`)
    return null
  }
  if (!res.ok) {
    console.error(`  Commons API returned ${res.status} for "${candidate.title}"; skipping`)
    return null
  }
  const body = await res.json()
  const page = body?.query?.pages?.[0]
  const parsed = parseCommonsPage(page)
  if (!parsed) {
    console.error(`  no usable imageinfo for "${candidate.title}"; skipping`)
    return null
  }

  // Verify the actual media URL is a live, fetchable image — never trust the
  // API response alone.
  let verifyRes
  try {
    verifyRes = await fetch(parsed.url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    console.error(`  verification network error for ${parsed.url}: ${err.message}`)
    return null
  }
  if (verifyRes.status !== 200 || !isImageContentType(verifyRes.headers.get('content-type'))) {
    console.error(`  verification failed for ${parsed.url} (status ${verifyRes.status}, content-type ${verifyRes.headers.get('content-type')}); skipping`)
    return null
  }
  return parsed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })

  const rows = loadRows(args)
  console.error(`Rows to process: ${rows.length}`)

  const overpassCache = loadJsonlCache(OVERPASS_CACHE_PATH)
  const commonsCache = loadJsonlCache(COMMONS_CACHE_PATH)

  // A row ingested since #299 already carries its resolved candidate in
  // `attributes.photo_candidate` — no Overpass round-trip needed for it at
  // all. Everything else falls back to the original re-query-by-id path, so
  // anything not shaped like an OSM element id there is out of scope
  // (assertInputRows already required source_type='osm', but a stray legacy
  // id shape is still possible).
  const parsed = rows.map((row) => {
    const attrCandidate = parseAttributesPhotoCandidate(row.attributes)
    if (attrCandidate) return { row, el: null, attrCandidate }
    const el = parseOsmItemId(row.id)
    if (!el) { console.error(`  skip ${row.id}: id doesn't match osm-{type}-{id}`); return null }
    return { row, el, attrCandidate: null }
  }).filter((p) => p !== null)

  // Fetch missing Overpass batches, respecting the cache and rate limit.
  // Rows already resolved from `attributes` need no Overpass tags at all.
  const needsOverpass = parsed.filter((p) => !p.attrCandidate)
  const toFetch = needsOverpass.filter((p) => !overpassCache.has(`${p.el.type}-${p.el.id}`)).map((p) => p.el)
  const batches = chunk(toFetch, OVERPASS_BATCH_SIZE)
  console.error(`Attribute-resolved (no Overpass needed): ${parsed.length - needsOverpass.length}`)
  console.error(`Overpass batches to fetch: ${batches.length} (cache hits: ${toFetch.length < needsOverpass.length ? needsOverpass.length - toFetch.length : 0})`)
  let lastOverpassAt = 0
  for (const batch of batches) {
    const wait = OVERPASS_MIN_INTERVAL_MS - (Date.now() - lastOverpassAt)
    if (wait > 0) await sleep(wait)
    const tagsByKey = await fetchOverpassTagsBatch(batch)
    lastOverpassAt = Date.now()
    for (const el of batch) {
      const key = `${el.type}-${el.id}`
      const tags = tagsByKey.get(key) ?? null // null = element vanished from OSM since ingest
      const rec = { key, tags }
      overpassCache.set(key, rec)
      appendFileSync(OVERPASS_CACHE_PATH, JSON.stringify(rec) + '\n')
    }
  }

  const nowIso = new Date().toISOString()
  const updates = []
  const reportRows = []
  let resolved = 0
  let skippedNoTag = 0
  let skippedAmbiguous = 0
  let skippedUnverified = 0
  let skippedUntrustedUrl = 0
  let lastCommonsAt = 0

  for (const { row, el, attrCandidate } of parsed) {
    let candidate
    if (attrCandidate) {
      candidate = attrCandidate
    } else {
      const tags = overpassCache.get(`${el.type}-${el.id}`)?.tags
      candidate = resolveCommonsTitle(tags)
    }
    if (!candidate) { skippedNoTag++; reportRows.push([row.id, 'skip', 'no image/wikimedia_commons tag']); continue }
    if (candidate.skip) { skippedAmbiguous++; reportRows.push([row.id, 'skip', candidate.skip]); continue }

    let commonsResult
    const cacheKey = candidate.title
    if (commonsCache.has(cacheKey)) {
      commonsResult = commonsCache.get(cacheKey).result
    } else {
      const wait = COMMONS_MIN_INTERVAL_MS - (Date.now() - lastCommonsAt)
      if (wait > 0) await sleep(wait)
      commonsResult = await resolveAndVerify(candidate)
      lastCommonsAt = Date.now()
      const rec = { key: cacheKey, result: commonsResult }
      commonsCache.set(cacheKey, rec)
      appendFileSync(COMMONS_CACHE_PATH, JSON.stringify(rec) + '\n')
    }

    if (!commonsResult) {
      skippedUnverified++
      reportRows.push([row.id, 'skip', `Commons lookup/verification failed for "${candidate.title}"`])
      continue
    }

    const guarded = buildGuardedPhotoUpdate(row.id, commonsResult.url, commonsResult.attribution, nowIso)
    if (guarded.skip) { skippedUntrustedUrl++; reportRows.push([row.id, 'skip', guarded.skip]); continue }
    updates.push(guarded.statement)
    reportRows.push([row.id, 'resolved', `${candidate.tagUsed} → ${commonsResult.url}`])
    resolved++
  }

  const batchesOut = chunk(updates, SQL_BATCH_SIZE)
  batchesOut.forEach((b, i) => {
    const file = path.join(OUT_DIR, `photos-${String(i + 1).padStart(4, '0')}.sql`)
    writeFileSync(file, b.join('\n') + '\n')
  })

  const csv = ['id,verdict,detail', ...reportRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
  writeFileSync(path.join(OUT_DIR, 'photos-report.csv'), csv + '\n')

  console.error(`Resolved: ${resolved}  |  skip (no tag): ${skippedNoTag}  |  skip (ambiguous/untrusted): ${skippedAmbiguous}  |  skip (unverified): ${skippedUnverified}  |  skip (url not allowed): ${skippedUntrustedUrl}`)
  console.error(`Wrote ${batchesOut.length} SQL batch(es) to ${OUT_DIR} and photos-report.csv`)
}

main().catch((err) => { console.error(err); process.exit(1) })
