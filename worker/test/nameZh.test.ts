import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { Item } from '@shared/types'
import { d1Migrations } from './helpers/migrations'
import { getById, upsert } from '../src/db/items'
import { mintSessionToken } from '../src/utils/session'

// Must match the value in vitest.config.ts's `miniflare.bindings.SESSION_SIGNING_KEY`.
const TEST_SIGNING_KEY = 'test-key-for-vitest-only-change-in-prod-xyz123'
const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await mintSessionToken(TEST_SIGNING_KEY)}`,
})

const now = new Date().toISOString()

const makeItem = (over: Partial<Item> = {}): Item => ({
  id: 'zh-1',
  type: 'place',
  name: 'Golden Gate Park',
  description: null,
  category: 'park',
  lat: 37.77,
  lng: -122.47,
  address: null,
  age_min: null,
  age_max: null,
  cost: 'free',
  price_usd: null,
  indoor: 0,
  opening_hours: null,
  start_time: null,
  end_time: null,
  rrule: null,
  exdates: null,
  photo_url: null,
  photo_attribution: null,
  website: null,
  source_url: 'https://example.com/ggp',
  source_type: 'osm',
  confidence: 'medium',
  status: 'approved',
  last_verified: now,
  created_at: now,
  updated_at: now,
  crops: null,
  crops_state: null,
  in_season_now: null,
  region: 'bay',
  city: null,
  attributes: null,
  slug: null,
  has_playground: null,
  name_zh: null,
  ...over,
})

describe('name_zh (#692) — storage', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  it('round-trips a translated title', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBe('金门公园')
  })

  it('defaults to null, so an untranslated row falls back to English downstream', async () => {
    await upsert(env.DB, makeItem())
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBeNull()
  })

  // Every importer passes name_zh: null, so an unconditional overwrite on
  // conflict would erase a backfilled translation on the next quarterly OSM
  // pass — the same failure photo_url's COALESCE exists to prevent.
  it('survives an importer re-run that carries no translation', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    await upsert(env.DB, makeItem({ name_zh: null, description: 'refreshed by the importer' }))
    const row = await getById(env.DB, 'zh-1')
    expect(row?.name_zh).toBe('金门公园')
    expect(row?.description).toBe('refreshed by the importer')
  })

  // The other half of that trade-off: a preserved translation must not outlive
  // the English name it was translated FROM, or an upstream rename leaves the
  // row captioned with a different place entirely.
  it('drops a stale translation when upstream renames the venue', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    await upsert(env.DB, makeItem({ name: 'Golden Gate Park & Botanical Garden', name_zh: null }))
    const row = await getById(env.DB, 'zh-1')
    expect(row?.name).toBe('Golden Gate Park & Botanical Garden')
    expect(row?.name_zh).toBeNull()
  })

  it('takes a fresh translation supplied alongside a rename', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    await upsert(env.DB, makeItem({ name: 'GGP Botanical Garden', name_zh: '金门公园植物园' }))
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBe('金门公园植物园')
  })
})

describe('name_zh (#692) — public payloads', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  // Every card, calendar row, picks entry and search suggestion renders from
  // the list payload — a translation missing HERE cannot reach the screen at
  // all, however well it round-trips in D1.
  it('is carried by /api/items.json and /api/items/:id', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))

    const list = await SELF.fetch('https://example.com/api/items.json', {
      headers: { 'cf-connecting-ip': '10.0.0.9', ...(await authHeaders()) },
    })
    const body = await list.json() as { items: Record<string, unknown>[] }
    expect(body.items[0]).toMatchObject({ name: 'Golden Gate Park', name_zh: '金门公园' })

    const detail = await SELF.fetch('https://example.com/api/items/zh-1', {
      headers: { 'cf-connecting-ip': '10.0.0.9', ...(await authHeaders()) },
    })
    expect((await detail.json() as { item: Item }).item.name_zh).toBe('金门公园')
  })
})

describe('name_zh (#692) — curator escape hatch', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items;')
  })

  const edit = (body: Record<string, unknown>) =>
    SELF.fetch('https://example.com/api/admin/items/zh-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-admin': 'yes' },
      body: JSON.stringify(body),
    })

  it('sets a translation, and trims it', async () => {
    await upsert(env.DB, makeItem())
    expect((await edit({ name_zh: '  金门公园  ' })).status).toBe(200)
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBe('金门公园')
  })

  // `upsert` preserves a stored translation against importers, which would
  // also silently swallow a curator's correction if the PUT relied on it.
  it('overwrites an existing translation', async () => {
    await upsert(env.DB, makeItem({ name_zh: '错误的名字' }))
    await edit({ name_zh: '金门公园' })
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBe('金门公园')
  })

  it('clears back to null on a blank value, so the row falls back to English', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    await edit({ name_zh: '   ' })
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBeNull()
  })

  it('rejects an over-long paste', async () => {
    await upsert(env.DB, makeItem())
    const res = await edit({ name_zh: '金'.repeat(301) })
    expect(res.status).toBe(400)
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBeNull()
  })

  it('rejects a non-string value instead of throwing a 500', async () => {
    await upsert(env.DB, makeItem())
    const res = await edit({ name_zh: 123 })
    expect(res.status).toBe(400)
    expect((await getById(env.DB, 'zh-1'))?.name_zh).toBeNull()
  })

  it('drops the stale translation when a curator renames an item', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    const res = await edit({ name: 'Golden Gate Park & Botanical Garden' })
    expect(res.status).toBe(200)
    const row = await getById(env.DB, 'zh-1')
    expect(row?.name).toBe('Golden Gate Park & Botanical Garden')
    expect(row?.name_zh).toBeNull()
  })

  it('keeps a fresh translation supplied with a curator rename', async () => {
    await upsert(env.DB, makeItem({ name_zh: '金门公园' }))
    const res = await edit({
      name: 'Golden Gate Park & Botanical Garden',
      name_zh: '金门公园及植物园',
    })
    expect(res.status).toBe(200)
    const row = await getById(env.DB, 'zh-1')
    expect(row?.name).toBe('Golden Gate Park & Botanical Garden')
    expect(row?.name_zh).toBe('金门公园及植物园')
  })
})
