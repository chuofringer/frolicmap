import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { d1Migrations } from './helpers/migrations'
import { ensureFreshRateLimitWindow } from './helpers/rateLimitWindow'
import { mintSessionToken } from '../src/utils/session'

// Must match the value in vitest.config.ts's `miniflare.bindings.SESSION_SIGNING_KEY`.
const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

async function seedItem(id: string, status = 'approved') {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (
      id, type, name, description, category, lat, lng, address, age_min, age_max,
      cost, indoor, source_url, source_type, confidence, status, last_verified,
      created_at, updated_at
    )
     VALUES (?, 'place', 'Test Playground', 'Secret curated description', 'playground',
             37.77, -122.42, '123 Market St, SF', 2, 10,
             'free', 0, 'https://example.com', 'manual', 'high', ?, ?, ?, ?)`
  ).bind(id, status, now, now, now).run()
}

describe('public endpoints', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
    await env.DB.exec('DELETE FROM id_fetch_watch;')
  })

  it('/api/items.json returns only approved items in the redacted list shape', async () => {
    await seedItem('a', 'approved')
    await seedItem('b', 'pending')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.1', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    // Phase 2d1 cache-control: browser-only (`private`), no edge caching.
    expect(res.headers.get('cache-control')).toContain('private')
    expect(res.headers.get('cache-control')).not.toContain('s-maxage')
    const body = await res.json() as {
      items: Record<string, unknown>[]
      attribution: { source: string; license: string }[]
    }
    expect(body.items.map(i => i.id)).toEqual(['a'])
    // Redacted fields must NOT appear in the list payload.
    const redacted = ['description', 'address', 'price_usd', 'opening_hours', 'photo_url', 'photo_attribution',
                      'website', 'source_url', 'source_type', 'confidence', 'last_verified', 'created_at', 'updated_at']
    for (const field of redacted) {
      expect(body.items[0]).not.toHaveProperty(field)
    }
    // Fields needed for client-side filtering + pin rendering MUST appear.
    expect(body.items[0]).toMatchObject({
      id: 'a', type: 'place', name: 'Test Playground', category: 'playground',
      lat: 37.77, lng: -122.42, age_min: 2, age_max: 10, cost: 'free', indoor: 0,
    })
    // Attribution is present (legal/ODbL compliance) but minified.
    expect(Array.isArray(body.attribution)).toBe(true)
    expect(body.attribution.find(a => a.source === 'OpenStreetMap contributors')?.license).toBe('ODbL-1.0')
  })

  it('/api/items.json carries a city — from the column, or parsed from the address', async () => {
    const now = new Date().toISOString()
    const seed = (id: string, city: string | null, address: string | null, lat = 37.77, lng = -122.42) => env.DB.prepare(
      `INSERT INTO items (id, type, name, category, lat, lng, address, city, source_url,
                          source_type, confidence, status, last_verified, created_at, updated_at)
       VALUES (?, 'place', 'Storytime', 'library', ?, ?, ?, ?, 'https://example.com',
               'manual', 'high', 'approved', ?, ?, ?)`,
    ).bind(id, lat, lng, address, city, now, now, now).run()

    await seed('col', 'Alameda', '1 Nowhere Rd')            // column wins
    await seed('addr', null, '150 Grand Ave, Oakland, CA')  // OSM rows without addr:city carry city=null
    // Nothing to derive from — parked far from the others so the neighbour
    // inference (tested separately) can't reach it and mask the parse result.
    await seed('none', null, null, 40.0, -119.0)

    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.11', ...(await authHeaders()) },
    })
    const body = await res.json() as { items: { id: string; city: string | null }[] }
    const city = (id: string) => body.items.find((i) => i.id === id)?.city
    expect(city('col')).toBe('Alameda')
    expect(city('addr')).toBe('Oakland')
    expect(city('none')).toBeNull()
    // The derivation is display-only — the row's own column is untouched.
    const row = await env.DB.prepare('SELECT city FROM items WHERE id = ?').bind('addr').first<{ city: string | null }>()
    expect(row?.city).toBeNull()
  })

  it('/api/items.json returns 401 without an Authorization token (Phase 2d1)', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.60' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string; reason: string }
    expect(body.error).toBe('unauthorized')
  })

  it('/api/items.json returns 401 with a malformed Bearer token', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.61', authorization: 'Bearer not.a.real.token' },
    })
    expect(res.status).toBe(401)
  })

  it('/api/items/:id returns the full Item shape for an approved row', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a', {
      headers: { 'cf-connecting-ip': '10.0.0.5', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    // Cache must be `private` (browser only). Regression guard against the
    // 2c edge-cache bypass (see /api/tiles test for the same guard).
    expect(res.headers.get('cache-control')).toContain('private')
    expect(res.headers.get('cache-control')).not.toContain('s-maxage')
    const { item } = await res.json() as { item: Record<string, unknown> }
    // All the redacted-from-list fields should be present here.
    expect(item).toMatchObject({
      id: 'a',
      description: 'Secret curated description',
      address: '123 Market St, SF',
      source_url: 'https://example.com',
      source_type: 'manual',
      confidence: 'high',
    })
  })

  it('/api/items/:id returns 401 without an Authorization token (Phase 2c)', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a', {
      headers: { 'cf-connecting-ip': '10.0.0.50' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string; reason: string }
    expect(body.error).toBe('unauthorized')
    expect(body.reason).toBe('malformed')
  })

  it('/api/items/:id returns 401 on an invalid Bearer token (Phase 2c)', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a', {
      headers: { 'cf-connecting-ip': '10.0.0.51', authorization: 'Bearer garbage.token' },
    })
    expect(res.status).toBe(401)
  })

  it('/api/items/:id returns 404 for non-approved or missing rows (authenticated)', async () => {
    await seedItem('b', 'pending')
    const auth = await authHeaders()
    const pending = await SELF.fetch('https://example.com/api/items/b', {
      headers: { 'cf-connecting-ip': '10.0.0.6', ...auth },
    })
    expect(pending.status).toBe(404)
    const missing = await SELF.fetch('https://example.com/api/items/does-not-exist', {
      headers: { 'cf-connecting-ip': '10.0.0.6', ...auth },
    })
    expect(missing.status).toBe(404)
  })

  // #250 Phase 2d2 step (d): coords endpoint exists so `useUrlItem`'s
  // `?item=<id>` fly-to no longer needs the full items.json catalog.
  it('/api/items/:id/coords returns only {lat, lng} for an approved row', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a/coords', {
      headers: { 'cf-connecting-ip': '10.0.0.60', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('private')
    const body = await res.json()
    expect(body).toEqual({ lat: 37.77, lng: -122.42 })
  })

  it('/api/items/:id/coords returns 401 without an Authorization token', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a/coords', {
      headers: { 'cf-connecting-ip': '10.0.0.61' },
    })
    expect(res.status).toBe(401)
  })

  it('/api/items/:id/coords returns 403 on a foreign Origin', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items/a/coords', {
      headers: { 'cf-connecting-ip': '10.0.0.62', origin: 'https://evil.example.com', ...(await authHeaders()) },
    })
    expect(res.status).toBe(403)
  })

  it('/api/items/:id/coords returns 404 for non-approved or missing rows (anti-enumeration)', async () => {
    await seedItem('b', 'pending')
    const auth = await authHeaders()
    const pending = await SELF.fetch('https://example.com/api/items/b/coords', {
      headers: { 'cf-connecting-ip': '10.0.0.63', ...auth },
    })
    expect(pending.status).toBe(404)
    const missing = await SELF.fetch('https://example.com/api/items/does-not-exist/coords', {
      headers: { 'cf-connecting-ip': '10.0.0.63', ...auth },
    })
    expect(missing.status).toBe(404)
  })

  it('/api/items/:id/coords shares the detail rate-limit budget', async () => {
    await seedItem('a', 'approved')
    const ip = '10.0.0.64'
    // Exhaust the detail budget (60/min) via the coords endpoint itself —
    // same binding (ITEMS_DETAIL_RATE_LIMITER) as /api/items/:id.
    await ensureFreshRateLimitWindow(60_000, 15_000) // 65-request burst needs the wider buffer
    let limitedRes: Response | null = null
    for (let i = 0; i < 65; i++) {
      const res = await SELF.fetch('https://example.com/api/items/a/coords', {
        headers: { 'cf-connecting-ip': ip, ...(await authHeaders()) },
      })
      if (res.status === 429) { limitedRes = res; break }
    }
    expect(limitedRes).not.toBeNull()
    expect(limitedRes!.headers.get('retry-after')).toBe('60')
    // Explicit timeout: the window hop above can sleep up to ~15s (vitest's
    // 5s default timed the weather twin of this test out on CI — PR #646).
  }, 45_000)

  it('rejects a request with a foreign Origin header (pre-auth check)', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      // Foreign origin fires before session check — 403 regardless of auth.
      headers: { 'cf-connecting-ip': '10.0.0.9', 'origin': 'https://evil.example.com', ...(await authHeaders()) },
    })
    expect(res.status).toBe(403)
  })

  it('rejects a request with a foreign Referer header (pre-auth check)', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.10', 'referer': 'https://evil.example.com/page', ...(await authHeaders()) },
    })
    expect(res.status).toBe(403)
  })

  it('allows a request with missing Origin and Referer when authenticated', async () => {
    // Pre-Phase-2d1 this test asserted 200 even without auth (bookmarks
    // could curl the list endpoint). After 2d1 the session-gate requires
    // a token regardless of headers. The orient of this test is now
    // "originGuard passes through with missing headers" — we send a
    // valid token to prove the guard itself doesn't 403 them.
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.11', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
  })

  it('allows a request with the allowed Origin', async () => {
    await seedItem('a', 'approved')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: {
        'cf-connecting-ip': '10.0.0.12',
        'origin': 'https://frolicmap.app',
        ...(await authHeaders()),
      },
    })
    expect(res.status).toBe(200)
  })

  it('rate limits /api/items.json per IP with Retry-After at the list budget', async () => {
    await seedItem('a', 'approved')
    const ip = '10.0.0.2'
    const auth = await authHeaders()
    await ensureFreshRateLimitWindow()
    let limitedRes: Response | null = null
    // 15 gives us ~5 hits past the 10/min list cap; bail early on the first 429.
    for (let i = 0; i < 15; i++) {
      const res = await SELF.fetch('https://example.com/api/items.json', {
        headers: { 'cf-connecting-ip': ip, ...auth },
      })
      if (res.status === 429) { limitedRes = res; break }
    }
    expect(limitedRes).not.toBeNull()
    expect(limitedRes!.headers.get('retry-after')).toBe('60')
    expect(limitedRes!.headers.get('cache-control')).toBe('no-store')
    // Explicit timeout: the window hop can sleep up to ~10s (PR #646).
  }, 30_000)

  it('/api/items/:id uses a separate rate-limit budget from the list endpoint', async () => {
    await seedItem('a', 'approved')
    const ip = '10.0.0.20'
    const auth = await authHeaders()
    // Exhaust the list budget (10/min).
    for (let i = 0; i < 12; i++) {
      await SELF.fetch('https://example.com/api/items.json', {
        headers: { 'cf-connecting-ip': ip, ...auth },
      })
    }
    // Detail should still be serviceable — different binding, different counter.
    const res = await SELF.fetch('https://example.com/api/items/a', {
      headers: { 'cf-connecting-ip': ip, ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
  })

  // Issue #198 triage item 2: monotonic-order id walk (the pattern a
  // scraper replaying a harvested/sorted id list produces) gets blackholed
  // even though the volume rate limiter above (60/min) hasn't tripped yet.
  describe('/api/items/:id sequential-ID enumeration guard', () => {
    it('blocks an IP after a run of strictly-ascending id fetches, well under the 60/min volume budget', async () => {
      const ids = Array.from({ length: 17 }, (_, i) => `item-${String(i).padStart(4, '0')}`)
      for (const id of ids) await seedItem(id, 'approved')
      const ip = '10.0.0.60'
      const auth = await authHeaders()

      let blocked: Response | null = null
      for (const id of ids) {
        const res = await SELF.fetch(`https://example.com/api/items/${id}`, {
          headers: { 'cf-connecting-ip': ip, ...auth },
        })
        if (res.status === 429) { blocked = res; break }
      }
      expect(blocked).not.toBeNull()
      expect(blocked!.headers.get('cache-control')).toBe('no-store')
      expect(Number(blocked!.headers.get('retry-after'))).toBeGreaterThan(0)
    })

    it('does not block an IP whose fetches have no sustained direction (organic click order)', async () => {
      const ids = Array.from({ length: 17 }, (_, i) => `item-${String(i).padStart(4, '0')}`)
      for (const id of ids) await seedItem(id, 'approved')
      // Alternate high/low so no run of same-direction steps ever forms.
      const order = ids.filter((_, i) => i % 2 === 0).concat(ids.filter((_, i) => i % 2 === 1).reverse())
      const ip = '10.0.0.61'
      const auth = await authHeaders()

      for (const id of order) {
        const res = await SELF.fetch(`https://example.com/api/items/${id}`, {
          headers: { 'cf-connecting-ip': ip, ...auth },
        })
        expect(res.status).toBe(200)
      }
    })

    it('a different IP walking the same ids in the same order is unaffected by another IP being blocked', async () => {
      const ids = Array.from({ length: 17 }, (_, i) => `item-${String(i).padStart(4, '0')}`)
      for (const id of ids) await seedItem(id, 'approved')
      const auth = await authHeaders()

      // Trip the guard for the first IP.
      for (const id of ids) {
        await SELF.fetch(`https://example.com/api/items/${id}`, { headers: { 'cf-connecting-ip': '10.0.0.62', ...auth } })
      }
      // A fresh IP walking the same ids should still get through its first fetch.
      const res = await SELF.fetch(`https://example.com/api/items/${ids[0]}`, {
        headers: { 'cf-connecting-ip': '10.0.0.63', ...auth },
      })
      expect(res.status).toBe(200)
    })
  })

  // Issue #198 item 1 (2d3): the Durable-Object-backed second rate-limit
  // layer, keyed by the SESSION TOKEN's nonce rather than the caller's IP.
  // Unit coverage of the DO/helper itself lives in globalRateLimit.test.ts;
  // this test proves the wiring through the real route closes the exact gap
  // named in the issue — a per-isolate, per-IP limiter alone is defeated by
  // trivial IP rotation.
  describe('global (Durable Object) rate limiter — issue #198 item 1', () => {
    it('blocks a single session token spread across many different source IPs, even though each IP alone stays far under the per-isolate budget', async () => {
      await seedItem('a', 'approved')
      // ONE minted token reused for every request — same nonce throughout,
      // so every request is the same "subject" to the DO layer regardless
      // of which IP it claims to come from.
      const auth = await authHeaders()
      await ensureFreshRateLimitWindow()

      let limited: Response | null = null
      for (let i = 0; i < 65; i++) {
        // A fresh source IP on every single request. Against the
        // per-isolate ITEMS_DETAIL_RATE_LIMITER (keyed by IP alone) this
        // never accumulates past 1 request per bucket — exactly the IP-
        // rotation bypass issue #198 item 1 describes. The DO layer still
        // sees 65 requests from the same token and must catch it.
        const res = await SELF.fetch('https://example.com/api/items/a', {
          headers: { 'cf-connecting-ip': `10.9.0.${i}`, ...auth },
        })
        if (res.status === 429) { limited = res; break }
      }
      expect(limited).not.toBeNull()
      expect(limited!.headers.get('cache-control')).toBe('no-store')
      expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0)
    }, 30_000)

    it('a DIFFERENT session token (fresh nonce) gets its own budget even from the same rotating-IP pattern', async () => {
      await seedItem('a', 'approved')
      await ensureFreshRateLimitWindow()

      // Exhaust one token's global budget.
      const spentAuth = await authHeaders()
      let limited: Response | null = null
      for (let i = 0; i < 65; i++) {
        const res = await SELF.fetch('https://example.com/api/items/a', {
          headers: { 'cf-connecting-ip': `10.9.1.${i}`, ...spentAuth },
        })
        if (res.status === 429) { limited = res; break }
      }
      expect(limited).not.toBeNull()

      // A brand-new mint (fresh nonce) is a different DO subject — still
      // serviceable even reusing one of the very IPs that just got throttled.
      const freshRes = await SELF.fetch('https://example.com/api/items/a', {
        headers: { 'cf-connecting-ip': '10.9.1.0', ...(await authHeaders()) },
      })
      expect(freshRes.status).toBe(200)
    }, 30_000)

    it('/api/tiles/* gets a looser (120/min) global budget than /api/items/:id (60/min) for the same token', async () => {
      await seedItem('sf-a', 'approved')
      const auth = await authHeaders()
      await ensureFreshRateLimitWindow()

      // 61 tile requests from 61 different IPs, same token: comfortably
      // under the tiles budget (120/min), so none should 429.
      for (let i = 0; i < 61; i++) {
        const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
          headers: { 'cf-connecting-ip': `10.9.2.${i}`, ...auth },
        })
        expect(res.status).toBe(200)
      }
    }, 30_000)

    it('POST /api/session applies the global layer per IP (no token exists yet to key off of)', async () => {
      await ensureFreshRateLimitWindow()
      const ip = '10.9.3.1'
      let limited: Response | null = null
      for (let i = 0; i < 15; i++) {
        const res = await SELF.fetch('https://example.com/api/session', {
          method: 'POST',
          headers: { 'cf-connecting-ip': ip },
        })
        if (res.status === 429) { limited = res; break }
      }
      expect(limited).not.toBeNull()
      expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0)
    }, 30_000)

    // The three routes below were the gap this PR's own DO wiring left
    // behind: /api/items/:id, /api/items/:id/coords, /api/tiles/* and
    // POST /api/session got the second layer, but the bulk-catalog list
    // endpoint and the two telemetry writes did not, despite sharing the
    // exact same IP-rotation exposure. Each gets its own scope so it can't
    // spend another endpoint's global budget (or have its own spent by one).
    it('GET /api/items.json (bulk-catalog list) gets its own global budget, tripped by one token across rotating IPs', async () => {
      await seedItem('a', 'approved')
      const auth = await authHeaders()
      await ensureFreshRateLimitWindow()

      let limited: Response | null = null
      for (let i = 0; i < 12; i++) {
        const res = await SELF.fetch('https://example.com/api/items.json', {
          headers: { 'cf-connecting-ip': `10.9.4.${i}`, ...auth },
        })
        if (res.status === 429) { limited = res; break }
      }
      expect(limited).not.toBeNull()
      expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0)
    }, 30_000)

  })

  it('/api/tiles/:z/:x/:y.pbf returns MVT bytes with correct content-type', async () => {
    // Seed a point at SF. Whatever z/x/y we pick, the test just needs the
    // endpoint to run + return a protobuf body; tile math is covered in
    // tile.test.ts.
    await seedItem('sf-a', 'approved')
    const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.0.0.40', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.mapbox-vector-tile')
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
    // Must be `private` (browser only) so CF edge doesn't share-cache.
    // Otherwise a cached 200 would serve unauthenticated requests,
    // bypassing `sessionGuard`. Regression guard for the 2c hotfix.
    expect(res.headers.get('cache-control')).toContain('private')
    expect(res.headers.get('cache-control')).not.toContain('s-maxage')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  // #250 Phase 2d2 step (a): the widened filter fields must actually reach
  // the wire, not just the intermediate TilePoint mapping — tileFeatureProperties
  // (unit-tested in tile.test.ts) covers the field-selection logic, this
  // covers the route wiring the SQL row into it. MVT strings are raw
  // length-prefixed UTF-8 with no compression, so the seeded field values
  // appear verbatim as substrings of the decoded byte buffer — enough to
  // catch "we forgot to select/pass a column" without a full MVT decoder.
  it('/api/tiles/*.pbf carries the widened filter fields (age, cost, indoor) on the wire', async () => {
    await seedItem('sf-a', 'approved') // cost='free', age_min=2, age_max=10, indoor=0
    const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.0.0.44', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString('latin1')
    expect(text).toContain('age_min')
    expect(text).toContain('cost')
    expect(text).toContain('free')
    expect(text).toContain('indoor')
  })

  it('/api/tiles returns 401 without an Authorization token (Phase 2c)', async () => {
    const res = await SELF.fetch('https://example.com/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.0.0.52' },
    })
    expect(res.status).toBe(401)
  })

  it('/api/tiles rejects malformed paths with 400 BEFORE checking auth', async () => {
    // Malformed path → 400 regardless of auth (client-side error; no info leak).
    const bad1 = await SELF.fetch('https://example.com/api/tiles/10/163/395', {
      headers: { 'cf-connecting-ip': '10.0.0.41' },
    })
    expect(bad1.status).toBe(400)
    const bad2 = await SELF.fetch('https://example.com/api/tiles/abc/def/ghi.pbf', {
      headers: { 'cf-connecting-ip': '10.0.0.42' },
    })
    expect(bad2.status).toBe(400)
  })

  it('/api/tiles rejects out-of-range coords with 400 BEFORE checking auth', async () => {
    // At z=10, max x/y is 1023. 9999 is well out of range.
    const res = await SELF.fetch('https://example.com/api/tiles/10/9999/9999.pbf', {
      headers: { 'cf-connecting-ip': '10.0.0.43' },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/session mints a signed token when SESSION_SIGNING_KEY is set', async () => {
    // The vitest-pool-workers miniflare binding in vitest.config.ts sets
    // SESSION_SIGNING_KEY so this integration test exercises the minting path.
    const res = await SELF.fetch('https://example.com/api/session', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '10.0.0.30' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json() as { token: string; ttl_seconds: number }
    expect(body.ttl_seconds).toBe(300)
    expect(body.token.split('.')).toHaveLength(2)
  })

  it('is read-only: report, item writes, health and robots routes are all gone', async () => {
    for (const [method, path] of [
      ['POST', '/api/report'],
      ['PUT', '/api/items/abc'],
      ['DELETE', '/api/items/abc'],
      ['GET', '/api/health'],
      ['GET', '/robots.txt'],
    ] as const) {
      const res = await SELF.fetch(`https://example.com${path}`, {
        method,
        headers: { 'cf-connecting-ip': '10.0.0.96', ...(await authHeaders()) },
      })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
  })

})

// #248 Phase 1 — Cloudflare Pages PR-preview builds
// (`https://<hash>.frolicmap.pages.dev`) may use the READ-ONLY data surface
// against prod so frontend PRs get a live-data visual review.
describe('#248 Phase 1 — CF Pages preview origins (read-only)', () => {
  const PREVIEW = 'https://abc123.frolicmap.pages.dev'

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
    await seedItem('sf-a', 'approved')
  })

  it('mints a session token for a preview Origin (CORS echoes it + Vary: Origin)', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/api/session', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '10.20.0.1', origin: PREVIEW },
    })
    expect(res.status).toBe(200)
    // CORS reflects the preview origin back...
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW)
    // ...and Vary: Origin must be present so the per-origin ACAO header can't
    // get cross-cached at the edge under any shared cache.
    expect(res.headers.get('vary')?.toLowerCase()).toContain('origin')
  })

  it('allows /api/items.json from a preview Origin', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/api/items.json', {
      headers: { 'cf-connecting-ip': '10.20.0.2', origin: PREVIEW, ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW)
    expect(res.headers.get('vary')?.toLowerCase()).toContain('origin')
    const body = await res.json() as { items: { id: string }[] }
    expect(body.items.map(i => i.id)).toEqual(['sf-a'])
  })

  it('allows /api/items/:id from a preview Origin', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/api/items/sf-a', {
      headers: { 'cf-connecting-ip': '10.20.0.3', origin: PREVIEW, ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW)
  })

  it('allows a tile request from a preview Origin', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/api/tiles/10/163/395.pbf', {
      headers: { 'cf-connecting-ip': '10.20.0.4', origin: PREVIEW, ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.mapbox-vector-tile')
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW)
  })

  it('allows a preview Origin passed via Referer on a read endpoint', async () => {
    const res = await SELF.fetch('https://api.frolicmap.app/api/items.json', {
      headers: {
        'cf-connecting-ip': '10.20.0.5',
        referer: `${PREVIEW}/map/bay-area?item=sf-a`,
        ...(await authHeaders()),
      },
    })
    expect(res.status).toBe(200)
  })

  // Spoof-resistance: the anchored `^https://[a-z0-9-]+\.frolicmap\.pages\.dev$`
  // pattern must reject every near-miss shape.
  const spoofs: [string, string][] = [
    ['no dot boundary', 'https://evil-frolicmap.pages.dev'],
    ['suffix trickery', 'https://frolicmap.pages.dev.evil.com'],
    ['nested subdomain', 'https://a.b.frolicmap.pages.dev'],
    ['http scheme', 'http://abc.frolicmap.pages.dev'],
  ]
  for (const [label, origin] of spoofs) {
    it(`rejects spoof origin (${label}): ${origin}`, async () => {
      const res = await SELF.fetch('https://api.frolicmap.app/api/items.json', {
        headers: { 'cf-connecting-ip': '10.20.1.1', origin, ...(await authHeaders()) },
      })
      expect(res.status).toBe(403)
    })
  }
})

