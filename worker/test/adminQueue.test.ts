import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { Item } from '@shared/types'
import { d1Migrations } from './helpers/migrations'

const adminHeaders = { 'x-dev-admin': 'yes' }

async function seed(id: string, region: string, sourceType: string, status = 'pending', name = id) {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (
      id, type, name, category, lat, lng, source_url, source_type,
      confidence, status, last_verified, created_at, updated_at, indoor, region
    ) VALUES (?, 'place', ?, 'park', 37.7, -122.4, 'https://example.com', ?,
      'medium', ?, ?, ?, ?, 0, ?)`,
  ).bind(id, name, sourceType, status, now, now, now, region).run()
}

type ListRes = {
  items: Item[]
  total: number
  limit: number
  offset: number
  facets: { regions: { value: string; n: number }[]; sourceTypes: { value: string; n: number }[] }
}

describe('admin queue filters + pagination (#368)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it('filters by region so a national import cannot bury a single metro review', async () => {
    // The scenario this exists for: IMLS museums land pending nationally and
    // another metro's queue disappears underneath them.
    await seed('bay-1', 'bay', 'nps')
    await seed('bay-2', 'bay', 'nps')
    for (let i = 0; i < 20; i++) await seed(`aus-${i}`, 'austin', 'imls')

    const res = await SELF.fetch('https://example.com/api/admin/items?status=pending&region=bay', { headers: adminHeaders })
    expect(res.status).toBe(200)
    const body = await res.json<ListRes>()
    expect(body.total).toBe(2)
    expect(body.items.map((i) => i.id).sort()).toEqual(['bay-1', 'bay-2'])
  })

  it('filters by source_type', async () => {
    await seed('a', 'bay', 'nps')
    await seed('b', 'bay', 'imls')
    const res = await SELF.fetch('https://example.com/api/admin/items?status=pending&source_type=imls', { headers: adminHeaders })
    const body = await res.json<ListRes>()
    expect(body.items.map((i) => i.id)).toEqual(['b'])
  })

  it('combines region and source filters', async () => {
    await seed('a', 'bay', 'imls')
    await seed('b', 'austin', 'imls')
    await seed('c', 'austin', 'osm')
    const res = await SELF.fetch(
      'https://example.com/api/admin/items?status=pending&region=austin&source_type=imls',
      { headers: adminHeaders },
    )
    const body = await res.json<ListRes>()
    expect(body.items.map((i) => i.id)).toEqual(['b'])
    expect(body.total).toBe(1)
  })

  it('paginates and reports the unpaginated total', async () => {
    for (let i = 0; i < 12; i++) await seed(`r-${String(i).padStart(2, '0')}`, 'bay', 'osm')

    const p1 = await (await SELF.fetch('https://example.com/api/admin/items?status=pending&limit=5', { headers: adminHeaders })).json<ListRes>()
    expect(p1.items).toHaveLength(5)
    // `total` is the count behind the filter, not the page size — it's what
    // tells a curator how much is actually queued.
    expect(p1.total).toBe(12)

    const p3 = await (await SELF.fetch('https://example.com/api/admin/items?status=pending&limit=5&offset=10', { headers: adminHeaders })).json<ListRes>()
    expect(p3.items).toHaveLength(2)
    expect(p3.total).toBe(12)
    // No overlap between pages.
    expect(p1.items.map((i) => i.id)).not.toContain(p3.items[0].id)
  })

  it('clamps a hostile or silly limit instead of dumping the table', async () => {
    for (let i = 0; i < 3; i++) await seed(`x-${i}`, 'bay', 'osm')
    const huge = await (await SELF.fetch('https://example.com/api/admin/items?status=pending&limit=999999', { headers: adminHeaders })).json<ListRes>()
    expect(huge.limit).toBe(500)
    const zero = await (await SELF.fetch('https://example.com/api/admin/items?status=pending&limit=0', { headers: adminHeaders })).json<ListRes>()
    expect(zero.limit).toBe(1)
    const junk = await (await SELF.fetch('https://example.com/api/admin/items?status=pending&limit=abc&offset=-5', { headers: adminHeaders })).json<ListRes>()
    expect(junk.limit).toBe(100)
    expect(junk.offset).toBe(0)
  })

  it('returns facets computed from the data, not a hardcoded list', async () => {
    // A hand-maintained dropdown list would be wrong the day a new importer
    // lands. Facets can only ever offer filters that return rows.
    await seed('a', 'bay', 'nps')
    await seed('b', 'bay', 'nps')
    await seed('c', 'austin', 'imls')
    const body = await (await SELF.fetch('https://example.com/api/admin/items?status=pending', { headers: adminHeaders })).json<ListRes>()
    expect(body.facets.regions).toEqual([{ value: 'bay', n: 2 }, { value: 'austin', n: 1 }])
    expect(body.facets.sourceTypes).toEqual([{ value: 'nps', n: 2 }, { value: 'imls', n: 1 }])
  })

  it('400s on an unknown region rather than showing an empty queue', async () => {
    // An empty list would read as "nothing to review" — the wrong thing to
    // tell a curator when they've actually typo'd a filter.
    const res = await SELF.fetch('https://example.com/api/admin/items?status=pending&region=atlantis', { headers: adminHeaders })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed source_type', async () => {
    const res = await SELF.fetch("https://example.com/api/admin/items?status=pending&source_type=DROP%20TABLE", { headers: adminHeaders })
    expect(res.status).toBe(400)
  })

  it('defaults to unfiltered pending, preserving pre-#368 behaviour', async () => {
    await seed('a', 'bay', 'osm')
    await seed('b', 'austin', 'imls')
    await seed('c', 'bay', 'osm', 'approved')
    const body = await (await SELF.fetch('https://example.com/api/admin/items', { headers: adminHeaders })).json<ListRes>()
    expect(body.total).toBe(2)
    expect(body.limit).toBe(100)
    expect(body.offset).toBe(0)
  })

  it('still filters by status', async () => {
    await seed('p', 'bay', 'osm', 'pending')
    await seed('a', 'bay', 'osm', 'approved')
    const body = await (await SELF.fetch('https://example.com/api/admin/items?status=approved', { headers: adminHeaders })).json<ListRes>()
    expect(body.items.map((i) => i.id)).toEqual(['a'])
  })
})

describe('bulk approve is gone', () => {
  // The carve-out keeps per-id approve/reject only. A bulk endpoint would let
  // one click publish a whole import, so it must not exist at all.
  it('POST /api/admin/items/approve-all is 404', async () => {
    const res = await SELF.fetch('https://example.com/api/admin/items/approve-all', {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})
