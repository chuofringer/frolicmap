import { Hono } from 'hono'
import type { Env } from './env'
import { publicRouter } from './routes/public'
import { adminRouter } from './routes/admin'
import { runOsmIngest } from './ingest/osm'
import { sendCronFailureAlert } from './utils/email'

// Durable Object class backing the global rate limiter (see
// `src/do/RateLimiterDO.ts` and `src/utils/globalRateLimit.ts`). Must be
// exported from the Worker's main entry point: `wrangler.toml`'s
// `[[durable_objects.bindings]]` references it by this class name.
export { RateLimiterDO } from './do/RateLimiterDO'

// Alert path. After a cron completes (regardless of result), inspect the last
// 2 ingestion_log rows for that source. If BOTH have errors, send an alert
// via sendCronFailureAlert (a log-only no-op until RESEND_API_KEY and
// ALERT_EMAIL are set). Skipping first-failure avoids noise from transient
// network blips.
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
app.get('/', (c) => c.redirect('https://frolicmap.app/', 301))
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n', 200, { 'content-type': 'text/plain' }))
app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', publicRouter)
app.route('/', adminRouter)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The only cron: the quarterly OpenStreetMap ingest (1st of Jan/Apr/Jul/Oct
    // 03:00 UTC). Static places rarely move.
    if (event.cron === '0 3 1 */3 *') {
      ctx.waitUntil(
        runOsmIngest(env.DB)
          .then(() => alertOnRepeatedFailure(env, 'osm'))
          .catch((err) => console.error(`[cron] osm failed: ${err}`))
      )
    }
  },
} satisfies ExportedHandler<Env>
