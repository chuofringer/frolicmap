#!/usr/bin/env node
/**
 * National OSM bootstrap — plan §2.1.1 + §9.2, issue #352.
 *
 * Walks every metro in `shared/metros.ts`, queries Overpass per
 * (metro × category) using the shared query builders in `shared/osm.ts`, and
 * emits one SQL file per metro. Nothing here writes to a remote database:
 * the script produces SQL, and applying it is a separate, explicit step
 * (`--apply-local`, or the wrangler command printed at the end).
 *
 * Why a local script rather than a Worker (plan §2.1): 400 Overpass queries
 * against a rate-limited public endpoint don't fit a Worker execution budget,
 * and Overpass wants a polite serial client.
 *
 *   node worker/scripts/ingest-osm-national.mjs --metro austin --dry-run
 *   node worker/scripts/ingest-osm-national.mjs --metro austin --apply-local
 *   node worker/scripts/ingest-osm-national.mjs --wave
 *
 * Requires Node ≥ 22.6 (TypeScript type-stripping) so it can import
 * `shared/metros.ts` and `shared/osm.ts` directly instead of keeping a
 * hand-synced copy of the registry — the duplication class that #351
 * deleted. The script re-execs itself with the flag when needed.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildImportSql, buildUpsertSet, maxStatementBytes, D1_MAX_STATEMENT_BYTES } from './lib/seedSql.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

// ── Node type-stripping bootstrap ────────────────────────────────────────
// Node 23.6+ strips types natively; 22.6–23.5 needs the flag. Re-exec once
// (guarded by an env var so a failure can't loop) rather than making the
// operator remember the flag.
if (!process.features.typescript && !process.env.__OSM_NATIONAL_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(
      `This script needs Node >= 22.6 for TypeScript type-stripping (found ${process.versions.node}).\n` +
      `It imports shared/metros.ts + shared/osm.ts directly so the metro registry has exactly one copy.`,
    )
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __OSM_NATIONAL_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro, metroForCoords } = await import('../../shared/metros.ts')
const { OSM_CATEGORIES, CATEGORY_QUERY, buildOverpassQueryForBbox, overpassElementToItem, quadrants, bboxString, resolveNationalRegion } =
  await import('../../shared/osm.ts')

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    metros: null, categories: null, dryRun: false, applyLocal: false,
    force: false, wave: false, throttleMs: 3000, cooldownMs: 30000,
    timeoutSec: 90, maxDepth: 2, outDir: path.join(REPO_ROOT, 'data/osm-national'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) { console.error(`${a} needs a value`); process.exit(1) }
      return v
    }
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--categories') args.categories = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--apply-local') args.applyLocal = true
    else if (a === '--force') args.force = true
    else if (a === '--wave') args.wave = true
    else if (a === '--throttle-ms') args.throttleMs = Number(next())
    else if (a === '--cooldown-ms') args.cooldownMs = Number(next())
    else if (a === '--timeout-sec') args.timeoutSec = Number(next())
    else if (a === '--max-depth') args.maxDepth = Number(next())
    else if (a === '--out') args.outDir = path.resolve(next())
    else if (a === '--help' || a === '-h') { usage(); process.exit(0) }
    else { console.error(`unknown flag: ${a}`); usage(); process.exit(1) }
  }
  return args
}

function usage() {
  console.log(`
ingest-osm-national.mjs — per-metro OSM bootstrap (#352)

  --metro <ids>      Comma-separated metro ids (default: every metro).
  --wave             Only the 12 September wave metros.
  --categories <cs>  Comma-separated categories (default: all with an OSM leg).
  --dry-run          Fetch + transform + report, but write NO files and touch NO database.
  --apply-local      Apply the generated SQL to the LOCAL D1 via wrangler. Never remote.
  --force            Re-run (metro, category) pairs already recorded in the checkpoint.
  --throttle-ms <n>  Delay between Overpass queries (default 3000). Be polite.
  --cooldown-ms <n>  Pause before retrying a 504 at the same size (default 30000).
  --timeout-sec <n>  Overpass [timeout:] value (default 90).
  --max-depth <n>    Bbox-split recursion depth on timeout (default 2 → up to 16 sub-boxes).
  --out <dir>        Output directory (default data/osm-national).

Applying to production is deliberately NOT a flag on this script; the exact
wrangler command is printed after a successful run.
`)
}

const args = parseArgs(process.argv.slice(2))

// ── Tier semantics (plan §1.6) ───────────────────────────────────────────
// Raw single-source OSM is Tier C: confidence 'medium', NOT the 'high' the
// some earlier loaders hardcoded. Getting this wrong silently promotes
// every raw row to Tier B and corrupts the multi-source-confirmation signal
// the dedup pass (#355) computes.
const NATIONAL_CONFIDENCE = 'medium'
// Trusted structured source → auto-approve (plan §4A.2). This is the
// deliberate exception to "all ingestion lands pending"; LLM-extracted and
// curated rows keep the pending path.
const NATIONAL_STATUS = 'approved'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const CHECKPOINT = path.join(args.outDir, 'checkpoint.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Metro selection ──────────────────────────────────────────────────────

function selectMetros() {
  let list = METROS
  if (args.wave) list = list.filter((m) => m.wave)
  if (args.metros) {
    const unknown = args.metros.filter((id) => !getMetro(id))
    if (unknown.length) {
      console.error(`unknown metro id(s): ${unknown.join(', ')}`)
      console.error(`valid ids: ${METROS.map((m) => m.id).join(', ')}`)
      process.exit(1)
    }
    const wanted = new Set(args.metros)
    list = list.filter((m) => wanted.has(m.id))
  }
  return list
}

function selectCategories() {
  if (!args.categories) return OSM_CATEGORIES
  const unknown = args.categories.filter((c) => !(c in CATEGORY_QUERY))
  if (unknown.length) {
    console.error(`unknown categor(ies): ${unknown.join(', ')}`)
    process.exit(1)
  }
  const withoutLeg = args.categories.filter((c) => CATEGORY_QUERY[c].length === 0)
  if (withoutLeg.length) {
    console.error(`categor(ies) have no OSM leg and would return nothing: ${withoutLeg.join(', ')}`)
    process.exit(1)
  }
  return args.categories
}

// ── Checkpoint (resumability) ────────────────────────────────────────────
// Keyed by `${metro}:${category}` so an interrupted 400-query run resumes
// where it stopped instead of re-hammering Overpass from the top.

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT)) return { done: {}, startedAt: new Date().toISOString() }
  try {
    return JSON.parse(readFileSync(CHECKPOINT, 'utf8'))
  } catch {
    console.warn(`checkpoint at ${CHECKPOINT} is unreadable — starting fresh`)
    return { done: {}, startedAt: new Date().toISOString() }
  }
}

function saveCheckpoint(cp) {
  if (args.dryRun) return
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2) + '\n')
}

// Per-(metro, category) row cache backing the checkpoint.
//
// The checkpoint alone is not enough to resume correctly: the SQL file is
// rebuilt from scratch each run, so skipping a checkpointed category without
// its rows would write a FILE MISSING those rows and silently overwrite the
// complete one. (Observed on the first Albuquerque re-run: 353 rows became
// 47.) Caching the fetched rows means a resumed run reassembles the full
// metro, and re-running after a completed run is free rather than 8 more
// Overpass queries.
function cachePath(metroId, category) {
  return path.join(args.outDir, '.cache', metroId, `${category}.json`)
}

/**
 * Fingerprint of the inputs that determine a cached result: the metro's bbox
 * and the Overpass clauses for the category.
 *
 * Tuning a bbox in `shared/metros.ts` is something the plan explicitly expects
 * (§1.5, and the #357 QA harness exists partly to drive it). Without a
 * fingerprint, a resumed run replays cache produced by the *old* bbox and the
 * operator has to remember `--force` — a silent-wrong-data failure that looks
 * like a successful run.
 */
