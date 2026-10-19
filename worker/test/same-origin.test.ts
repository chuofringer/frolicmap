import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { d1Migrations } from './helpers/migrations'

// The Worker is routed on both `api.frolicmap.app/*` and `frolicmap.app/api/*`
// and must behave identically on either host. `POST /api/session` is the
// cheapest route that needs no seeded data.
describe('host-agnostic routing (same-origin)', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB, d1Migrations) })

  const mint = (host: string, ip: string) =>
    SELF.fetch(`https://${host}/api/session`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip },
    })

  it('mints a session under api.frolicmap.app', async () => {
    const res = await mint('api.frolicmap.app', '10.50.0.1')
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string; ttl_seconds: number }
    expect(body.ttl_seconds).toBe(300)
    expect(body.token.split('.')).toHaveLength(2)
  })

  it('mints a session under frolicmap.app (apex)', async () => {
    const res = await mint('frolicmap.app', '10.50.0.2')
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string; ttl_seconds: number }
    expect(body.ttl_seconds).toBe(300)
  })

  it('returns the same response shape for both hosts', async () => {
    const subRes = await mint('api.frolicmap.app', '10.50.0.3')
    const apexRes = await mint('frolicmap.app', '10.50.0.4')
    expect(subRes.status).toBe(apexRes.status)
    expect(Object.keys(await subRes.json() as object).sort())
      .toEqual(Object.keys(await apexRes.json() as object).sort())
  })

  it('redirects the root path to the frontend', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/', { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://frolicmap.app/')
  })
})
