// worker/test/ingest-osm-national.test.mjs
// Offline coverage for the national OSM bootstrap's waterplay dry-run (#435).
// Uses node --test (not Vitest) because it spawns the .mjs script as a real
// subprocess — child_process + fs crash inside Miniflare's isolate, which is
// why vitest.config.ts restricts Vitest to *.test.ts. The Overpass network
// call is stubbed via the OSM_NATIONAL_FIXTURE env seam so no request leaves
// the machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const SCRIPT = resolve(REPO_ROOT, 'worker/scripts/ingest-osm-national.mjs')
const FIXTURE = resolve(HERE, 'fixtures/overpass-waterplay-seattle.json')

function runDryRun(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, OSM_NATIONAL_FIXTURE: FIXTURE },
  })
}

test('`--categories waterplay --metro seattle --dry-run` reports rows without touching the network or disk', () => {
  const res = runDryRun(['--categories', 'waterplay', '--metro', 'seattle', '--dry-run'])
  assert.equal(res.status, 0, res.stderr)
  const out = res.stdout

  // Selected exactly one metro × the waterplay category.
  assert.match(out, /1 metro\(s\) × 1 categor\(ies\)/)
  assert.match(out, /Seattle/)
  assert.match(out, /waterplay/)
  // Tier C shape is reported.
  assert.match(out, /confidence='medium' status='approved'/)

  // 4 fixture elements → 3 rows (the NYC element is outside the Seattle bbox
  // and dropped). Dry-run writes nothing.
  assert.match(out, /would write 3 rows/)
  assert.match(out, /total: 3 rows/)
  assert.match(out, /\[dry-run\] no files written, no database touched\./)
})

test('a category outside the vocabulary (the dropped event category) is rejected before any fetch', () => {
  const res = runDryRun(['--categories', 'event', '--metro', 'seattle', '--dry-run'])
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /unknown categor/)
})