function fingerprint(metro, category) {
  return createHash('sha256')
    .update(bboxString(metro.contentBbox))
    .update('|')
    .update(CATEGORY_QUERY[category].join(','))
    .digest('hex')
    .slice(0, 16)
}

function readCachedRows(metroId, category) {
  const file = cachePath(metroId, category)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeCachedRows(metroId, category, rows) {
  if (args.dryRun) return
  const file = cachePath(metroId, category)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(rows) + '\n')
}

// ── Overpass ─────────────────────────────────────────────────────────────

/**
 * One Overpass request with retry. Returns elements, or throws a tagged
 * error so the caller can decide whether splitting the bbox will help.
 */
async function overpassRequest(query, attempt = 1) {
  // Test seam: when OSM_NATIONAL_FIXTURE names a JSON file, return its
  // `elements` instead of touching the network. Lets the dry-run be exercised
  // offline (worker/test/ingest-osm-national.test.mjs, #435). Never set in
  // production — the flag is purely a test injection point.
  if (process.env.OSM_NATIONAL_FIXTURE) {
    return JSON.parse(readFileSync(process.env.OSM_NATIONAL_FIXTURE, 'utf8')).elements ?? []
  }
  const MAX_ATTEMPTS = 3
  let res
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Overpass asks clients to identify themselves so operators can
        // reach out instead of silently blocking.
        'user-agent': 'frolicmap/national-bootstrap (+https://frolicmap.app)',
      },
    })
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      const backoff = args.throttleMs * 2 ** attempt
      console.log(`      network error (${err.message}); retrying in ${backoff}ms`)
      await sleep(backoff)
      return overpassRequest(query, attempt + 1)
    }
    throw Object.assign(new Error(`network: ${err.message}`), { kind: 'network' })
  }

  // 429 = rate limited, 504 = gateway timeout. Both are "slow down", but
  // only 504 means the query itself was too big to complete.
  if (res.status === 429 || res.status === 504) {
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const backoff = args.throttleMs * 4 * attempt
      console.log(`      rate limited (429); backing off ${backoff}ms`)
      await sleep(backoff)
      return overpassRequest(query, attempt + 1)
    }
    throw Object.assign(new Error(`Overpass ${res.status}`), { kind: 'timeout' })
  }
  if (!res.ok) throw Object.assign(new Error(`Overpass ${res.status}`), { kind: 'http' })

  const text = await res.text()
  // Overpass sometimes returns 200 with an HTML error body when overloaded.
  if (!text.trimStart().startsWith('{')) {
    throw Object.assign(new Error('Overpass returned a non-JSON body (likely overloaded)'), { kind: 'timeout' })
  }
  return JSON.parse(text).elements ?? []
}

