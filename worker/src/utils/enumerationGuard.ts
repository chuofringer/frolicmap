// Sequential-ID enumeration heuristic — issue #198 triage item 2.
//
// A tile walk at z=11-12 (`/api/tiles/*`) already yields every public item
// id; nothing before this distinguished a real user tapping pins in random
// order from a scraper walking that harvested id list in a fixed order
// (e.g. alphabetical, or whatever order a bulk crawl produced). Real click
// behavior has no relationship to an id's sort position, so N consecutive
// `GET /api/items/:id` fetches whose id sorts strictly above — or strictly
// below — the previous one is a strong systematic-walk signal. This module
// is the pure decision logic; `worker/src/db/enumerationWatch.ts` persists
// the per-IP state in D1 (migration 0025), and `routes/public.ts` wires it
// into the detail endpoint.
//
// Deliberately NOT a fix for the deeper gap the same issue flags first (2d3:
// per-colo rate-limit buckets let IP rotation reset budgets trivially) —
// that needs a globally-consistent counter (Durable Object or equivalent)
// and new infrastructure, out of scope for this change. This heuristic
// still raises the cost of the *cheapest* enumeration path (single IP, no
// rotation) without any new bindings/secrets/provisioning: it reuses the
// existing D1 binding the same way every other table in this app does.

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

/** SHA-256 hex digest of the caller's IP — see migration 0025 for why we
 *  never persist the raw address. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
