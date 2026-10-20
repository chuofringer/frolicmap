import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { ALL_CATEGORIES } from '@shared/types'
import { listByStatusAndRegion, upsert, getById } from '../src/db/items'
import { mintSessionToken } from '../src/utils/session'
import { d1Migrations } from './helpers/migrations'

// Must match vitest.config.ts's `miniflare.bindings.SESSION_SIGNING_KEY`.
const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

/** Insert with a minimal column list: `region` must come from the column default. */
async function seedLegacyItem(id: string, status = 'approved') {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (
      id, type, name, category, lat, lng, source_url, source_type,
      confidence, status, last_verified, created_at, updated_at, indoor
    ) VALUES (?, 'place', 'Legacy Row', 'playground', 37.77, -122.42,
      'https://example.com', 'manual', 'high', ?, ?, ?, ?, 0)`,
  ).bind(id, status, now, now, now).run()
}

async function seedRegionalItem(id: string, region: string, lat = 40.78, lng = -73.96) {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (
      id, type, name, category, lat, lng, source_url, source_type,
      confidence, status, last_verified, created_at, updated_at, indoor, region
    ) VALUES (?, 'place', ?, 'playground', ?, ?, 'https://example.com', 'osm',
      'medium', 'approved', ?, ?, ?, 0, ?)`,
  ).bind(id, `Row in ${region}`, lat, lng, now, now, now, region).run()
}