/**
 * Fetch one category within a bbox, splitting into quadrants when Overpass
 * times out. Dense metros (NYC playgrounds) exceed the query budget as one
 * box but succeed as four; `--max-depth 2` allows up to 16 sub-boxes.
 *
 * Before splitting, the same query is retried once after a long cooldown.
 * This matters: the public Overpass instance returns 504 both for a genuinely
 * oversized query AND for slot exhaustion when you've been querying too
 * fast. Splitting a congestion-504 quadruples the very load that caused it,
 * which is exactly the cascade observed on the first Albuquerque run — three
 * categories failed after splitting, having succeeded moments earlier as
 * single queries. A cooldown distinguishes the two cases for free: if the
 * retry succeeds the query was never too big.
 */
async function fetchCategoryInBbox(category, bbox, depth = 0, cooledDown = false) {
  const query = buildOverpassQueryForBbox(category, bbox, args.timeoutSec)
  try {
    const elements = await overpassRequest(query)
    await sleep(args.throttleMs)
    return { elements, splits: 0 }
  } catch (err) {
    if (err.kind !== 'timeout') throw err

    if (!cooledDown) {
      console.log(`      504 at depth ${depth} — cooling down ${args.cooldownMs}ms and retrying the same bbox`)
      await sleep(args.cooldownMs)
      return fetchCategoryInBbox(category, bbox, depth, true)
    }

    if (depth >= args.maxDepth) throw err

    console.log(`      still 504 after cooldown — splitting bbox into 4 (${bboxString(bbox)})`)
    await sleep(args.throttleMs)
    let all = []
    let splits = 1
    for (const q of quadrants(bbox)) {
      const sub = await fetchCategoryInBbox(category, q, depth + 1)
      all = all.concat(sub.elements)
      splits += sub.splits
    }
    return { elements: all, splits }
  }
}

