// worker/test/wranglerExec.test.mjs
// Coverage for the wrangler-exec retry + error-formatting helpers
// (scripts/lib/wranglerExec.mjs) used by build-seo-pages.mjs's d1() (#654).
// Pure computation, no Miniflare, no D1 — same style as dedupCluster.test.mjs:
//   node --test worker/test/wranglerExec.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatWranglerError, withRetry } from '../scripts/lib/wranglerExec.mjs'

// ── withRetry ────────────────────────────────────────────────────────────

test('withRetry returns the first successful result without retrying', () => {
  let calls = 0
  const sleeps = []
  const result = withRetry(() => { calls++; return 'ok' }, { attempts: 4, baseMs: 100, sleep: (ms) => sleeps.push(ms) })
  assert.equal(result, 'ok')
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test('withRetry retries on throw with exponential backoff and returns on eventual success', () => {
  let calls = 0
  const sleeps = []
  const result = withRetry(
    () => {
      calls++
      if (calls < 3) throw new Error(`transient ${calls}`)
      return 'recovered'
    },
    { attempts: 4, baseMs: 2000, sleep: (ms) => sleeps.push(ms) },
  )
  assert.equal(result, 'recovered')
  assert.equal(calls, 3)
  // Two failures before the third (successful) call: backoff 2s then 4s.
  assert.deepEqual(sleeps, [2000, 4000])
})

test('withRetry exhausts all attempts and throws the last error, never retrying past the cap', () => {
  let calls = 0
  const sleeps = []
  assert.throws(
    () => withRetry(() => { calls++; throw new Error(`fail ${calls}`) }, { attempts: 3, baseMs: 10, sleep: (ms) => sleeps.push(ms) }),
    /fail 3/,
  )
  assert.equal(calls, 3)
  // Backoff sleeps happen between attempts only (2 sleeps for 3 attempts),
  // never after the final failed attempt.
  assert.deepEqual(sleeps, [10, 20])
})

test('withRetry never retries a failure raised outside fn (e.g. a JSON.parse bug)', () => {
  // Mirrors the real d1() shape: fn only throws on a nonzero wrangler exit;
  // parsing the successful result happens outside withRetry, so a parse
  // error surfaces exactly once instead of being retried pointlessly.
  let fnCalls = 0
  const raw = withRetry(() => { fnCalls++; return '{not valid json' }, { attempts: 4, baseMs: 1, sleep: () => {} })
  assert.throws(() => JSON.parse(raw))
  assert.equal(fnCalls, 1)
})

test('withRetry defaults to 4 attempts and a 2000ms base when opts are omitted', () => {
  let calls = 0
  const sleeps = []
  assert.throws(() => withRetry(() => { calls++; throw new Error('boom') }, { sleep: (ms) => sleeps.push(ms) }))
  assert.equal(calls, 4)
  assert.deepEqual(sleeps, [2000, 4000, 8000])
})

// ── formatWranglerError ─────────────────────────────────────────────────

test('formatWranglerError strips the wrangler banner and WARNING lines, keeping the real error', () => {
  const stderr = [
    '⛅️ wrangler 3.80.0',
    '───────────────────',
    '',
    '▲ [WARNING] Some deprecation notice about wrangler.toml',
    '',
    'Error: D1_ERROR: UNIQUE constraint failed: items.id',
  ].join('\n')
  const msg = formatWranglerError(stderr, 1)
  assert.ok(!msg.includes('wrangler 3.80.0'))
  assert.ok(!msg.includes('WARNING'))
  assert.ok(msg.includes('UNIQUE constraint failed: items.id'))
  assert.ok(msg.includes('exit 1'))
})

test('formatWranglerError keeps only the last ~2000 chars of meaningful output', () => {
  const filler = 'a'.repeat(2500)
  const stderr = `START-MARKER-SHOULD-BE-DROPPED\n${filler}\nEND-MARKER-SHOULD-SURVIVE`
  const msg = formatWranglerError(stderr, 1)
  assert.ok(!msg.includes('START-MARKER-SHOULD-BE-DROPPED'))
  assert.ok(msg.includes('END-MARKER-SHOULD-SURVIVE'))
})

test('formatWranglerError handles empty or all-noise stderr without throwing', () => {
  assert.doesNotThrow(() => formatWranglerError('', 1))
  assert.doesNotThrow(() => formatWranglerError(null, 1))
  assert.doesNotThrow(() => formatWranglerError(undefined, 1))
  const noiseOnly = formatWranglerError('⛅️ wrangler 3.80.0\n▲ [WARNING] noise\n', 1)
  assert.ok(noiseOnly.includes('no stderr output'))
})

test('formatWranglerError reports a null exit status without crashing', () => {
  const msg = formatWranglerError('Error: some failure', null)
  assert.ok(msg.includes('exit null'))
})
