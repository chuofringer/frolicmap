#!/usr/bin/env node
// Tier 1 of issue #280 cleanup. Read-only D1 audit:
//   1. Fetches approved + pending items via the admin API (cloudflared
//      access curl handles CF Access auth — `cloudflared access login
//      https://funradar.app/admin` once if not already authed).
//   2. Clusters them with the same sameCanonicalEvent heuristic as
//      merge-aggregators.mjs (lib/dedupCluster.mjs).
//   3. Writes a markdown audit report (data/duplicate-cleanup-{date}.md)
//      + a shell script (data/duplicate-cleanup-{date}.sh) that calls
//      the admin reject endpoint for the duplicates. Both are
//      gitignored — output goes to data/.
//
// **Nothing mutates D1**. The script picks a "winner" per cluster (most
// recent last_verified, approved > pending) and proposes rejecting the
// rest. Curator must review the markdown report and explicitly run the
// .sh file to apply.
//
// Usage:
//   node worker/scripts/find-duplicate-items.mjs
//
//   ./data/duplicate-cleanup-YYYY-MM-DD.sh   # only after reviewing the .md
//
// Tier 2 (PR #281) handles cross-week dedup at routine merge time;
// Tier 1 cleans up the existing duplicate backlog in D1 from W17-W18-pre-fix.

import { execSync } from 'node:child_process'
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sameCanonicalEvent } from './lib/dedupCluster.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const OUT_DIR = resolve(REPO_ROOT, 'data')
const ADMIN_BASE = 'https://api.funradar.app'

function fetchAdminItems(status) {
  const url = `${ADMIN_BASE}/api/admin/items?status=${status}`
  // cloudflared access curl puts curl flags AFTER the URL — putting --silent
  // before makes cloudflared try to parse it as the URL and exit.
  const cmd = `cloudflared access curl ${url} --silent`
  let stdout
  try {
    stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    console.error(`fetchAdminItems(${status}) failed:`, err.message)
    console.error('Run "cloudflared access login https://funradar.app/admin" first.')
    process.exit(1)
  }
  let parsed
  try { parsed = JSON.parse(stdout) }
  catch {
    console.error(`fetchAdminItems(${status}): non-JSON response. Likely an auth redirect — re-run cloudflared login.`)
    console.error(stdout.slice(0, 500))
    process.exit(1)
  }
  if (!parsed.items || !Array.isArray(parsed.items)) {
    console.error(`fetchAdminItems(${status}): unexpected payload shape`, Object.keys(parsed))
    process.exit(1)
  }
  return parsed.items
}

console.log('Fetching approved + pending items from admin API...')
const approved = fetchAdminItems('approved')
const pending = fetchAdminItems('pending')
console.log(`  approved: ${approved.length}  pending: ${pending.length}`)

// Only event rows are subject to the duplicate problem (places like OSM
// libraries don't have start_time and aren't routine-extracted with LLM
// drift). Filter to events to keep the audit signal-to-noise high.
const all = [...approved, ...pending]
  .filter((i) => i.type === 'event')
  .map((i) => ({ ...i, _statusBucket: i.status }))
console.log(`  event rows considered: ${all.length}`)

// Cluster greedily with allowAdjacentDays:true. Same algorithm as the
// merge script but applied to live D1 data.
const clusters = []
for (const row of all) {
  let placed = false
  for (const cluster of clusters) {
    if (sameCanonicalEvent(cluster[0], row, { allowAdjacentDays: true })) {
      cluster.push(row); placed = true; break
    }
  }
  if (!placed) clusters.push([row])
}

const dupClusters = clusters.filter((c) => c.length > 1)
const totalDupRows = dupClusters.reduce((n, c) => n + c.length, 0)
const proposedRejects = []   // {id, name, reason: 'superseded by <winner_id>'}
console.log(`Duplicate clusters: ${dupClusters.length}, total rows in clusters: ${totalDupRows}`)

// Within each cluster, pick the winner. Order:
//   1. rrule-bearing rows beat non-rrule (mode D: a recurring row carries
//      the whole future occurrence stream — never throw it away)
//   2. approved over pending
//   3. most recent last_verified
//   4. longest description as final tiebreaker
function pickWinner(cluster) {
  return [...cluster].sort((a, b) => {
    const ar = a.rrule ? 0 : 1
    const br = b.rrule ? 0 : 1
    if (ar !== br) return ar - br
    const sa = a._statusBucket === 'approved' ? 0 : 1
    const sb = b._statusBucket === 'approved' ? 0 : 1
    if (sa !== sb) return sa - sb
    const la = a.last_verified ?? ''
    const lb = b.last_verified ?? ''
    if (la !== lb) return lb.localeCompare(la)
    return (b.description?.length ?? 0) - (a.description?.length ?? 0)
  })[0]
}