// ── SQL emission ─────────────────────────────────────────────────────────

// Column list, escaping, UPSERT semantics and byte-budgeted chunking all live
// in lib/seedSql.mjs, shared with the IMLS importers (#353) and unit-tested
// there. `indoor`/`opening_hours`/`source_url` are OSM-managed extras on top
// of the shared SET clause.
const OSM_UPSERT_EXTRA = [
  'indoor=excluded.indoor',
  'opening_hours=COALESCE(excluded.opening_hours, items.opening_hours)',
  'source_url=excluded.source_url',
]

function buildSql(metro, rows, stats) {
  return buildImportSql(rows, {
    setClause: buildUpsertSet(OSM_UPSERT_EXTRA),
    headerLines: [
      `-- National OSM bootstrap — ${metro.label} (${metro.id})`,
      `-- Generated ${new Date().toISOString()} by worker/scripts/ingest-osm-national.mjs (#352)`,
      `-- bbox ${bboxString(metro.contentBbox)}`,
      `-- ${stats.fetched} elements fetched → ${rows.length} rows (${stats.skipped} skipped: unnamed, no coords, or outside bbox` +
        `${stats.ceded ? `; ${stats.ceded} ceded to neighbouring metros` : ''})`,
      `-- Tier C: confidence='${NATIONAL_CONFIDENCE}', status='${NATIONAL_STATUS}' (trusted source auto-approve, plan §1.6)`,
      '-- UPSERT preserves curator decisions: rejected/archived/approved rows keep their status.',
      '-- Statements are byte-budgeted under D1\'s 100 KB SQL statement cap.',
      '-- No BEGIN/COMMIT — D1 rejects SQL-level transactions.',
    ],
  })
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const metros = selectMetros()
  const categories = selectCategories()
  if (!metros.length) {
    console.error('no metros selected')
    process.exit(1)
  }

  if (!args.dryRun) mkdirSync(args.outDir, { recursive: true })
  const checkpoint = loadCheckpoint()

  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}${metros.length} metro(s) × ${categories.length} categor(ies) ` +
    `= ${metros.length * categories.length} Overpass queries, ~${args.throttleMs}ms apart`,
  )
  console.log(`tier: confidence='${NATIONAL_CONFIDENCE}' status='${NATIONAL_STATUS}'`)
  console.log('')

  const written = []
  const partial = []
  const failures = []
  let grandTotal = 0

  for (const metro of metros) {
    console.log(`── ${metro.label} (${metro.id}) ${bboxString(metro.contentBbox)}`)
    // Per-category rows, whether freshly fetched or replayed from cache.
    // Cross-category dedup happens ONCE at assembly, in OSM_CATEGORIES
    // order, so the winning category for a cross-tagged object (a zoo is
    // often tourism=zoo AND tourism=museum) is identical no matter which
    // categories this run fetched vs replayed. The previous shape inserted
    // fetched categories first, so `--categories museum` flipped such
    // objects from aquarium to museum and UPSERTed the flip into D1
    // (deep-review finding L1).
    const rowsByCategory = new Map()
    const stats = { fetched: 0, skipped: 0, splits: 0, ceded: 0 }
    let metroFailed = false

    for (const category of categories) {
      const key = `${metro.id}:${category}`
      const fp = fingerprint(metro, category)
      const done = checkpoint.done[key]
      if (!args.force && done) {
        if (done.fingerprint && done.fingerprint !== fp) {
          console.log(`   ${category.padEnd(11)} ! bbox/query changed since cache was written — re-fetching`)
        } else {
          const cached = readCachedRows(metro.id, category)
          if (cached) {
            // Caches written before the cede fix can carry rows stamped with
            // a neighbouring region (or 'bay'). Never let them back in — the
            // invariant is that every row this metro emits has its region.
            const own = cached.filter((r) => r.region === metro.id)
            rowsByCategory.set(category, own)
            const dropped = cached.length - own.length
            console.log(
              `   ${category.padEnd(11)} ✓ cached (${own.length} rows) — not re-fetching` +
              `${dropped ? ` (dropped ${dropped} stale cross-metro rows)` : ''}`,
            )
            continue
          }
          // Checkpointed but the cache is gone (hand-deleted, or written by an
          // older run). Re-fetch rather than silently emit an incomplete metro.
          console.log(`   ${category.padEnd(11)} ! checkpointed but cache missing — re-fetching`)
        }
      }
      try {
        const { elements, splits } = await fetchCategoryInBbox(category, metro.contentBbox)
        stats.fetched += elements.length
        stats.splits += splits
        const categoryRows = []
        for (const el of elements) {
          const item = overpassElementToItem(el, category, {
            region: metro.id,
            bbox: metro.contentBbox,
            confidence: NATIONAL_CONFIDENCE,
            status: NATIONAL_STATUS,
          })
          if (!item) { stats.skipped++; continue }
          // Contested elements (inside a neighbouring metro's bbox too) are
          // CEDED, not reassigned — see resolveNationalRegion's doc comment.
          // Reassigning let this walk emit rows for regions it was never
          // asked to touch: a sacramento walk wrote region='bay' rows.
          // Ceding is lossless: the canonical metro's own walk fetches the
          // same element from its own bbox.
          if (resolveNationalRegion(metro.id, item.lat, item.lng, metroForCoords) === null) {
            stats.ceded++
            continue
          }
          categoryRows.push(item)
        }
        rowsByCategory.set(category, categoryRows)
        const unnamed = elements.length - categoryRows.length
        console.log(
          `   ${category.padEnd(11)} ${String(elements.length).padStart(6)} elements → ${String(categoryRows.length).padStart(6)} rows` +
          `${unnamed ? ` (${unnamed} dropped: unnamed / no coords / outside bbox / ceded to neighbour)` : ''}` +
          `${splits ? ` [${splits} split queries]` : ''}`,
        )
        writeCachedRows(metro.id, category, categoryRows)
        checkpoint.done[key] = { rows: categoryRows.length, at: new Date().toISOString(), fingerprint: fp }
        saveCheckpoint(checkpoint)
      } catch (err) {
        metroFailed = true
        console.error(`   ${category.padEnd(11)} FAILED: ${err.message}`)
        failures.push({ metro: metro.id, category, error: err.message })
      }
    }

    // The metro's SQL file is rebuilt from scratch every run, so it must
    // contain EVERY category we've ever fetched for this metro — not just the
    // ones selected this run. Unselected categories replay from cache;
    // without that, `--categories playground` would rewrite austin.sql as
    // playgrounds-only.
    let replayed = 0
    for (const category of OSM_CATEGORIES) {
      if (rowsByCategory.has(category)) continue
      const cached = readCachedRows(metro.id, category)
      if (!cached) continue
      // Same stale-cache guard as the checkpoint path: pre-cede caches can
      // carry cross-metro rows, and this metro emits only its own region.
      const own = cached.filter((r) => r.region === metro.id)
      rowsByCategory.set(category, own)
      replayed += own.length
    }
    if (replayed) {
      console.log(`   (replayed ${replayed} rows from unselected categories so the file stays complete)`)
    }

    // Assembly: one cross-category dedup pass in fixed OSM_CATEGORIES order.
    const byId = new Map()
    for (const category of OSM_CATEGORIES) {
      for (const item of rowsByCategory.get(category) ?? []) {
        if (!byId.has(item.id)) byId.set(item.id, item)
      }
    }
    if (stats.ceded) {
      console.log(`   (ceded ${stats.ceded} contested rows to neighbouring metros — each walk emits only its own region)`)
    }

    const rows = [...byId.values()]
    grandTotal += rows.length
    if (!rows.length) {
      console.log(`   → no rows${metroFailed ? ' (all categories failed)' : ''}\n`)
      continue
    }

    const outFile = path.join(args.outDir, `${metro.id}.sql`)
    if (args.dryRun) {
      console.log(`   → [dry-run] would write ${rows.length} rows to ${path.relative(REPO_ROOT, outFile)}\n`)
    } else {
      const sql = buildSql(metro, rows, stats)
      writeFileSync(outFile, sql)
      // A metro with a failed category is written (partial output beats none)
      // but withheld from the prod-apply list below — in 50 metros of scroll
      // the failure summary is easy to miss, and applying a partial metro
      // publishes an incomplete map for it.
      if (metroFailed) partial.push(outFile)
      else written.push(outFile)
      const biggest = maxStatementBytes(sql)
      const warn = biggest > D1_MAX_STATEMENT_BYTES ? `  ⚠️ exceeds D1's ${D1_MAX_STATEMENT_BYTES}B statement cap` : ''
      console.log(
        `   → wrote ${rows.length} rows to ${path.relative(REPO_ROOT, outFile)}` +
        ` (largest statement ${(biggest / 1024).toFixed(1)} KB)${warn}\n`,
      )
    }
  }

  console.log(`total: ${grandTotal} rows across ${metros.length} metro(s)`)
  if (failures.length) {
    console.log(`\n${failures.length} failed (metro, category) pair(s) — NOT checkpointed, so a re-run retries them:`)
    for (const f of failures) console.log(`   ${f.metro}:${f.category} — ${f.error}`)
  }

  if (args.dryRun) {
    console.log('\n[dry-run] no files written, no database touched.')
    return
  }

  const applyTargets = [...written, ...partial]
  if (args.applyLocal && applyTargets.length) {
    console.log('\napplying to LOCAL D1 via wrangler…')
    for (const file of applyTargets) {
      const rel = path.relative(path.join(REPO_ROOT, 'worker'), file)
      const res = spawnSync(
        'npx',
        ['wrangler', 'd1', 'execute', 'frolicmap-prod', '--local', '--file', rel],
        { cwd: path.join(REPO_ROOT, 'worker'), stdio: 'inherit', shell: false },
      )
      if (res.status !== 0) {
        console.error(`wrangler failed on ${rel}`)
        process.exit(1)
      }
    }
    console.log('local apply complete.')
  }

  if (partial.length) {
    console.log(
      `\n${partial.length} metro file(s) are INCOMPLETE (a category failed) and are deliberately\n` +
      'omitted from the apply list below. Re-run to heal them — failed pairs are not\n' +
      'checkpointed — then apply:',
    )
    for (const file of partial) console.log(`   ${path.relative(REPO_ROOT, file)}`)
  }

  if (written.length) {
    console.log('\nTo apply to PRODUCTION (review the SQL first — these rows land approved):')
    for (const file of written) {
      console.log(`  npx wrangler d1 execute frolicmap-prod --remote --file ${path.relative(path.join(REPO_ROOT, 'worker'), file)}`)
    }
  }
}

await main()
