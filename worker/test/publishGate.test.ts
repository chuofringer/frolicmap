import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mintSessionToken } from '../src/utils/session'
import { d1Migrations } from './helpers/migrations'

// Must match vitest.config.ts's `miniflare.bindings.SESSION_SIGNING_KEY`.
const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

/**
 * Seed an approved row in a region, at coordinates inside that metro.
 *
 * The point of these fixtures is that everything is `approved` — the state
 * trusted structured sources land in at import time (plan §1.6). `published`
 * is what should decide visibility, and before #371 only the list endpoint
 * agreed.
 */
async function seed(id: string, region: string, lat: number, lng: number) {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (
      id, type, name, category, lat, lng, source_url, source_type,
      confidence, status, last_verified, created_at, updated_at, indoor, region
    ) VALUES (?, 'place', ?, 'park', ?, ?, 'https://example.com', 'osm',
      'medium', 'approved', ?, ?, ?, 0, ?)`,
  ).bind(id, `Row ${id}`, lat, lng, now, now, now, region).run()
}

// z10 tiles covering each city (computed from the standard slippy formula).
const SF_TILE = '10/163/395'
const SAN_ANTONIO_TILE = '10/231/424'

// Fixture metro: san-antonio (austin was the original fixture until it
// published as an events-first metro on 2026-07-25).
describe('publish gate (#371) — unpublished metro data is not publicly served', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it('serves tiles for a published metro', async () => {
    await seed('bay-1', 'bay', 37.7749, -122.4194)
    const res = await SELF.fetch(`https://example.com/api/tiles/${SF_TILE}.pbf`, {
      headers: { 'cf-connecting-ip': '10.7.0.1', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(20)
    // The row's name is embedded in the MVT payload.
    expect(new TextDecoder().decode(bytes)).toContain('bay-1')
  })

  it('does NOT serve tiles for an unpublished metro, even though its rows are approved', async () => {
    // The exact production regression (originally seen on Austin pre-publish):
    // 846 approved rows made the metro's tile return 23 KB of pins while
    // /api/items.json for the region correctly 404'd. Applying data was
    // publishing it, which collapsed the promote-metro gate (plan §4A.5).
    // The request MUST target the tile containing the seeded coords —
    // otherwise the bbox WHERE excludes the row and the test passes even
    // with the region clause deleted (the #505 fixture swap did exactly that).
    await seed('sanantonio-1', 'san-antonio', 29.4241, -98.4936)
    const res = await SELF.fetch(`https://example.com/api/tiles/${SAN_ANTONIO_TILE}.pbf`, {
      headers: { 'cf-connecting-ip': '10.7.0.2', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const body = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))
    expect(body).not.toContain('sanantonio-1')
  })

  it('keeps an unpublished row out of a tile it shares with a published one', async () => {
    // Guards the clause itself rather than the bbox: if the region filter were
    // dropped, this tile would carry both rows.
    await seed('bay-2', 'bay', 37.7749, -122.4194)
    await seed('ghost', 'sacramento', 37.7750, -122.4195)
    const res = await SELF.fetch(`https://example.com/api/tiles/${SF_TILE}.pbf`, {
      headers: { 'cf-connecting-ip': '10.7.0.3', ...(await authHeaders()) },
    })
    const body = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))
    expect(body).toContain('bay-2')
    expect(body).not.toContain('ghost')
  })

  it('does NOT serve item detail for an unpublished metro row', async () => {
    await seed('sanantonio-2', 'san-antonio', 29.4241, -98.4936)
    const res = await SELF.fetch('https://example.com/api/items/sanantonio-2', {
      headers: { 'cf-connecting-ip': '10.7.0.4', ...(await authHeaders()) },
    })
    // 404 rather than 403 so an unpublished metro's ids aren't enumerable.
    expect(res.status).toBe(404)
  })

  it('still serves item detail for a published metro row', async () => {
    await seed('bay-3', 'bay', 37.7749, -122.4194)
    const res = await SELF.fetch('https://example.com/api/items/bay-3', {
      headers: { 'cf-connecting-ip': '10.7.0.5', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    expect((await res.json<{ item: { id: string } }>()).item.id).toBe('bay-3')
  })

  it('agrees across all three public read paths for the same unpublished row', async () => {
    await seed('sanantonio-3', 'san-antonio', 29.4241, -98.4936)
    const h = { 'cf-connecting-ip': '10.7.0.6', ...(await authHeaders()) }

    const list = await SELF.fetch('https://example.com/api/items.json?region=san-antonio', { headers: h })
    expect(list.status).toBe(404)

    const detail = await SELF.fetch('https://example.com/api/items/sanantonio-3', { headers: h })
    expect(detail.status).toBe(404)

    const tile = await SELF.fetch(`https://example.com/api/tiles/${SAN_ANTONIO_TILE}.pbf`, { headers: h })
    const body = new TextDecoder().decode(new Uint8Array(await tile.arrayBuffer()))
    expect(body).not.toContain('sanantonio-3')
  })
})
