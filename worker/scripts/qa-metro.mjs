#!/usr/bin/env node
/**
 * Per-metro QA harness — issue #357, plan §4A.3.
 *
 * Reads a metro's approved rows out of D1 and prints a pass/fail report.
 * Read-only: it never writes to any database.
 *
 *   node worker/scripts/qa-metro.mjs --metro seattle --remote
 *   node worker/scripts/qa-metro.mjs --wave --remote
 *
 * This replaces hand curation as the launch gate. At 50K auto-approved rows
 * per wave nobody can review rows, so **a human signs off on this report, not
 * on rows** (plan §4A.3). Any `fail` blocks `promote-metro`; warnings are
 * information for whoever signs.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runQa } from './lib/qaChecks.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_DIR = path.resolve(__dirname, '..')

if (!process.features.typescript && !process.env.__QA_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __QA_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro } = await import('../../shared/metros.ts')

function parseArgs(argv) {
  const args = { metros: null, wave: false, all: false, remote: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--wave') args.wave = true
    else if (a === '--all') args.all = true
    else if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') {
      console.log(`
qa-metro.mjs — per-metro QA harness (#357)

  --metro <ids>   Comma-separated metro ids.
  --wave          The 12 September wave metros.
  --all           Every metro in the registry.
  --remote        Read the REMOTE D1 (default: local).
  --json          Machine-readable output (used by promote-metro).

Read-only. Exits non-zero when any metro fails, so it can gate a workflow.
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.metros && !args.wave && !args.all) {
    console.error('one of --metro / --wave / --all is required'); process.exit(1)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

function d1(sql) {
  const res = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'funradar-prod', args.remote ? '--remote' : '--local', '--json', '--command', sql],
    { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false },
  )
  if (res.status !== 0) throw new Error(`wrangler failed: ${(res.stderr || '').slice(0, 200)}`)
  const start = res.stdout.indexOf('[')
  if (start < 0) throw new Error('no JSON in wrangler output')
  return JSON.parse(res.stdout.slice(start))[0]?.results ?? []
}

function selectMetros() {
  if (args.all) return METROS
  if (args.wave) return METROS.filter((m) => m.wave)
  const unknown = args.metros.filter((id) => !getMetro(id))
  if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
  return METROS.filter((m) => args.metros.includes(m.id))
}

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌' }

function report(r, metro) {
  console.log(`\n━━ ${r.label} (${r.metro}) — ${r.verdict}`)
  console.log(`   ${r.rows} approved rows${metro.published ? '' : '  ·  not yet published'}`)
  for (const c of r.checks) {
    console.log(`   ${ICON[c.status]} ${c.label.padEnd(30)} ${c.detail}`)
    if (c.evidence?.length && c.status !== 'pass') {
      for (const e of c.evidence) console.log(`        ${e}`)
    }
  }
}

async function main() {
  const metros = selectMetros()
  const results = []

  for (const metro of metros) {
    const rows = d1(
      "SELECT id, name, category, lat, lng, confidence, source_url FROM items " +
      `WHERE region='${metro.id}' AND status='approved'`,
    )
    const archived = d1(
      `SELECT COUNT(*) AS n FROM items WHERE region='${metro.id}' AND status='archived'`,
    )[0]?.n ?? 0
    const r = runQa(metro, rows, { archivedCount: archived })
    results.push(r)
    if (!args.json) report(r, metro)
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    const failed = results.filter((r) => !r.canPublish)
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`${results.length} metro(s): ${results.length - failed.length} pass, ${failed.length} fail`)
    if (failed.length) console.log(`blocked: ${failed.map((r) => r.metro).join(', ')}`)
  }

  // Non-zero exit when any metro fails, so promote-metro and CI can gate on it.
  process.exit(results.some((r) => !r.canPublish) ? 1 : 0)
}

await main()
