import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { d1Migrations } from './helpers/migrations'
import { mintSessionToken } from '../src/utils/session'

// Must match the value in vitest.config.ts's `miniflare.bindings.SESSION_SIGNING_KEY`.
const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

describe('API security headers', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB, d1Migrations) })

  it('a tile response carries nosniff and a referrer policy, and keeps its own Cache-Control', async () => {
    const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.70.0.1', origin: 'https://frolicmap.app', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
    // CORS still applied by the route middleware, not clobbered.
    expect(res.headers.get('access-control-allow-origin')).toBe('https://frolicmap.app')
    // No CSP / HSTS on the API.
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('a list response carries nosniff and keeps its Cache-Control', async () => {
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.70.0.2', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
  })

  it('error responses (401) carry nosniff too', async () => {
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.70.0.3' },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('top-level error handler', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
    // Force an unhandled exception in the detail route: its first D1 read hits
    // this table. Restored in afterAll.
    await env.DB.exec('DROP TABLE id_fetch_watch;')
  })

  afterAll(async () => {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS id_fetch_watch (ip_hash TEXT PRIMARY KEY, last_id TEXT NOT NULL, streak INTEGER NOT NULL, direction TEXT, updated_at TEXT NOT NULL, blocked_until TEXT);',
    )
  })

  it('returns a static JSON 500 with no stack trace, message or path', async () => {
    const res = await SELF.fetch('https://example.com/api/items/anything', {
      headers: { 'cf-connecting-ip': '10.70.1.1', ...(await authHeaders()) },
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'internal error' })
    expect(text).not.toMatch(/id_fetch_watch|no such table|SQLITE|D1_ERROR|\bat \w|\/src\/|node_modules/)
  })
})