for (const cluster of dupClusters) {
  const winner = pickWinner(cluster)
  for (const row of cluster) {
    if (row.id === winner.id) continue
    proposedRejects.push({
      id: row.id,
      name: row.name,
      status: row._statusBucket,
      lat: row.lat, lng: row.lng,
      start_time: row.start_time,
      last_verified: row.last_verified,
      winner_id: winner.id,
      winner_name: winner.name,
    })
  }
}

mkdirSync(OUT_DIR, { recursive: true })
const date = new Date().toISOString().slice(0, 10)
const reportPath = resolve(OUT_DIR, `duplicate-cleanup-${date}.md`)
const scriptPath = resolve(OUT_DIR, `duplicate-cleanup-${date}.sh`)

const reportLines = [
  `# Duplicate-event cleanup audit — ${date}`,
  ``,
  `Issue #280 Tier 1. **Nothing has been changed in D1.** This report lists`,
  `proposed rejects; review and run the companion .sh file to apply.`,
  ``,
  `## Summary`,
  ``,
  `- Approved + pending event rows scanned: **${all.length}**`,
  `- Clusters with ≥2 rows: **${dupClusters.length}**`,
  `- Rows in those clusters: **${totalDupRows}**`,
  `- Proposed rejects (winner kept, rest rejected): **${proposedRejects.length}**`,
  ``,
  `Winner-pick rule: \`approved\` over \`pending\`, then most recent`,
  `\`last_verified\`, then longest description.`,
  ``,
  `## Clusters`,
  ``,
]

for (let idx = 0; idx < dupClusters.length; idx++) {
  const cluster = dupClusters[idx]
  const winner = pickWinner(cluster)
  reportLines.push(`### Cluster ${idx + 1} — \`${winner.name.replace(/\|/g, '\\|')}\``)
  reportLines.push(``)
  reportLines.push(`| keep | id | name | status | coords | start_time | rrule | last_verified |`)
  reportLines.push(`|---|---|---|---|---|---|---|---|`)
  for (const row of cluster) {
    const keep = row.id === winner.id ? '✓ **KEEP**' : '✗ reject'
    const coords = `(${row.lat.toFixed(4)}, ${row.lng.toFixed(4)})`
    const name = row.name.replace(/\|/g, '\\|')
    const rrule = row.rrule ? '✓' : '—'
    reportLines.push(`| ${keep} | \`${row.id}\` | ${name} | ${row._statusBucket} | ${coords} | ${row.start_time ?? '—'} | ${rrule} | ${row.last_verified ?? '—'} |`)
  }
  reportLines.push(``)
}

writeFileSync(reportPath, reportLines.join('\n') + '\n')
console.log(`Wrote audit report: ${reportPath}`)

const scriptLines = [
  `#!/usr/bin/env bash`,
  `# Generated by find-duplicate-items.mjs on ${date}.`,
  `# Issue #280 Tier 1 — apply duplicate-cleanup rejects via the admin API.`,
  `# Review the companion .md file before running.`,
  ``,
  `set -e`,
  `TOTAL=${proposedRejects.length}`,
  `echo "About to reject $TOTAL items via cloudflared. Press Ctrl-C to abort, Enter to continue."`,
  `read -r _`,
  ``,
]
let n = 0
for (const r of proposedRejects) {
  n++
  scriptLines.push(`# [${n}/${proposedRejects.length}] ${r.status} → reject  (${r.name.replace(/[\r\n]+/g, ' ').slice(0, 80)})`)
  scriptLines.push(`# superseded by ${r.winner_id}`)
  scriptLines.push(
    `cloudflared access curl ${ADMIN_BASE}/api/admin/items/${encodeURIComponent(r.id)}/reject --silent -X POST -o /dev/null -w "  reject ${r.id} → %{http_code}\\n"`
  )
  scriptLines.push(``)
}
scriptLines.push(`echo "Done."`)

writeFileSync(scriptPath, scriptLines.join('\n') + '\n')
chmodSync(scriptPath, 0o755)
console.log(`Wrote cleanup script:  ${scriptPath}`)
console.log()
console.log(`Next steps:`)
console.log(`  1. Open ${reportPath.replace(REPO_ROOT, '.')} and spot-check 10-20 clusters.`)
console.log(`  2. If happy, run ${scriptPath.replace(REPO_ROOT, '.')}`)
console.log(`  3. Spot-check the live map at funradar.app for visible duplicate reduction.`)
