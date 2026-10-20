import { env } from 'cloudflare:test'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { publicRouter } from '../src/routes/public'

// `request.cf` can't be set through SELF.fetch, so drive the router directly
// with a Request that carries a fake `cf` object.
function whereRequest(cf: Record<string, unknown> | undefined, headers: Record<string, string> = {}) {
  const req = new Request('https://frolicmap.app/api/where', {
    headers: { 'cf-connecting-ip': '10.90.0.1', ...headers },
  })
  if (cf) Object.defineProperty(req, 'cf', { value: cf })
  return publicRouter.fetch(req, env)
}

afterEach(() => vi.restoreAllMocks())

describe('GET /api/where', () => {
  it('returns the edge-derived approximate location (numeric lat/lng, no token needed)', async () => {
    const res = await whereRequest({ latitude: '47.60620', longitude: '-122.33210', city: 'Seattle', region: 'Washington' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ lat: 47.6062, lng: -122.3321, city: 'Seattle', region: 'Washington' })
  })

  it('returns all nulls when request.cf is absent', async () => {
    const res = await whereRequest(undefined)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ lat: null, lng: null, city: null, region: null })
  })

  it('nulls a half or out-of-range coordinate rather than returning it', async () => {
    expect(await (await whereRequest({ latitude: '47.6', city: 'X' })).json())
      .toEqual({ lat: null, lng: null, city: 'X', region: null })
    expect(await (await whereRequest({ latitude: '999', longitude: '1' })).json())
      .toEqual({ lat: null, lng: null, city: null, region: null })
  })

  it('rejects a foreign origin and echoes an allowed one in CORS', async () => {
    const bad = await whereRequest(undefined, { origin: 'https://evil.example' })
    expect(bad.status).toBe(403)
    const ok = await whereRequest(undefined, { origin: 'https://frolicmap.app' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://frolicmap.app')
  })

  it('consults only the session limiter, per IP, and 429s when it trips', async () => {
    const session = vi.spyOn(env.SESSION_RATE_LIMITER, 'limit')
    const list = vi.spyOn(env.ITEMS_RATE_LIMITER, 'limit')
    await whereRequest(undefined, { 'cf-connecting-ip': '10.90.0.7' })
    expect(session).toHaveBeenCalledWith({ key: '10.90.0.7' })
    expect(list).not.toHaveBeenCalled()

    session.mockResolvedValue({ success: false })
    const res = await whereRequest({ latitude: '1', longitude: '1' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
