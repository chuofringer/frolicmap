#!/usr/bin/env node
// Bulk re-geocode of approved EVENT rows against Geocodio (issue #306).
//
// Scope: only `type='event'` rows. Static places (OSM playgrounds, libraries,
// museums, parks, beaches, U-Pick farms) have authoritative or curator-locked
// coords and are out of scope per the operator. Event coords drift because:
//   - LLM-extracted aggregator routines emit fresh lat/lng per week
//   - Pre-Geocodio routine runs landed before validateCoords was wired in
//   - Seed rows used estimated coords
//   - Different sources for the same venue disagree on the rooftop pin
//
// Read-only audit + curator-reviewed apply, modelled on
// snap-same-address-coords.mjs:
//   node worker/scripts/regeocode-d1.mjs
//     → cloudflared admin curl: approved items
//     → filter to type='event' with non-empty address
//     → validateCoords() (reuses the 4-guard chain in lib/validateCoords.mjs)
//     → writes data/regeocode-{date}.md (audit report)
//     → writes data/regeocode-{date}.sh (admin PUT calls for 'correct' rows)
//
// Curator reviews the .md, then runs the .sh. 'reject' rows (≥10mi drift)
// are emitted commented-out in the .sh so the curator can opt in deliberately.
//
// Cost: ~5000 event rows = 1 batch request ≈ $0.50 on Geocodio paid tier;
// free tier 2500/day covers a single weekly run.

import { execSync } from 'node:child_process'
import { writeFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCoords } from './lib/validateCoords.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const WORKER_ROOT = resolve(HERE, '..')
const OUT_DIR = resolve(REPO_ROOT, 'data')
const ADMIN_BASE = 'https://api.funradar.app'

// Geocodio's batch endpoint accepts up to 10000 addresses; event corpus is
// ~5000 max, so a single batch covers a full run.
const BATCH_SIZE = 10000

const devVarsPath = resolve(WORKER_ROOT, '.dev.vars')
const devVars = readFileSync(devVarsPath, 'utf8')
const apiKey = devVars.match(/^GEOCODIO_API_KEY=(.+)$/m)?.[1]?.trim()
if (!apiKey) {
  console.error('GEOCODIO_API_KEY not found in worker/.dev.vars')
  process.exit(1)
}

function fetchAdminItems(status) {
  const url = `${ADMIN_BASE}/api/admin/items?status=${status}`
  const cmd = `cloudflared access curl ${url} --silent`
  let stdout
  try {
    stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 128 * 1024 * 1024 })
  } catch (err) {
    console.error(`fetchAdminItems(${status}) failed:`, err.message)
    process.exit(1)
  }
  try {
    return JSON.parse(stdout).items ?? []
  } catch {
    console.error(`fetchAdminItems(${status}): non-JSON response`)
    console.error(stdout.slice(0, 500))
    process.exit(1)
  }
}

console.log('Fetching approved items...')
const approved = fetchAdminItems('approved')
console.log(`  approved (all types): ${approved.length}`)

const events = approved.filter((i) => i.type === 'event')
console.log(`  approved events:     ${events.length}`)

const candidates = events.filter((i) => i.address && i.lat != null && i.lng != null)
const skippedNoAddress = events.length - candidates.length
console.log(`  with address+coord:  ${candidates.length}`)
console.log(`  skipped (no address): ${skippedNoAddress}`)

if (candidates.length === 0) {
  console.log('Nothing to validate. Exiting.')
  process.exit(0)
}

// Batch through Geocodio. Single batch covers the current corpus; loop is
// future-proofing for when event volume grows past 10k.
const decisions = []
for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
  const slice = candidates.slice(i, i + BATCH_SIZE)
  console.log(`Geocoding batch ${i / BATCH_SIZE + 1} (${slice.length} rows)...`)
  const batchDecisions = await validateCoords(
    slice.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, address: r.address })),
    apiKey
  )
  decisions.push(...batchDecisions)
}

// Index back to source rows for richer report output (name, source_type).
const rowById = new Map(events.map((r) => [r.id, r]))

const buckets = { correct: [], reject: [], unverified: [], keep: [] }
for (const d of decisions) {
  const row = rowById.get(d.id)
  if (!row) continue
  buckets[d.action].push({ ...d, row })
}

console.log('Decisions:')
console.log(`  correct:    ${buckets.correct.length}`)
console.log(`  reject:     ${buckets.reject.length} (≥10mi drift, commented in apply script)`)
console.log(`  unverified: ${buckets.unverified.length}`)
console.log(`  keep:       ${buckets.keep.length}`)

mkdirSync(OUT_DIR, { recursive: true })
const date = new Date().toISOString().slice(0, 10)
const reportPath = resolve(OUT_DIR, `regeocode-${date}.md`)
const scriptPath = resolve(OUT_DIR, `regeocode-${date}.sh`)

function escMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}

