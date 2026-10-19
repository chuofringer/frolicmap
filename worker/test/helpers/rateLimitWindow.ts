// Deterministic guard for rate-limit-tripping tests (#638).
//
// Miniflare's `ratelimit` binding simulator keeps in-memory buckets keyed to
// an EPOCH-ALIGNED window — `Math.floor(Date.now() / (period * 1000))` — and
// clears every bucket the moment the epoch increments
// (miniflare/dist/src/workers/ratelimit/ratelimit.worker.js). A test that
// drives N sequential requests to trip a 10/min budget therefore flakes
// whenever the suite happens to start seconds before a minute boundary: the
// hits split across two windows and no single window ever exceeds the limit,
// so the expected 429 never arrives ("expected null not to be null" on CI,
// run 32611178997).
//
// The fix is to hop past an imminent boundary before driving the loop, which
// guarantees the whole burst lands inside one window (the loops themselves
// finish in a few seconds even under CI load, far inside the buffer).
//
// NOTE for callers: the hop can sleep up to `bufferMs`, which exceeds
// vitest's 5s default test timeout — every guarded test must pass an
// explicit timeout (e.g. `it('…', async () => { … }, 30_000)`); the first
// CI run of PR #646 timed out exactly this way.
export async function ensureFreshRateLimitWindow(
  periodMs = 60_000,
  bufferMs = 10_000,
): Promise<void> {
  const msLeftInWindow = periodMs - (Date.now() % periodMs)
  if (msLeftInWindow < bufferMs) {
    await new Promise((resolve) => setTimeout(resolve, msLeftInWindow + 100))
  }
}
