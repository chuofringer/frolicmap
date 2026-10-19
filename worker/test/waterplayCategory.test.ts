import { env, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { ALL_CATEGORIES } from '@shared/types'
import { d1Migrations } from './helpers/migrations'

describe('migration 0015 (waterplay category + aggregator-waterplay source_type)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items; DELETE FROM ingestion_log;')
  })

  it('accepts a row for EVERY category in ALL_CATEGORIES (CHECK list matches the shared union)', async () => {
    // One INSERT per category — a category present in the TS union but
    // missing from the rebuilt CHECK list (a transcription slip in the
    // rename+rebuild+copy) fails here, not in prod mid-rebuild.
    const now = new Date().toISOString()
    const values = ALL_CATEGORIES.map(
      (cat) =>
        `('test-${cat}','place','Test ${cat}','${cat}',37.7,-122.4,` +
        `'https://example.com/${cat}','manual','high','pending','${now}','${now}','${now}',0)`,
    ).join(',\n          ')
    await env.DB
      .prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url,
          source_type, confidence, status, last_verified, created_at, updated_at,
          indoor
        ) VALUES
          ${values}`,
      )
      .run()
    const { results } = await env.DB
      .prepare('SELECT category FROM items ORDER BY category')
      .all<{ category: string }>()
    expect(results.map((r) => r.category)).toEqual([...ALL_CATEGORIES].sort())
  })

  it('accepts the aggregator-waterplay source_type (unused vestige kept in the CHECK — spec §9: static seed, no routine)', async () => {
    const now = new Date().toISOString()
    await env.DB
      .prepare(
        `INSERT INTO items (
          id, type, name, category, lat, lng, source_url,
          source_type, confidence, status, last_verified, created_at, updated_at,
          indoor, cost
        ) VALUES
          ('waterplay-test-splash-pad','place','Test Splash Pad','waterplay',37.7,-122.4,
            'https://example.com/splash','aggregator-waterplay','high','pending',?,?,?,0,'free')`,
      )
      .bind(now, now, now)
      .run()
    const { results } = await env.DB
      .prepare("SELECT source_type FROM items WHERE id = 'waterplay-test-splash-pad'")
      .all<{ source_type: string }>()
    expect(results).toEqual([{ source_type: 'aggregator-waterplay' }])
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
            ('test-bogus','place','Bogus','swimming-hole',37.7,-122.4,
              'https://example.com/x','manual','high','pending',?,?,?,0)`,
        )
        .bind(now, now, now)
        .run(),
    ).rejects.toThrow()
  })
})