describe('0001_init schema (national columns)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it("defaults a row written without a region to 'bay' with the other columns null", async () => {
    // Writers that do not name a region land in the depth metro's region
    // without any importer touching them.
    await seedLegacyItem('legacy-1')
    const row = await env.DB
      .prepare('SELECT region, city, attributes, slug FROM items WHERE id = ?')
      .bind('legacy-1')
      .first<{ region: string; city: string | null; attributes: string | null; slug: string | null }>()
    expect(row).toEqual({ region: 'bay', city: null, attributes: null, slug: null })
  })

  it('accepts exactly the static-place source_types', async () => {
    const now = new Date().toISOString()
    // 'parkserve' is retired but stays valid so archived rows keep satisfying the CHECK.
    for (const st of ['osm', 'imls', 'parkserve', 'nps', 'manual']) {
      await env.DB.prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url, source_type,
          confidence, status, last_verified, created_at, updated_at, indoor
        ) VALUES (?, 'place', ?, 'library', 40.7, -74.0, 'https://example.com', ?,
          'medium', 'approved', ?, ?, ?, 1)`,
      ).bind(`src-${st}`, `Row ${st}`, st, now, now, now).run()
    }
    const { results } = await env.DB
      .prepare("SELECT source_type FROM items WHERE id LIKE 'src-%' ORDER BY source_type")
      .all<{ source_type: string }>()
    expect(results.map((r) => r.source_type)).toEqual(['imls', 'manual', 'nps', 'osm', 'parkserve'])
  })

  it('rejects the event, aggregator and category values that were carved out', async () => {
    const now = new Date().toISOString()
    const insert = (id: string, category: string, sourceType: string, type = 'place') =>
      env.DB.prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url, source_type,
          confidence, status, last_verified, created_at, updated_at, indoor
        ) VALUES (?, ?, 'X', ?, 37.7, -122.4, 'https://example.com', ?,
          'high', 'pending', ?, ?, ?, 0)`,
      ).bind(id, type, category, sourceType, now, now, now).run()
    await expect(insert('x-src', 'park', 'aggregator-bakf')).rejects.toThrow()
    await expect(insert('x-ics', 'park', 'ics')).rejects.toThrow()
    await expect(insert('x-evt', 'event', 'manual')).rejects.toThrow()
    await expect(insert('x-upick', 'upick', 'manual')).rejects.toThrow()
    await expect(insert('x-type', 'park', 'manual', 'event')).rejects.toThrow()
  })

  it('has no event/crop columns and none of the dropped tables', async () => {
    const { results: cols } = await env.DB.prepare('PRAGMA table_info(items)').all<{ name: string }>()
    const names = cols.map((c) => c.name)
    for (const dropped of ['start_time', 'end_time', 'rrule', 'exdates', 'crops', 'crops_state', 'in_season_now']) {
      expect(names).not.toContain(dropped)
    }
    for (const kept of ['name_zh', 'photo_attribution', 'has_playground', 'region', 'city', 'attributes', 'slug']) {
      expect(names).toContain(kept)
    }
    const { results: tables } = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name")
      .all<{ name: string }>()
    expect(tables.map((t) => t.name)).toEqual(['id_fetch_watch', 'items'])
  })

  it('still accepts a row for EVERY category (CHECK survived the rebuild)', async () => {
    const now = new Date().toISOString()
    const values = ALL_CATEGORIES.map(
      (cat) =>
        `('cat-${cat}','place','Test ${cat}','${cat}',37.7,-122.4,` +
        `'https://example.com/${cat}','manual','high','pending','${now}','${now}','${now}',0)`,
    ).join(',\n')
    await env.DB.prepare(
      `INSERT INTO items (
        id, type, name, category, lat, lng, source_url,
        source_type, confidence, status, last_verified, created_at, updated_at, indoor
      ) VALUES ${values}`,
    ).run()
    const { results } = await env.DB
      .prepare("SELECT category FROM items WHERE id LIKE 'cat-%' ORDER BY category")
      .all<{ category: string }>()
    expect(results.map((r) => r.category)).toEqual([...ALL_CATEGORIES].sort())
  })

  it('rejects an unknown source_type (CHECK still bites after the rebuild)', async () => {
    const now = new Date().toISOString()
    await expect(
      env.DB.prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url, source_type,
          confidence, status, last_verified, created_at, updated_at, indoor
        ) VALUES ('bogus-src', 'place', 'Bogus', 'park', 37.7, -122.4,
          'https://example.com', 'google-places', 'high', 'pending', ?, ?, ?, 0)`,
      ).bind(now, now, now).run(),
    ).rejects.toThrow()
  })

  it('lets many rows share a NULL slug but rejects a duplicate non-null slug', async () => {
    // The partial unique index is what makes /place/{slug} safe: the
    // thousands of Tier-C rows that never get a standalone page all keep
    // slug NULL, while any published slug is unique nationally.
    await seedLegacyItem('null-slug-1')
    await seedLegacyItem('null-slug-2')
    const nulls = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM items WHERE slug IS NULL')
      .first<{ n: number }>()
    expect(nulls?.n).toBe(2)

    await env.DB.prepare("UPDATE items SET slug = 'shared-slug' WHERE id = 'null-slug-1'").run()
    await expect(
      env.DB.prepare("UPDATE items SET slug = 'shared-slug' WHERE id = 'null-slug-2'").run(),
    ).rejects.toThrow()
  })

  it('creates the region+status index the national queries rely on', async () => {
    const { results } = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_items_region_status','idx_items_slug') ORDER BY name")
      .all<{ name: string }>()
    expect(results.map((r) => r.name)).toEqual(['idx_items_region_status', 'idx_items_slug'])
  })
})

describe('region-scoped item queries', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it('returns only the requested region', async () => {
    await seedLegacyItem('bay-row')
    await seedRegionalItem('ny-row', 'new-york')
    await seedRegionalItem('la-row', 'los-angeles', 34.05, -118.24)

    expect((await listByStatusAndRegion(env.DB, 'approved', 'bay')).map((i) => i.id)).toEqual(['bay-row'])
    expect((await listByStatusAndRegion(env.DB, 'approved', 'new-york')).map((i) => i.id)).toEqual(['ny-row'])
    expect(await listByStatusAndRegion(env.DB, 'approved', 'chicago')).toEqual([])
  })

  it('round-trips region, city, attributes and slug through upsert', async () => {
    const now = new Date().toISOString()
    await upsert(env.DB, {
      id: 'up-1', type: 'place', name: 'Klyde Warren Park', description: null,
      category: 'park', lat: 32.7894, lng: -96.8017, address: null,
      age_min: null, age_max: null, cost: null, price_usd: null, indoor: 0,
      opening_hours: null,
      photo_url: null, photo_attribution: null, website: null, source_url: 'https://example.com/p',
      source_type: 'imls', confidence: 'medium', status: 'approved',
      last_verified: now, created_at: now, updated_at: now,
      region: 'dallas', city: 'Dallas',
      attributes: { splashpad: true, restrooms: true }, slug: 'klyde-warren-park-dallas',
    })
    const got = await getById(env.DB, 'up-1')
    expect(got?.region).toBe('dallas')
    expect(got?.city).toBe('Dallas')
    expect(got?.slug).toBe('klyde-warren-park-dallas')
    expect(got?.attributes).toEqual({ splashpad: true, restrooms: true })
  })

  it('never rewrites an existing slug on re-upsert (published URLs are permanent)', async () => {
    const now = new Date().toISOString()
    const base = {
      id: 'up-2', type: 'place' as const, description: null,
      category: 'park' as const, lat: 32.78, lng: -96.8, address: null,
      age_min: null, age_max: null, cost: null, price_usd: null, indoor: 0 as const,
      opening_hours: null,
      photo_url: null, photo_attribution: null, website: null, source_url: 'https://example.com/p',
      source_type: 'imls' as const, confidence: 'medium' as const, status: 'approved' as const,
      last_verified: now, created_at: now, updated_at: now,
      region: 'dallas', city: 'Dallas', attributes: null,
    }
    await upsert(env.DB, { ...base, name: 'Old Name', slug: 'old-name-dallas' })
    // Upstream renamed the place; the importer computes a new slug from the
    // new name. The stored slug must win — a published URL can't 404.
    await upsert(env.DB, { ...base, name: 'New Name', slug: 'new-name-dallas' })
    const got = await getById(env.DB, 'up-2')
    expect(got?.name).toBe('New Name')
    expect(got?.slug).toBe('old-name-dallas')
  })
})

describe('/api/items.json ?region=', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it('defaults to the Bay Area when no region is given (pre-national behaviour)', async () => {
    await seedLegacyItem('bay-row')
    await seedRegionalItem('ny-row', 'new-york')
    const res = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.9.0.1', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ items: { id: string }[]; region: string }>()
    expect(body.region).toBe('bay')
    expect(body.items.map((i) => i.id)).toEqual(['bay-row'])
  })

  it('scopes to an explicit published region', async () => {
    await seedLegacyItem('bay-row')
    await seedRegionalItem('ny-row', 'new-york')
    const res = await SELF.fetch('https://example.com/api/items.json?region=bay', {
      headers: { 'cf-connecting-ip': '10.9.0.2', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ items: { id: string }[]; region: string }>()
    expect(body.region).toBe('bay')
    expect(body.items.map((i) => i.id)).toEqual(['bay-row'])
  })

  it('400s on an unknown region rather than serving an empty list', async () => {
    const res = await SELF.fetch('https://example.com/api/items.json?region=atlantis', {
      headers: { 'cf-connecting-ip': '10.9.0.3', ...(await authHeaders()) },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown region' })
    // Never cacheable: a cached rejection would outlive the condition that
    // caused it, and no purge can reach it.
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it("400s on the Bay Area's URL slug and names the id to use instead", async () => {
    // `bay-area` is the /bay-area/* page slug; the region id is `bay`. The
    // two namespaces diverge only here, so it's the likeliest caller mistake
    // — the hint turns a debugging session into a readable error.
    const res = await SELF.fetch('https://example.com/api/items.json?region=bay-area', {
      headers: { 'cf-connecting-ip': '10.9.0.4', ...(await authHeaders()) },
    })
    expect(res.status).toBe(400)
    const body = await res.json<{ error: string; hint?: string }>()
    expect(body.hint).toContain("use 'bay'")
  })

  it('404s (no-store) on a valid but unpublished region', async () => {
    // Detroit is a real registry entry that has not launched. Serving its
    // rows early would leak a metro dataset before its launch moment, and a
    // cacheable 200 here would be un-purgeable — purgeItemsCache only knows
    // about published metros. (New York graduated from this fixture at the
    // wave launch, #362.)
    await seedRegionalItem('det-row', 'detroit', 42.33, -83.05)
    const res = await SELF.fetch('https://example.com/api/items.json?region=detroit', {
      headers: { 'cf-connecting-ip': '10.9.0.5', ...(await authHeaders()) },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'region not published' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('200s on a wave region now that it is published (#362)', async () => {
    await seedRegionalItem('ny-row', 'new-york')
    const res = await SELF.fetch('https://example.com/api/items.json?region=new-york', {
      headers: { 'cf-connecting-ip': '10.9.0.6', ...(await authHeaders()) },
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ items: { id: string }[]; region: string }>()
    expect(body.region).toBe('new-york')
    expect(body.items.map((i) => i.id)).toEqual(['ny-row'])
  })
})
