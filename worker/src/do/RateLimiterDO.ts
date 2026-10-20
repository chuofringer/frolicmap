// Durable Object rate limiter (the globally-consistent second layer).
//
// The three `ITEMS_*_RATE_LIMITER` Workers Rate Limiting bindings
// (`worker/wrangler.toml`) are PER-COLO / per-isolate: Cloudflare runs the
// binding's counter independently in every edge location a request lands in,
// so an adversary rotating source IPs (or simply getting routed to a
// different colo) sees a fresh bucket essentially for free. That's fine as a
// first, free line of defense — it still stops a single dumb `curl` loop —
// but it is not a real budget. A Durable Object is the one Workers primitive
// with a single, globally-consistent instance per key: every request for the
// same key is coordinated through the SAME object no matter which colo it
// entered at, so the budget can't be reset by IP rotation alone.
//
// One DO instance per (scope, subject) pair — see `../utils/globalRateLimit.ts`
// for how callers derive `scope` (which endpoint family) and `subject` (the
// session token's nonce when one is verified, else the caller's IP) and turn
// them into the DO id via `idFromName`. Keying by the token's nonce rather
// than raw IP is what buys the "per-session budget" half of 2d3's brief —
// two requests presenting the SAME token share one budget regardless of
// which IP or colo they arrive from, and a fresh token (a fresh mint) starts
// a fresh budget, matching the token's own 5-minute lifetime.
//
// Deliberately a plain fetch-handler class (no `cloudflare:workers` RPC base
// class) — a JSON-body fetch RPC needs no compatibility-flag/import surface
// beyond what every Durable Object has supported since the primitive
// shipped, so it works regardless of exactly which `wrangler`/
// `@cloudflare/workers-types` minor is installed. `globalRateLimit.ts` is the
// only caller and always talks to it the same way, so the extra HTTP-shaped
// ceremony costs nothing in practice.
//
// Algorithm: sliding-window counter approximated from TWO fixed windows
// (current + previous), the same technique Cloudflare's own dashboard rate
// limiter and most public writeups of this problem use. A naive fixed
// window allows up to 2x the configured rate right at a window boundary
// (a burst at 0:59 plus a burst at 1:00 both fit their own window); blending
// the previous window's count in, weighted by how much of it is still
// "in view" of the current instant, removes that edge case with only one
// extra counter — no need for a true sorted log of every request timestamp.

interface StoredState {
  /** Which fixed window (`floor(now / windowMs)`) `count` belongs to. */
  windowId: number
  /** Requests admitted so far in `windowId`. */
  count: number
  /** Requests admitted in the window immediately before `windowId`. */
  prevCount: number
}

export interface RateLimitResult {
  success: boolean
  /** Best-effort remaining budget in the current window, floored at 0. */
  remaining: number
  /** Epoch ms when the current fixed window rolls over (a fresh weight,
   *  not a hard reset — the sliding estimate decays continuously before then). */
  resetAt: number
}

const DEFAULT_LIMIT = 60
const DEFAULT_WINDOW_MS = 60_000

// How long an idle key's storage survives before the object cleans itself
// up. Generous relative to any windowMs we actually use (session mint's
// 60s up to tiles' 60s) so a key that's still being hit keeps pushing the
// alarm out — see `scheduleCleanup` below — while one that goes quiet for a
// few window-lengths reclaims its own storage without any external sweep.
const CLEANUP_WINDOW_MULTIPLE = 3

export class RateLimiterDO {
  private readonly storage: DurableObjectStorage

  // Signature must be `(ctx, env)` — the shape every Durable Object
  // constructor receives — even though this object needs nothing from `env`.
  constructor(ctx: DurableObjectState, env: unknown) {
    void env // deliberately unused — see comment above
    this.storage = ctx.storage
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/limit') {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }

    let body: { limit?: unknown; windowMs?: unknown }
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'invalid json' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : DEFAULT_LIMIT
    const windowMs = typeof body.windowMs === 'number' && body.windowMs > 0 ? body.windowMs : DEFAULT_WINDOW_MS

    const result = await this.consume(limit, windowMs)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  private async consume(limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now()
    const windowId = Math.floor(now / windowMs)
    const stored = await this.storage.get<StoredState>('state')

    // Roll the two-bucket window forward. A key untouched for >1 window
    // (stored.windowId < windowId - 1) has no relevant previous count left —
    // both buckets start cold, same as a brand-new key.
    let count = 0
    let prevCount = 0
    if (stored) {
      if (stored.windowId === windowId) {
        count = stored.count
        prevCount = stored.prevCount
      } else if (stored.windowId === windowId - 1) {
        prevCount = stored.count
      }
    }

    const resetAt = (windowId + 1) * windowMs
    const elapsedFraction = (now - windowId * windowMs) / windowMs
    // Sliding estimate: the previous window's hits still count, decayed by
    // how far we've moved into the current one.
    const estimated = prevCount * (1 - elapsedFraction) + count

    if (estimated + 1 > limit) {
      return { success: false, remaining: Math.max(0, Math.round(limit - estimated)), resetAt }
    }

    await this.storage.put<StoredState>('state', { windowId, count: count + 1, prevCount })
    await this.scheduleCleanup(now, windowMs)
    return { success: true, remaining: Math.max(0, Math.round(limit - estimated - 1)), resetAt }
  }

  /** Push the self-cleanup alarm out on every admitted request — a key still
   *  seeing traffic never lets the alarm fire; one that goes quiet for
   *  `CLEANUP_WINDOW_MULTIPLE` windows lets it fire and clears its own
   *  storage, so idle (scope, subject) pairs don't accumulate state forever
   *  without needing any external sweep job. */
  private async scheduleCleanup(now: number, windowMs: number): Promise<void> {
    await this.storage.setAlarm(now + windowMs * CLEANUP_WINDOW_MULTIPLE)
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll()
  }
}