describe('removed surfaces stay removed', () => {
  // The carve-out dropped every sign-in, newsletter, telemetry, submission and
  // weather route. They must 404 (not 401/403) so nothing half-answers.
  const gone: [string, string][] = [
    ['POST', '/api/auth/google'],
    ['POST', '/api/auth/delete-account'],
    ['POST', '/api/outbound-click'],
    ['POST', '/api/ui-event'],
    ['POST', '/api/submissions'],
    ['GET', '/api/submissions/mine'],
    ['POST', '/api/signup'],
    ['POST', '/api/unsubscribe'],
    ['GET', '/api/weather'],
    ['POST', '/api/internal/extract'],
  ]
  for (const [method, path] of gone) {
    it(`${method} ${path} is 404`, async () => {
      const res = await SELF.fetch(`https://example.com${path}`, {
        method,
        headers: { 'cf-connecting-ip': '10.30.0.1', 'content-type': 'application/json', ...(await authHeaders()) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      })
      expect(res.status).toBe(404)
    })
  }

  it('POST /api/session ignores a credential body and mints a plain session', async () => {
    const res = await SELF.fetch('https://example.com/api/session', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '10.30.0.2', 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'whatever' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).not.toHaveProperty('member')
    expect(Object.keys(body).sort()).toEqual(['token', 'ttl_seconds'])
  })

  it('/api/items.json attribution names exactly the four place sources', async () => {
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.30.0.3', ...(await authHeaders()) },
    })
    const body = await res.json() as { attribution: { source: string }[] }
    expect(body.attribution.map((a) => a.source)).toEqual([
      'OpenStreetMap contributors',
      'Institute of Museum and Library Services',
      'National Park Service',
      'Trust for Public Land ParkServe',
    ])
  })
})
