#!/usr/bin/env node
// Automated post-merge coord snap. Runs in the aggregators-merge GH Action
// (after the seed SQL is applied) to consolidate same-venue pins that have
// drifted across weekly extracts.
//
// Distinct from the curator-reviewed snap-same-address-coords.mjs (which
// uses cloudflared admin auth + emits .md + .sh for human review). This
// script uses `wrangler d1 execute --remote` directly so it can run
// unattended in CI with the same secrets the merge already needs.
//
// Algorithm: query all approved event rows from D1, group by normalized
// street address (lib/normalizeAddress.mjs), and for each group with ≥2
// distinct coord buckets snap all rows to the most-frequent bucket
// (tie-break: most-recent `last_verified`). See lib/coordSnap.mjs.
//
// Emits worker/scripts/snap-coords.sql with the UPDATE statements. The
// workflow's next step applies it via `wrangler d1 execute --file`. Idempotent:
// if no drift is present the file is a single comment line and the apply
// step is a no-op.
//
// Limited to events of `source_type LIKE 'aggregator-%'` plus the legacy
// `manual` hand-seeds — these are the rows that the LLM-extracted-coord
// drift affects. OSM/BiblioCommons rows have authoritative upstream
// coords and shouldn't be snapped against each other.

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeCoordSnaps } from './lib/coordSnap.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKER_ROOT = resolve(HERE, '..')
const OUT_SQL = resolve(HERE, 'snap-coords.sql')

// Only snap rows whose coords come from LLM-extracted addresses. OSM and
// BiblioCommons have authoritative upstream lat/lng and are excluded.
const SOURCE_TYPE_FILTER = `source_type LIKE 'aggregator-%' OR source_type = 'manual'`

function queryD1(sql) {
  const cmd = `npx wrangler d1 execute funradar-prod --remote --json --command ${JSON.stringify(sql)}`
  let stdout
  try {
    stdout = execSync(cmd, {
      encoding: 'utf8',
      cwd: WORKER_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    console.error('wrangler d1 execute failed:', err.message)
    process.exit(1)
  }
  let parsed
  try { parsed = JSON.parse(stdout) }
  catch {
    console.error('wrangler d1 execute returned non-JSON; first 500 chars:')
    console.error(stdout.slice(0, 500))
    process.exit(1)
  }
  // wrangler d1 execute --json shape: [{ results: [...], success: true, ... }]
  return parsed[0]?.results ?? parsed.results ?? []
}

const sql =
  `SELECT id, address, lat, lng, last_verified FROM items ` +
  `WHERE status='approved' AND type='event' AND (${SOURCE_TYPE_FILTER})`
console.log(`Querying approved aggregator+manual event rows from D1…`)
const rows = queryD1(sql)
console.log(`  rows fetched: ${rows.length}`)

const snaps = computeCoordSnaps(rows)
console.log(`  drift snaps proposed: ${snaps.length}`)

const now = new Date().toISOString()
const esc = (v) => `'${String(v).replace(/'/g, "''")}'`

if (!snaps.length) {
  writeFileSync(OUT_SQL, `-- No same-address coord drift detected (${now}). No-op.\n`)
  console.log(`Wrote no-op snap SQL: ${OUT_SQL}`)
  process.exit(0)
}

const lines = [
  `-- Same-address coord snap (auto-generated ${now}).`,
  `-- ${snaps.length} approved rows aligned to per-address canonical coord.`,
  `-- Bucket width ~30m; canonical = most-frequent bucket, tiebreak most-recent verified.`,
]
for (const s of snaps) {
  lines.push(
    `UPDATE items SET lat=${s.target.lat}, lng=${s.target.lng}, updated_at=${esc(now)} ` +
    `WHERE id=${esc(s.id)}; ` +
    `-- ${s.current.lat.toFixed(4)},${s.current.lng.toFixed(4)} → ${s.target.lat.toFixed(4)},${s.target.lng.toFixed(4)} (${s.address?.slice(0, 60) ?? ''})`
  )
}

writeFileSync(OUT_SQL, lines.join('\n') + '\n')
console.log(`Wrote ${OUT_SQL} — ${snaps.length} UPDATE statements`)
