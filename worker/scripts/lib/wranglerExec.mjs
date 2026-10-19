// worker/scripts/lib/wranglerExec.mjs
//
// Shared helpers for scripts that shell out to `wrangler d1 execute`
// against remote D1 (issue #654). The weekly aggregators merge
// (aggregators-merge.yml) applies thousands of UPSERTs to prod D1 in the
// same window build-seo-pages.mjs's `--remote` reads run in; on 2026-W36
// wrangler dropped a request mid-write-burst and the third `d1()` call in
// the SEO generator failed outright with a truncated, mostly-banner error
// message. `withRetry()` gives a transient wrangler failure a few chances
// before giving up; `formatWranglerError()` makes sure that when it DOES
// give up, the thrown Error carries the actual wrangler/D1 error instead of
// the first 200 characters of a banner.
//
// Pure, synchronous, dependency-free — testable under `node --test` without
// Miniflare (see worker/test/wranglerExec.test.mjs).

/**
 * Run `fn` up to `attempts` times, sleeping with exponential backoff between
 * failures. Only retries when `fn` throws — a caller should throw from `fn`
 * ONLY on a real transient failure (e.g. a nonzero wrangler exit status) and
 * do any JSON.parse of a successful result OUTSIDE `fn`, so a parse bug
 * surfaces once instead of being retried pointlessly.
 *
 * @template T
 * @param {() => T} fn
 * @param {{ attempts?: number, baseMs?: number, sleep?: (ms: number) => void }} [opts]
 * @returns {T}
 */
export function withRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 4
  const baseMs = opts.baseMs ?? 2000
  const sleep = opts.sleep ?? defaultSleep
  let lastErr
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return fn()
    } catch (err) {
      lastErr = err
      if (attempt === attempts) break
      const delayMs = baseMs * 2 ** (attempt - 1) // 2s, 4s, 8s for the default baseMs=2000
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[wranglerExec] attempt ${attempt}/${attempts} failed: ${message} — retrying in ${delayMs}ms`)
      sleep(delayMs)
    }
  }
  throw lastErr
}

// Synchronous sleep for synchronous CLI scripts (spawnSync-based, nothing
// pending on the event loop to lose). Atomics.wait blocks the current thread
// without an extra child process, unlike an `execSync('sleep N')` shell-out.
function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// wrangler prints an ASCII banner ("⛅️ wrangler x.y.z" + a rule of dashes)
// and, separately, deprecation/config warnings ("▲ [WARNING] ..."), both
// ahead of the actual error. Neither is useful in a thrown Error, and a
// blind `.slice(0, 200)` on raw stderr used to capture only that noise and
// truncate the real D1/SQLite error before it ever appeared (#654).
const NOISE_PREFIXES = ['▲', '⛅', 'WARNING']
const TAIL_CHARS = 2000

/**
 * Build the message for a failed `wrangler d1 execute` invocation: drop
 * banner/warning/blank lines from stderr and keep the last ~2000 chars of
 * what remains, plus the process exit status.
 *
 * @param {string | null | undefined} stderr
 * @param {number | null} status
 * @returns {string}
 */
export function formatWranglerError(stderr, status) {
  const lines = (stderr ?? '').split('\n').filter((line) => {
    const trimmed = line.trim()
    if (trimmed === '') return false
    return !NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  })
  const cleaned = lines.join('\n').trim()
  const tail = cleaned.length > TAIL_CHARS ? cleaned.slice(-TAIL_CHARS) : cleaned
  const body = tail || '(no stderr output beyond wrangler banner/warnings)'
  return `wrangler d1 execute failed (exit ${status ?? 'null'}): ${body}`
}
