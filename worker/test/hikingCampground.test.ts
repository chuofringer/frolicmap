import { env, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runOsmIngest } from '../src/ingest/osm'
import { d1Migrations } from './helpers/migrations'

describe('migration 0014 (hiking + campground categories)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items; DELETE FROM ingestion_log;')
  })

  it('applies cleanly and accepts hiking + campground rows', async () => {
    const now = new Date().toISOString()
    await env.DB
      .prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url,
          source_type, confidence, status, last_verified, created_at, updated_at,
          indoor
        ) VALUES
          ('test-hiking-1','place','Test Trailhead','hiking',37.7,-122.4,
            'https://example.com/trail','manual','high','pending',?,?,?,0),
          ('test-camp-1','place','Test Campground','campground',37.7,-122.4,
            'https://example.com/camp','manual','high','pending',?,?,?,0)`,
      )
      .bind(now, now, now, now, now, now)
      .run()
    const { results } = await env.DB
      .prepare('SELECT id, category FROM items ORDER BY id')
      .all<{ id: string; category: string }>()
    expect(results).toEqual([
      { id: 'test-camp-1', category: 'campground' },
      { id: 'test-hiking-1', category: 'hiking' },
    ])
  })

  it('rejects an unknown category (CHECK constraint still bites)', async () => {
    const now = new Date().toISOString()
    await expect(
      env.DB
        .prepare(
          `INSERT INTO items (
            id, type, name, category, lat, lng, source_url,
            source_type, confidence, status, last_verified, created_at, updated_at,
            indoor
          ) VALUES
            ('test-bogus','place','Bogus','not_a_real_category',37.7,-122.4,
              'https://example.com/x','manual','high','pending',?,?,?,0)`,
        )
        .bind(now, now, now)
        .run(),
    ).rejects.toThrow()
  })
})

describe('runOsmIngest — hiking + campground', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items; DELETE FROM ingestion_log;')
  })

  it('upserts a trailhead as category=hiking and a camp_site as category=campground', async () => {
    const fakeFetcher = async (category: string) => {
      if (category === 'hiking') {
        return [
          {
            type: 'node' as const,
            id: 100,
            lat: 37.857,
            lon: -122.535,
            tags: {
              name: 'Tennessee Valley Trailhead',
              information: 'trailhead',
            },
          },
        ]
      }
      if (category === 'campground') {
        return [
          {
            type: 'node' as const,
            id: 200,
            lat: 37.826,
            lon: -122.481,
            tags: {
              name: 'Kirby Cove Campground',
              tourism: 'camp_site',
            },
          },
        ]
      }
      return []
    }

    const stats = await runOsmIngest(env.DB, fakeFetcher)
    // Sanity: both rows fetched + inserted.
    expect(stats.fetched).toBe(2)
    expect(stats.inserted).toBe(2)
    const { results } = await env.DB
      .prepare("SELECT id, category, name, indoor FROM items WHERE id IN ('osm-node-100','osm-node-200') ORDER BY id")
      .all<{ id: string; category: string; name: string; indoor: number }>()
    expect(results).toEqual([
      { id: 'osm-node-100', category: 'hiking', name: 'Tennessee Valley Trailhead', indoor: 0 },
      { id: 'osm-node-200', category: 'campground', name: 'Kirby Cove Campground', indoor: 0 },
    ])
  })
})

