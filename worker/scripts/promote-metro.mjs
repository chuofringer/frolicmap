#!/usr/bin/env node
/**
 * promote-metro — one-command publish for a metro (issue #357, plan §4A.5).
 *
 *   node worker/scripts/promote-metro.mjs --metro seattle --remote
 *   node worker/scripts/promote-metro.mjs --wave --remote --yes
 *
 * Runs the QA harness, and only if it passes flips `published: true` in
 * `shared/metros.ts`. A failing metro is never promoted — that is the whole
 * point of the gate (plan §4A.3: a human signs off on the report, not on
 * rows).
 *
 * It edits source and stops there rather than deploying. `published` lives in
 * a TypeScript file that ships in both the Worker and the SPA bundle, so
 * going live means commit → CI → deploy. A script that mutated source *and*
 * pushed would hide the one step that is genuinely reviewable, and there'd be
 * no diff for anyone to look at afterwards.
 *
 * Page generation and deploy join this pipeline with #356.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { publishInSource } from './lib/publishMetro.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const METROS_TS = path.join(REPO_ROOT, 'shared/metros.ts')

if (!process.features.typescript && !process.env.__PROMOTE_REEXEC) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Needs Node >= 22.6 for type-stripping (found ${process.versions.node}).`)
    process.exit(1)
  }
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __PROMOTE_REEXEC: '1' } },
  )
  process.exit(res.status ?? 1)
}

const { METROS, getMetro } = await import('../../shared/metros.ts')

function parseArgs(argv) {
  const args = { metros: null, wave: false, remote: false, yes: false, skipQa: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--metro' || a === '--metros') args.metros = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--wave') args.wave = true
    else if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--skip-qa') args.skipQa = true
    else if (a === '--help' || a === '-h') {
      console.log(`
promote-metro.mjs — publish a metro after QA (#357)

  --metro <ids>   Comma-separated metro ids.
  --wave          The 12 September wave metros.
  --remote        QA against the REMOTE D1 (default: local).
  --yes           Apply the metros.ts edit (default is a preview).
  --skip-qa       Skip the QA gate. Requires --yes and prints a loud warning.

Flips \`published: true\` in shared/metros.ts. Commit + deploy to go live.
`)
      process.exit(0)
    } else { console.error(`unknown flag: ${a}`); process.exit(1) }
  }
  if (!args.metros && !args.wave) { console.error('one of --metro / --wave is required'); process.exit(1) }
  if (args.skipQa && !args.yes) { console.error('--skip-qa requires --yes'); process.exit(1) }
  return args
}

const args = parseArgs(process.argv.slice(2))

function selectMetros() {
  if (args.wave) return METROS.filter((m) => m.wave)
  const unknown = args.metros.filter((id) => !getMetro(id))
  if (unknown.length) { console.error(`unknown metro id(s): ${unknown.join(', ')}`); process.exit(1) }
  return METROS.filter((m) => args.metros.includes(m.id))
}

function runQaFor(ids) {
  const res = spawnSync(
    process.execPath,
    [path.join(__dirname, 'qa-metro.mjs'), '--metro', ids.join(','), args.remote ? '--remote' : '--local', '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false },
  )
  const start = res.stdout.indexOf('[')
  if (start < 0) {
    console.error('QA harness produced no report:')
    console.error((res.stderr || res.stdout).slice(0, 500))
    process.exit(1)
  }
  return JSON.parse(res.stdout.slice(start))
}

async function main() {
  const metros = selectMetros()
  const already = metros.filter((m) => m.published)
  const todo = metros.filter((m) => !m.published)

  if (already.length) console.log(`already published: ${already.map((m) => m.id).join(', ')}`)
  if (!todo.length) { console.log('nothing to promote.'); return }

  let blocked = []
  if (args.skipQa) {
    console.log('\n⚠️  --skip-qa: publishing without the QA gate. This is the check that')
    console.log('   catches a broken importer before 50,000 rows reach the public map.\n')
  } else {
    console.log(`\nrunning QA against ${args.remote ? 'REMOTE' : 'LOCAL'} D1 for ${todo.length} metro(s)…`)
    const reports = runQaFor(todo.map((m) => m.id))
    for (const r of reports) {
      const icon = r.canPublish ? '✅' : '❌'
      console.log(`  ${icon} ${r.metro.padEnd(14)} ${r.verdict}  (${r.rows} rows)`)
      if (!r.canPublish) {
        for (const c of r.checks.filter((x) => x.status === 'fail')) {
          console.log(`       ✗ ${c.label}: ${c.detail}`)
        }
      }
    }
    blocked = reports.filter((r) => !r.canPublish).map((r) => r.metro)
  }

  const promotable = todo.filter((m) => !blocked.includes(m.id))
  if (blocked.length) console.log(`\nblocked by QA: ${blocked.join(', ')}`)
  if (!promotable.length) { console.log('nothing promotable.'); process.exit(1) }

  console.log(`\npromotable: ${promotable.map((m) => m.id).join(', ')}`)
  if (!args.yes) {
    console.log('\n[preview] no files changed. Re-run with --yes to apply.')
    return
  }

  let source = readFileSync(METROS_TS, 'utf8')
  const applied = []
  for (const m of promotable) {
    const next = publishInSource(source, m.id)
    if (next && next !== source) { source = next; applied.push(m.id) }
    else console.log(`  ! could not rewrite the entry for ${m.id} — edit shared/metros.ts by hand`)
  }
  if (!applied.length) { console.log('no edits applied.'); process.exit(1) }
  writeFileSync(METROS_TS, source)

  // Re-import to prove the edit produced valid TypeScript with the intended
  // effect. A regex edit that quietly matched the wrong thing would otherwise
  // look like a success right up until CI.
  const verifyPath = `${METROS_TS}?t=${applied.join('-')}`
  const { getMetro: freshGet } = await import(verifyPath)
  const bad = applied.filter((id) => freshGet(id)?.published !== true)
  if (bad.length) {
    console.error(`\n✗ edit did not take effect for: ${bad.join(', ')} — revert shared/metros.ts`)
    process.exit(1)
  }

  console.log(`\n✅ published in shared/metros.ts: ${applied.join(', ')}`)
  console.log('\nNext:')
  console.log('  git diff shared/metros.ts     # review')
  console.log('  git commit -am "Publish <metros>" && git push')
  console.log('  # CI deploys the worker; the metro goes live on merge.')
}

await main()
