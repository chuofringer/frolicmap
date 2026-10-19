export interface Env {
  DB: D1Database
  AI: Ai
  /** List endpoint (`/api/items.json`) — tight (10/min/IP) because a single
   *  successful call yields the whole ListItem catalog. Bulk-export gate. */
  ITEMS_RATE_LIMITER: RateLimit
  /** Detail endpoint (`/api/items/:id`) — looser (60/min/IP) because each
   *  call returns one row; real UX pattern is "tap through a dozen pins."
   *  Separate budget so a power user's popup-tapping doesn't eat the list
   *  endpoint's budget. Added for data-protection Phase 1, 2026-04-20. */
  ITEMS_DETAIL_RATE_LIMITER: RateLimit
  /** Internal ingest router (`/api/internal/*`) — issue #422. These
   *  endpoints are gated by `EXTRACT_SECRET` rather than CORS/session, but a
   *  leaked secret (the curl example lives in shell history) shouldn't buy
   *  an attacker an unbounded loop: `/run/:source` alone can drive ~15
   *  outbound fetches and up to ~1000 D1 round-trips per call. Own budget,
   *  separate from the public data-endpoint limiters, so a public traffic
   *  spike can't starve a legitimate manual trigger and vice versa. */
  INTERNAL_RATE_LIMITER: RateLimit
  FRONTEND_URL: string
  CF_ACCESS_AUD?: string
  CF_ACCESS_TEAM?: string
  EXTRACT_SECRET?: string
  /** HMAC-SHA256 key used to sign session tokens minted by `POST /api/session`
   *  and verified on gated data endpoints (Phase 2 of data-protection-plan.md).
   *  MUST be set via `wrangler secret put SESSION_SIGNING_KEY` before the mint
   *  endpoint becomes usable; if absent, mint returns 503 and verify rejects
   *  every token as unsigned (no-crash fallback so a partial deploy doesn't
   *  lock users out). At least 32 bytes of entropy (use `openssl rand -hex 32`). */
  SESSION_SIGNING_KEY?: string
  /** Previous `SESSION_SIGNING_KEY` value, kept only for the duration of a
   *  rotation's grace window (issue #198 item 4). `verifySessionToken` /
   *  `verifyMemberCredential` check the current key first and fall back to
   *  this one only when the current key produces `bad-signature` — so a
   *  token or member credential minted just before a rotation keeps
   *  verifying instead of every live session/credential dying the instant
   *  the operator flips the secret. Unset (the default) means no grace
   *  window: rotating `SESSION_SIGNING_KEY` alone is still the instant
   *  global-logout kill switch it always was. See the rotation runbook in
   *  docs/launch-checklist.md and docs/data-protection-plan.md Phase 2d3. */
  SESSION_SIGNING_KEY_PREVIOUS?: string
  /** Durable Object binding backing the global (cross-colo) rate limiter —
   *  data-protection Phase 2d3 (issue #198 item 1). Consulted by
   *  `utils/globalRateLimit.ts` AFTER the per-isolate `ITEMS_*_RATE_LIMITER`
   *  bindings above, keyed by `(scope, subject)` where subject is normally
   *  the session token's nonce — a single globally-consistent counter per
   *  key, immune to the IP-rotation reset the per-isolate bindings are
   *  vulnerable to. Optional/no-crash by design: absent (undeployed
   *  migration, a test env that hasn't declared it, a cold preview deploy)
   *  degrades to "only the per-isolate limiter applies", never a 500 — see
   *  `globalRateLimit.ts`'s no-op posture. See `src/do/RateLimiterDO.ts`. */
  RATE_LIMITER_DO?: DurableObjectNamespace
  /** Explicit opt-in for the `x-dev-admin: yes` header bypass. Must be set to
   *  "yes" in `wrangler.toml` [vars] for local dev, never set in prod. */
  DEV_ADMIN_BYPASS?: string
  /** Resend API key for the waitlist welcome email (issue #165). When unset,
   *  `sendWaitlistWelcome` no-ops with a console.log — keeps tests + bare
   *  `wrangler dev` working without a secret. Set via `wrangler secret put
   *  RESEND_API_KEY` for staging/prod. */
  RESEND_API_KEY?: string
  /** From-address for waitlist emails. Defaults to `frolicmap.official@gmail.com` when
   *  unset. Set in `wrangler.toml` [vars] (or `.dev.vars`) since it's
   *  non-secret and varies per environment (Resend sandbox sender for dev,
   *  verified domain sender for prod). */
  RESEND_FROM_EMAIL?: string
  /** Opt-in flag for live Resend sends. Must equal "enabled" or
   *  `sendWaitlistWelcome` falls through to its mock-log path regardless
   *  of whether RESEND_API_KEY is set. Set ONLY via `wrangler secret put
   *  EMAIL_LIVE_SENDS` against the deployed prod worker (issue #423) —
   *  deliberately absent from `wrangler.toml` [vars], since a [vars]
   *  entry would be inherited by `wrangler dev` with no opt-out. Vitest
   *  test bindings force it to "" so test runs never hit Resend even if
   *  `.dev.vars` (which vitest-pool-workers reads) has both the API key
   *  and an enabled flag. Belt-and-suspenders with the
   *  RESERVED_EMAIL_DOMAINS guard in `email.ts`. Pattern: live sends
   *  require explicit opt-in, never on by default. */
  EMAIL_LIVE_SENDS?: string
  /** OAuth 2.0 client id for "Sign in with Google" (2026-07-26 real
   *  sign-in, next to email+password). Public value (ID-token
   *  flow, no client secret) — set in `wrangler.toml` [vars] once the
   *  operator creates the OAuth client (authorized JS origins:
   *  https://funradar.app + http://localhost:5173). Empty/unset → the
   *  `/api/auth/google` endpoint answers 503 and the SPA hides the button
   *  (VITE_GOOGLE_CLIENT_ID drives that side), so the feature ships dark. */
  GOOGLE_CLIENT_ID?: string
  /** Server-side enforcement flag for the events sign-in gate (2026-07-26).
   *  When "enabled", `GET /api/items/:id` returns 401 `signin-required` for
   *  event rows unless the session token carries the member tier — the
   *  server-side twin of the SPA's EVENTS_GATE_ENABLED kill switch (flip
   *  BOTH together). Any other value (or unset) leaves event details open
   *  to every valid session, which is the safe cold-deploy posture. Set in
   *  `wrangler.toml` [vars]. */
  EVENTS_REQUIRE_MEMBER?: string
  /** Operator email for cron-failure alerts (issue #197). When unset,
   *  `sendCronFailureAlert` no-ops with a console.log — same cold-deploy
   *  posture as RESEND_API_KEY. Set in `wrangler.toml` [vars] for prod;
   *  e.g., "ops@funradar.app". Delivery goes through Resend (needs
   *  RESEND_API_KEY + the EMAIL_LIVE_SENDS secret set to "enabled", same gates as the
   *  waitlist welcome email). Mailchannels was the original channel but
   *  its free CF-Workers tier was retired in 2024. */
  ALERT_EMAIL?: string
  /** Cloudflare account id for the Browser Rendering REST API (issue #308,
   *  browser-mode fetcher for Akamai/Cloudflare-protected sources). Not a
   *  secret — set in `wrangler.toml` [vars] once Browser Rendering is
   *  enabled on the account (paid-plan feature). Unset/empty keeps browser-
   *  mode fetches throwing a clear, catchable "not configured" error; no
   *  feed is currently flagged `browserMode: true` so this is inert until
   *  a source opts in. See worker/src/ingest/feeds/browserFetcher.ts. */
  CF_ACCOUNT_ID?: string
  /** API token scoped to "Browser Rendering - Edit", paired with
   *  CF_ACCOUNT_ID above. Secret — set via
   *  `wrangler secret put BROWSER_RENDERING_API_TOKEN`, never committed. */
  BROWSER_RENDERING_API_TOKEN?: string
  /** #248 Phase 2 preview-env hook. When set, `routes/public.ts`'s write-path
   *  origin check (`isProdOrigin`) additionally accepts this exact origin —
   *  alongside the always-on exact `ALLOWED_ORIGINS` allowlist — so the
   *  preview worker's own CF Pages preview origin can complete write-path
   *  smoke tests (waitlist signup, reports, ui-event, …) against
   *  `funradar-preview` D1. Unset in prod: `wrangler.toml`'s top-level
   *  `[vars]` never sets it, only `[env.preview]`'s does. See
   *  docs/preview-env.md. */
  PREVIEW_WRITE_ORIGIN?: string
  /** EventBrite affiliate id (#254) — the `aff` query value appended to
   *  outbound eventbrite.com URLs by `utils/affiliate.ts`. Issued by the
   *  EventBrite affiliate program (eventbrite.com/affiliates) after signup.
   *  Unset/blank → EventBrite rewriting is off and URLs pass through
   *  unchanged (the safe cold-deploy posture). Set in `wrangler.toml`
   *  [vars] — the id ends up visible in outbound URLs anyway, so it is
   *  not a secret. */
  EVENTBRITE_AFFILIATE_ID?: string
  /** GetYourGuide partner id (#254) — the `partner_id` query value appended
   *  to outbound getyourguide.com URLs. Issued by the GetYourGuide partner
   *  program after signup. Same posture as EVENTBRITE_AFFILIATE_ID:
   *  unset/blank → passthrough; set in `wrangler.toml` [vars]. */
  GETYOURGUIDE_PARTNER_ID?: string
}
