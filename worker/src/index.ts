import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
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

// Hardening headers on every response. The API returns JSON and protobuf only,
// so there is no CSP. The cross-origin policies and HSTS are switched off on
// purpose: the SPA calls this Worker cross-origin via CORS (the CORS headers
// are set per route in `routes/public.ts` and are untouched here), and HSTS is
// managed at the zone level (the apex route would otherwise inherit an
// includeSubDomains policy from an API response). Cache-Control is never set
// by this middleware.
app.use('*', secureHeaders({
  xContentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  originAgentCluster: false,
}))

// Static 500 body. The error itself goes to the Worker log only; neither the
// message, the stack nor any internal path ever reaches the client.
app.onError((err, c) => {
  console.error('[worker] unhandled error:', err)
  c.header('Cache-Control', 'no-store')
  return c.json({ error: 'internal error' }, 500)
})

app.get('/', (c) => c.redirect('https://frolicmap.app/', 301))
app.route('/', publicRouter)

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
