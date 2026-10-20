// Sequential-ID enumeration heuristic.
//
// A tile walk at z=11-12 (`/api/tiles/*`) already yields every public item
// id; nothing before this distinguished a real user tapping pins in random
// order from a scraper walking that harvested id list in a fixed order
// (e.g. alphabetical, or whatever order a bulk crawl produced). Real click
// behavior has no relationship to an id's sort position, so N consecutive
// `GET /api/items/:id` fetches whose id sorts strictly above — or strictly
// below — the previous one is a strong systematic-walk signal. This module
// is the pure decision logic; `worker/src/db/enumerationWatch.ts` persists
// the per-IP state in D1 (`id_fetch_watch` in 0001_init.sql), and `routes/public.ts` wires it
// into the detail endpoint.
//
// Deliberately NOT a defence against IP rotation (per-colo rate-limit buckets
// reset trivially); the Durable Object layer in `globalRateLimit.ts` covers
// that. This heuristic raises the cost of the *cheapest* enumeration path
// (single IP, no rotation) using only the existing D1 binding.

export type EnumerationDirection = 'asc' | 'desc' | null

export interface EnumerationState {
  lastId: string | null
  streak: number
  direction: EnumerationDirection
}

export interface EnumerationVerdict {
  next: EnumerationState
  /** Set only on the request that pushes the streak over the threshold —
   *  i.e. the caller should block THIS request too, not just future ones. */
  blockedUntil: Date | null
}

export const EMPTY_ENUMERATION_STATE: EnumerationState = { lastId: null, streak: 0, direction: null }

// 15 consecutive monotonic fetches. The detail endpoint's own rate limiter
// already caps a single IP at 60 requests/minute, so this can only trip a
// few times per minute at most even under sustained abuse — real user
// sessions (tap a pin, read the popup, tap another) have no reason to
// produce a long run of strictly-ascending or strictly-descending ids by
// chance, since ids are opaque slugs uncorrelated with map position.
export const STREAK_THRESHOLD = 15

// Cooldown once tripped. Long enough to meaningfully slow a walk, short
// enough that a false positive (extremely unlikely organic run) self-heals
// within one coffee break rather than needing an operator to intervene.
export const BLOCK_MINUTES = 30

/**
 * Given the previous per-IP state and the id just fetched, returns the next
 * state to persist and — only on the request that crosses the threshold —
 * a `blockedUntil` the caller should also reject with.
 */
export function nextEnumerationState(prev: EnumerationState, id: string, now: Date): EnumerationVerdict {
  if (prev.lastId === null) {
    // First fetch this IP has made (or the first since its row aged out) —
    // nothing to compare against yet.
    return { next: { lastId: id, streak: 1, direction: null }, blockedUntil: null }
  }
  if (id === prev.lastId) {
    // Refetch of the same id (SPA remount, retry, double-click) is not
    // evidence of a directional walk either way — leave the streak alone.
    return { next: prev, blockedUntil: null }
  }
  const direction: 'asc' | 'desc' = id > prev.lastId ? 'asc' : 'desc'
  const streak = direction === prev.direction ? prev.streak + 1 : 1
  const blockedUntil = streak >= STREAK_THRESHOLD ? new Date(now.getTime() + BLOCK_MINUTES * 60_000) : null
  return { next: { lastId: id, streak, direction }, blockedUntil }
}

/**
 * Keyed pseudonymous identifier for a caller's IP: HMAC-SHA256 (hex, 64 chars)
 * with key material `"enum-guard:" + signingKey`. The label separates this use
 * of `SESSION_SIGNING_KEY` from its use for session tokens, so one HMAC output
 * can never stand in for the other. Because the key is secret, the identifier
 * cannot be reversed by hashing the small IPv4 space, which an unsalted
 * SHA-256 could be. We never persist the raw address. The row is deleted after
 * 24h of inactivity (see `db/enumerationWatch.ts`).
 */
export async function hashIp(ip: string, signingKey: string): Promise<string> {
  if (!signingKey) throw new Error('SESSION_SIGNING_KEY not configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`enum-guard:${signingKey}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
