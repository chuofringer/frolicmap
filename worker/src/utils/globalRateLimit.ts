// Second-layer rate limiting on top of the per-isolate `ITEMS_*_RATE_LIMITER`
// bindings — data-protection Phase 2d3 (issue #198 item 1).
//
// Those bindings stay in place as the cheap first cut (they still stop a
// single dumb `curl` loop with zero extra latency for the common case).
// `globalLimit` is consulted AFTER them, in the same guard-ordering slot
// (origin → parse → session → rate limit), and is backed by a Durable
// Object (`../do/RateLimiterDO.ts`) so the count is consistent across every
// Cloudflare colo instead of resetting on IP rotation. See that file's
// header for the algorithm.
//
// No-op posture when `RATE_LIMITER_DO` is absent from `env` — same
// "no-crash cold deploy" discipline as `SESSION_SIGNING_KEY` being unset:
// this keeps existing tests, an undeployed preview environment, or a worker
// deployed before the DO migration has run all working unchanged. A missing
// binding degrades to "only the per-isolate limiter applies", never to a 500.
import type { Env } from '../env'

export interface GlobalLimitOptions {
  limit: number
  windowMs: number
}

export interface GlobalLimitResult {
  success: boolean
  remaining: number
  /** Epoch ms — feed into `retryAfterSeconds` for the `Retry-After` header. */
  resetAt: number
}

const NOOP_RESULT = (limit: number, windowMs: number): GlobalLimitResult => ({
  success: true,
  remaining: limit,
  resetAt: Date.now() + windowMs,
})

/**
 * Consult the global (DO-backed) rate limit for `(scope, subject)`.
 *
 * `scope` names the endpoint family (e.g. `'items-detail'`, `'tiles'`,
 * `'session'`) — every call site for the same scope MUST pass the same
 * `limit`/`windowMs`, since a given (scope, subject) pair maps to exactly
 * one DO instance and its budget. `subject` is normally the caller's
 * session-token nonce (see `subjectFor` below) so the budget travels with
 * the token rather than the IP.
 */
export async function globalLimit(
  env: Pick<Env, 'RATE_LIMITER_DO'>,
  scope: string,
  subject: string,
  opts: GlobalLimitOptions,
): Promise<GlobalLimitResult> {
  const ns = env.RATE_LIMITER_DO
  if (!ns) return NOOP_RESULT(opts.limit, opts.windowMs)

  try {
    const id = ns.idFromName(`${scope}:${subject}`)
    const stub = ns.get(id)
    const res = await stub.fetch('https://rate-limiter-do/limit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: opts.limit, windowMs: opts.windowMs }),
    })
    if (!res.ok) return NOOP_RESULT(opts.limit, opts.windowMs)
    return (await res.json()) as GlobalLimitResult
  } catch (err) {
    // A DO outage must never take down the data endpoints it's guarding —
    // fail OPEN to the no-op result. The per-isolate limiter checked just
    // before this call is still in effect, so this isn't "no rate limiting
    // at all", only "no cross-colo layer for the duration of the outage".
    console.error(`[globalRateLimit] RATE_LIMITER_DO call failed for scope=${scope}: ${err}`)
    return NOOP_RESULT(opts.limit, opts.windowMs)
  }
}

/**
 * Derive the rate-limit subject for a request: the verified session token's
 * `nonce` when one is present (ties the budget to the specific minted
 * token — resilient to IP rotation across that token's 5-minute life, and
 * naturally reset by the next mint), else the caller's IP (used only for
 * `POST /api/session`, which by definition runs before any token exists).
 */
export function subjectFor(ip: string, nonce: string | undefined): string {
  return nonce ? `nonce:${nonce}` : `ip:${ip}`
}

/** Seconds to send in `Retry-After` for a given `resetAt` (epoch ms). */
export function retryAfterSeconds(resetAt: number, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000))
}
