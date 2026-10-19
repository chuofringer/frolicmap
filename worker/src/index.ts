import { Hono } from 'hono'
import type { Env } from './env'
import { publicRouter } from './routes/public'

// Durable Object class backing the global rate limiter (see
// `src/do/RateLimiterDO.ts` and `src/utils/globalRateLimit.ts`). Must be
// exported from the Worker's main entry point: `wrangler.toml`'s
// `[[durable_objects.bindings]]` references it by this class name.
export { RateLimiterDO } from './do/RateLimiterDO'

// Fetch-only, read-only Worker: no background jobs, no write routes. Data is
// loaded offline by the scripts in `worker/scripts` (see README.md).
const app = new Hono<{ Bindings: Env }>()
app.get('/', (c) => c.redirect('https://frolicmap.app/', 301))
app.route('/', publicRouter)

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
