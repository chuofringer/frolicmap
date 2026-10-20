import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { d1Migrations } from './helpers/migrations'
import { mintSessionToken } from '../src/utils/session'

const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

// Proves each endpoint family spends its own first-layer rate-limit binding:
// tiles -> ITEMS_TILES_RATE_LIMITER only, detail -> ITEMS_DETAIL_RATE_LIMITER only,
// session mint -> SESSION_RATE_LIMITER only.
describe('per-IP rate limiter wiring', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB, d1Migrations) })
  afterEach(() => { vi.restoreAllMocks() })

  it('a tile request consults the tiles limiter and not the detail or list limiters', async () => {
    const tiles = vi.spyOn(env.ITEMS_TILES_RATE_LIMITER, 'limit')
    const detail = vi.spyOn(env.ITEMS_DETAIL_RATE_LIMITER, 'limit')
    const list = vi.spyOn(env.ITEMS_RATE_LIMITER, 'limit')
    const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.80.0.1', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(tiles).toHaveBeenCalledWith({ key: '10.80.0.1' })
    expect(detail).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('a detail request consults the detail limiter and not the tiles limiter', async () => {
    const tiles = vi.spyOn(env.ITEMS_TILES_RATE_LIMITER, 'limit')
    const detail = vi.spyOn(env.ITEMS_DETAIL_RATE_LIMITER, 'limit')
    // 404 is fine: the limiter runs before the lookup.
    await SELF.fetch('https://example.com/api/items/nope', {
      headers: { 'cf-connecting-ip': '10.80.0.2', ...(await authHeaders()) },
    })
    expect(detail).toHaveBeenCalledWith({ key: '10.80.0.2' })
    expect(tiles).not.toHaveBeenCalled()
  })

  it('a session mint consults only the session limiter', async () => {
    const session = vi.spyOn(env.SESSION_RATE_LIMITER, 'limit')
    const list = vi.spyOn(env.ITEMS_RATE_LIMITER, 'limit')
    const detail = vi.spyOn(env.ITEMS_DETAIL_RATE_LIMITER, 'limit')
    const tiles = vi.spyOn(env.ITEMS_TILES_RATE_LIMITER, 'limit')
    const res = await SELF.fetch('https://example.com/api/session', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '10.80.0.5' },
    })
    expect(res.status).toBe(200)
    expect(session).toHaveBeenCalledWith({ key: '10.80.0.5' })
    expect(list).not.toHaveBeenCalled()
    expect(detail).not.toHaveBeenCalled()
    expect(tiles).not.toHaveBeenCalled()
  })

  it('a tripped tiles limiter returns 429 with Retry-After, and detail is unaffected', async () => {
    vi.spyOn(env.ITEMS_TILES_RATE_LIMITER, 'limit').mockResolvedValue({ success: false })
    const auth = await authHeaders()
    const tile = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.80.0.3', ...auth },
    })
    expect(tile.status).toBe(429)
    expect(tile.headers.get('retry-after')).toBe('60')
    expect(tile.headers.get('cache-control')).toBe('no-store')
    const detail = await SELF.fetch('https://example.com/api/items/nope', {
      headers: { 'cf-connecting-ip': '10.80.0.3', ...auth },
    })
    expect(detail.status).toBe(404)
  })

  it('a tripped detail limiter does not stop tiles', async () => {
    vi.spyOn(env.ITEMS_DETAIL_RATE_LIMITER, 'limit').mockResolvedValue({ success: false })
    const auth = await authHeaders()
    const detail = await SELF.fetch('https://example.com/api/items/nope', {
      headers: { 'cf-connecting-ip': '10.80.0.4', ...auth },
    })
    expect(detail.status).toBe(429)
    const tile = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.80.0.4', ...auth },
    })
    expect(tile.status).toBe(200)
  })
})
