import { Hono } from 'hono'
import type { Env } from './env'
import { publicRouter } from './routes/public'
import { adminRouter } from './routes/admin'
import { internalRouter } from './routes/internal'
import { runOsmIngest } from './ingest/osm'
import { runArchiveExpired } from './archiveExpired'
import {
  makeProductionDeps,
  runStructuredFeedsIngest,
} from './ingest/structuredFeeds'
import { sendCronFailureAlert } from './utils/email'
import { runDailyOperatorDigest } from './operatorDigest'

// Durable Object class backing the global rate limiter (issue #198 item 1,
// 2d3 — see `src/do/RateLimiterDO.ts` and `src/utils/globalRateLimit.ts`).
// Must be exported from the Worker's main entry point — `wrangler.toml`'s
// `[[durable_objects.bindings]]` references it by this class name.
export { RateLimiterDO } from './do/RateLimiterDO'

// Issue #197 alert path. After a cron completes (regardless of result),
// inspect the last 2 ingestion_log rows for that source. If BOTH have
// errors, send a Mailchannels alert via sendCronFailureAlert. Skipping
// first-failure avoids noise from transient network blips.
async function alertOnRepeatedFailure(env: Env, sourceId: string): Promise<void> {
  try {
    const { results } = await env.DB
      .prepare(
        'SELECT errors FROM ingestion_log WHERE source_id = ? ORDER BY id DESC LIMIT 2'
      )
      .bind(sourceId)
      .all<{ errors: string | null }>()
    if (results.length < 2) return // Need at least 2 runs to compare.
    const parse = (raw: string | null): string[] => {
      if (!raw) return []
      try {
        const v = JSON.parse(raw)
        return Array.isArray(v) ? v : [String(v)]
      } catch {
        return [raw]
      }
    }
    const current = parse(results[0].errors)
    const previous = parse(results[1].errors)
    if (current.length === 0 || previous.length === 0) return // Skip first-failure.
    await sendCronFailureAlert(env, sourceId, current)
  } catch (err) {
    console.error(`[cron-alert] alertOnRepeatedFailure error for ${sourceId}: ${err instanceof Error ? err.message : err}`)
  }
}

const app = new Hono<{ Bindings: Env }>()
app.get('/', (c) => c.redirect('https://funradar.app/', 301))
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n', 200, { 'content-type': 'text/plain' }))
app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', publicRouter)
app.route('/', adminRouter)
app.route('/', internalRouter)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron
    // LLM extraction of messy HTML happens via the weekly aggregators
    // Claude Code Desktop routine (see docs/aggregators-claude-routine.md),
    // not via a Worker cron. Clean structured feeds (BiblioCommons v2 JSON
    // + 6 venue ICS) run weekly inside runStructuredFeedsIngest below. The
    // /api/internal/extract endpoint still exposes on-demand LLM extraction
    // from the admin UI.
    if (cron === '0 3 1 */3 *') {
      ctx.waitUntil(
        runOsmIngest(env.DB)
          .then(() => alertOnRepeatedFailure(env, 'osm'))
          .catch((err) => console.error(`[cron] osm failed: ${err}`))
      )
    }
    if (cron === '0 8 * * *') {
      ctx.waitUntil(
        runArchiveExpired(env.DB, env.FRONTEND_URL)
          .then(() => alertOnRepeatedFailure(env, 'archive-expired'))
          .catch((err) => console.error(`[cron] archive-expired failed: ${err}`))
      )
    }
    if (cron === '0 4 * * MON') {
      ctx.waitUntil(
        runStructuredFeedsIngest(env.DB, makeProductionDeps(undefined, env))
          .then(() => alertOnRepeatedFailure(env, 'structured-feeds'))
          .catch((err) => console.error(`[cron] structured-feeds failed: ${err}`))
      )
    }
    // Daily operator digest (#252): waitlist growth + top outbound clicks,
    // one email at 08:00 PT. runDailyOperatorDigest never throws (errors are
    // logged to ingestion_log internally), so no alertOnRepeatedFailure hookup
    // — a broken digest send would otherwise page the operator about the
    // very digest meant to save them a dashboard visit.
    if (cron === '0 15 * * *') {
      ctx.waitUntil(
        runDailyOperatorDigest(env).catch((err) => console.error(`[cron] operator-digest failed: ${err}`))
      )
    }
  },
} satisfies ExportedHandler<Env>

// deploy-worker smoke test
