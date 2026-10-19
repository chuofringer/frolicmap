import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { d1Migrations } from './helpers/migrations'

describe('host-agnostic routing (same-origin)', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB, d1Migrations) })

  it('serves /api/health under api.funradar.app', async () => {
    const res = await SELF.fetch('https://api.funradar.app/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('serves /api/health under funradar.app (apex)', async () => {
    const res = await SELF.fetch('https://funradar.app/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('returns identical bodies for both hosts', async () => {
    const subRes = await SELF.fetch('https://api.funradar.app/api/health')
    const apexRes = await SELF.fetch('https://funradar.app/api/health')
    expect(await subRes.text()).toBe(await apexRes.text())
  })
})
