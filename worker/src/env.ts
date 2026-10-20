export interface Env {
  DB: D1Database
  /** List endpoint (`/api/items.json`) — tight (10/min/IP) because a single
   *  successful call yields the whole ListItem catalog. Bulk-export gate. */
  ITEMS_RATE_LIMITER: RateLimit
  /** Session mint (`POST /api/session`) only — 30/min/IP. Its own binding so
   *  a user who reloads often never trips the list endpoint's tighter budget. */
  SESSION_RATE_LIMITER: RateLimit
  /** Detail + coords endpoints (`/api/items/:id`, `/api/items/:id/coords`) —
   *  looser (60/min/IP) because each call returns one row; real UX pattern is
   *  "tap through a dozen pins." Separate budget so a power user's
   *  popup-tapping doesn't eat the list endpoint's budget. */
  ITEMS_DETAIL_RATE_LIMITER: RateLimit
  /** Tile endpoint (`/api/tiles/*`) — loosest (300/min/IP) because a single
   *  pan or zoom fires 4-10 tile requests at once. Its own binding so map
   *  panning never spends the detail budget. */
  ITEMS_TILES_RATE_LIMITER: RateLimit
  /** HMAC-SHA256 key used to sign session tokens minted by `POST /api/session`
   *  and verified on gated data endpoints. Also keys the enumeration guard's
   *  pseudonymous IP identifier (with a domain-separation label).
   *  MUST be set via `wrangler secret put SESSION_SIGNING_KEY` before the mint
   *  endpoint becomes usable; if absent, mint returns 503 and verify rejects
   *  every token as unsigned (no-crash fallback so a partial deploy doesn't
   *  lock users out). At least 32 bytes of entropy (use `openssl rand -hex 32`). */
  SESSION_SIGNING_KEY?: string
  /** Durable Object binding backing the global (cross-colo) rate limiter.
   *  Consulted by `utils/globalRateLimit.ts` AFTER the per-isolate
   *  `ITEMS_*_RATE_LIMITER` bindings above, keyed by `(scope, subject)` where
   *  subject is normally the session token's nonce — a single
   *  globally-consistent counter per key, immune to the IP-rotation reset the
   *  per-isolate bindings are vulnerable to. Optional/no-crash by design:
   *  absent (undeployed migration, a test env that hasn't declared it)
   *  degrades to "only the per-isolate limiter applies", never a 500 — see
   *  `globalRateLimit.ts`'s no-op posture. See `src/do/RateLimiterDO.ts`. */
  RATE_LIMITER_DO?: DurableObjectNamespace
}