const reportLines = [
  `# Bulk re-geocode audit — ${date}`,
  ``,
  `Issue #306. **Nothing has been changed in D1.** Reused the 4-guard`,
  `Geocodio chain in \`worker/scripts/lib/validateCoords.mjs\` (accuracy_type`,
  `∈ {rooftop, range_interpolation, point} · accuracy ≥ 0.9 · ZIP match ·`,
  `inside Bay Area bbox). Drift threshold 0.1mi, tolerance 0.05mi.`,
  ``,
  `Scope: \`status='approved' AND type='event'\` only. Static places (OSM,`,
  `U-Pick, hand-curated venues) are out of scope.`,
  ``,
  `## Summary`,
  ``,
  `- Approved rows (all types):      **${approved.length}**`,
  `- Approved events:                **${events.length}**`,
  `- Events with address + coord:    **${candidates.length}**`,
  `- Skipped (no address):           **${skippedNoAddress}**`,
  ``,
  `### Decisions`,
  ``,
  `| action | count | meaning |`,
  `|---|---:|---|`,
  `| correct    | ${buckets.correct.length} | Geocodio passed all guards AND disagreed with stored by ≥0.1mi → apply via PUT |`,
  `| reject     | ${buckets.reject.length} | Stored coord ≥10mi off, Geocodio confident → curator opt-in (commented in .sh) |`,
  `| unverified | ${buckets.unverified.length} | Geocodio failed a guard or returned no result → keep stored |`,
  `| keep       | ${buckets.keep.length} | Within tolerance, no change |`,
  ``,
]

function appendBucketTable(title, entries, opts = {}) {
  reportLines.push(`## ${title} (${entries.length})`)
  reportLines.push(``)
  if (!entries.length) {
    reportLines.push(`_None._`)
    reportLines.push(``)
    return
  }
  reportLines.push(`| id | name | source_type | address | stored → geocoded | reason |`)
  reportLines.push(`|---|---|---|---|---|---|`)
  const sorted = opts.sortByDelta
    ? [...entries].sort((a, b) => {
        const da = haversineMiles(a.originalLat, a.originalLng, a.lat, a.lng)
        const db = haversineMiles(b.originalLat, b.originalLng, b.lat, b.lng)
        return db - da
      })
    : entries
  for (const e of sorted) {
    const r = e.row
    const move = (e.action === 'correct' || e.action === 'reject')
      ? `(${e.originalLat.toFixed(4)}, ${e.originalLng.toFixed(4)}) → (${e.lat.toFixed(4)}, ${e.lng.toFixed(4)})`
      : `(${e.originalLat.toFixed(4)}, ${e.originalLng.toFixed(4)})`
    reportLines.push(
      `| \`${e.id}\` | ${escMd(r.name)} | ${r.source_type} | ${escMd(r.address)} | ${move} | ${escMd(e.reason)} |`
    )
  }
  reportLines.push(``)
}

appendBucketTable('Correct (will be applied if you run the .sh)', buckets.correct, { sortByDelta: true })
appendBucketTable('Reject (commented in .sh — curator opt-in)', buckets.reject, { sortByDelta: true })
appendBucketTable('Unverified (no change; review on next audit pass)', buckets.unverified)

writeFileSync(reportPath, reportLines.join('\n') + '\n')
console.log(`Wrote audit report: ${reportPath}`)

const scriptLines = [
  `#!/usr/bin/env bash`,
  `# Generated by regeocode-d1.mjs on ${date} (issue #306).`,
  `# Applies Geocodio-corrected coords to approved event rows via the admin`,
  `# PUT endpoint. Uses cloudflared access for the CF Access JWT.`,
  `set -e`,
  `TOTAL=${buckets.correct.length}`,
  `echo "About to update lat/lng on $TOTAL items via cloudflared. Press Ctrl-C to abort, Enter to continue."`,
  `read -r _`,
  ``,
]

let n = 0
for (const e of buckets.correct) {
  n++
  const body = JSON.stringify({ lat: e.lat, lng: e.lng })
  scriptLines.push(`# [${n}/${buckets.correct.length}] ${escMd(e.row.name).slice(0, 60)}`)
  scriptLines.push(`#   address: ${escMd(e.row.address)}`)
  scriptLines.push(`#   ${e.originalLat.toFixed(4)},${e.originalLng.toFixed(4)} → ${e.lat.toFixed(4)},${e.lng.toFixed(4)}  (${escMd(e.reason)})`)
  scriptLines.push(
    `cloudflared access curl ${ADMIN_BASE}/api/admin/items/${encodeURIComponent(e.id)} --silent -X PUT -H 'content-type: application/json' -d '${body}' -o /dev/null -w "  fix ${e.id} -> %{http_code}\\n"`
  )
  scriptLines.push(``)
}

if (buckets.reject.length) {
  scriptLines.push(`# ---- REJECT bucket (≥10mi drift, Geocodio confident) ----`)
  scriptLines.push(`# These rows look like address typos or fake coords. Uncomment to apply`)
  scriptLines.push(`# the Geocodio coord, or delete the row instead via the admin UI.`)
  scriptLines.push(``)
  for (const e of buckets.reject) {
    const body = JSON.stringify({ lat: e.lat, lng: e.lng })
    scriptLines.push(`# ${escMd(e.row.name).slice(0, 60)}`)
    scriptLines.push(`#   address: ${escMd(e.row.address)}`)
    scriptLines.push(`#   ${e.originalLat.toFixed(4)},${e.originalLng.toFixed(4)} → ${e.lat.toFixed(4)},${e.lng.toFixed(4)}  (${escMd(e.reason)})`)
    scriptLines.push(
      `# cloudflared access curl ${ADMIN_BASE}/api/admin/items/${encodeURIComponent(e.id)} --silent -X PUT -H 'content-type: application/json' -d '${body}' -o /dev/null -w "  fix ${e.id} -> %{http_code}\\n"`
    )
    scriptLines.push(``)
  }
}

scriptLines.push(`echo "Done."`)

writeFileSync(scriptPath, scriptLines.join('\n') + '\n')
chmodSync(scriptPath, 0o755)
console.log(`Wrote apply script:  ${scriptPath}`)

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
