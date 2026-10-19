import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/env'
import { cfAccess } from '../src/middleware/cfAccess'

describe('cfAccess middleware', () => {
  it('rejects without token when access is configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', cfAccess)
    app.get('/ok', (c) => c.json({ ok: true }))
    const res = await app.request('/ok', {}, { ...env, CF_ACCESS_TEAM: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' })
    expect(res.status).toBe(401)
  })

  it('allows dev bypass header when DEV_ADMIN_BYPASS is set', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', cfAccess)
    app.get('/ok', (c) => c.json({ ok: true }))
    const res = await app.request(
      '/ok',
      { headers: { 'x-dev-admin': 'yes' } },
      { ...env, CF_ACCESS_TEAM: undefined, CF_ACCESS_AUD: undefined, DEV_ADMIN_BYPASS: 'yes' }
    )
    expect(res.status).toBe(200)
  })

  it('rejects dev bypass header when DEV_ADMIN_BYPASS is NOT set (prod-safe default)', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', cfAccess)
    app.get('/ok', (c) => c.json({ ok: true }))
    const res = await app.request(
      '/ok',
      { headers: { 'x-dev-admin': 'yes' } },
      { ...env, CF_ACCESS_TEAM: undefined, CF_ACCESS_AUD: undefined, DEV_ADMIN_BYPASS: undefined }
    )
    expect(res.status).toBe(503)
  })

  it('rejects without dev header when access is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', cfAccess)
    app.get('/ok', (c) => c.json({ ok: true }))
    const res = await app.request('/ok', {}, { ...env, CF_ACCESS_TEAM: undefined, CF_ACCESS_AUD: undefined })
    expect(res.status).toBe(503)
  })
})
