import { env, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runOsmIngest } from '../src/ingest/osm'
import { d1Migrations } from './helpers/migrations'

describe('runOsmIngest (integration with D1)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, d1Migrations)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items; DELETE FROM ingestion_log;')
  })

  it('inserts new items as pending and preserves admin status on re-run', async () => {
    const fakeFetcher = async () => [
      { type: 'node' as const, id: 1, lat: 37.5, lon: -122.3, tags: { name: 'Test Place', leisure: 'playground' } },
    ]
    let stats = await runOsmIngest(env.DB, fakeFetcher)
    expect(stats.inserted).toBeGreaterThan(0)

    await env.DB.prepare("UPDATE items SET status='approved' WHERE id = 'osm-node-1'").run()

    stats = await runOsmIngest(env.DB, fakeFetcher)
    const { results } = await env.DB.prepare("SELECT status FROM items WHERE id = 'osm-node-1'").all()
    expect(results[0]).toEqual({ status: 'approved' })
  })

  it('writes a row to ingestion_log per run', async () => {
    await runOsmIngest(env.DB, async () => [])
    const { results } = await env.DB.prepare('SELECT source_id, fetched FROM ingestion_log').all()
    expect(results[0]).toEqual({ source_id: 'osm', fetched: 0 })
  })

  // #217: "Park + playground pins overlap on close zoom" — a park already
  // flagged has_playground (#220) should absorb a co-located OSM playground
  // node rather than getting a second overlapping pin for the same amenity.
  // `park` runs before `playground` in CATEGORIES_TO_INGEST, so this exercises
  // the real single-run ordering, not a pre-seeded fixture.
  it('skips a brand-new playground node within 30m of an already-flagged park', async () => {
    const fetcher = async (category: string) => {
      if (category === 'park') {
        return [{
          type: 'way' as const, id: 100, center: { lat: 37.5, lon: -122.3 },
          tags: { name: 'Mitchell Park', leisure: 'park', playground: 'yes' },
        }]
      }
      if (category === 'playground') {
        return [{
          // ~15m from the park's point — well inside the 30m overlap radius.
          type: 'node' as const, id: 101, lat: 37.50013, lon: -122.3,
          tags: { name: 'Mitchell Park Playground', leisure: 'playground' },
        }]
      }
      return []
    }
    const stats = await runOsmIngest(env.DB, fetcher)
    expect(stats.skippedOverlap).toBe(1)
    const { results } = await env.DB.prepare("SELECT id FROM items WHERE id = 'osm-node-101'").all()
    expect(results).toHaveLength(0)
    const park = await env.DB.prepare("SELECT has_playground FROM items WHERE id = 'osm-way-100'").first()
    expect(park).toEqual({ has_playground: 1 })
  })

  it('still creates a playground node far from any flagged park', async () => {
    const fetcher = async (category: string) => {
      if (category === 'park') {
        return [{
          type: 'way' as const, id: 200, center: { lat: 37.5, lon: -122.3 },
          tags: { name: 'Cuesta Park', leisure: 'park', playground: 'yes' },
        }]
      }
      if (category === 'playground') {
        return [{
          // ~1.1km away — far outside the 30m overlap radius.
          type: 'node' as const, id: 201, lat: 37.51, lon: -122.3,
          tags: { name: 'Unrelated Playground', leisure: 'playground' },
        }]
      }
      return []
    }
    const stats = await runOsmIngest(env.DB, fetcher)
    expect(stats.skippedOverlap).toBe(0)
    const { results } = await env.DB.prepare("SELECT id FROM items WHERE id = 'osm-node-201'").all()
    expect(results).toHaveLength(1)
  })

  // #686: ingestion_log.errors must tell truncation apart from transport failures.
  it('tags truncation vs transport failures in ingestion_log.errors', async () => {
    const fetcher = async (category: string) => {
      if (category === 'park') {
        throw Object.assign(new Error('Overpass truncated (park): timed out'), { kind: 'truncated' })
      }
      if (category === 'museum') throw new Error('network down')
      return []
    }
    await runOsmIngest(env.DB, fetcher as never)
    const row = await env.DB.prepare("SELECT errors FROM ingestion_log WHERE source_id='osm'").first<{ errors: string }>()
    const errors = String(row?.errors)
    expect(errors).toContain('park: [truncated] Overpass truncated (park)')
    expect(errors).toContain('museum: [transport] network down')
  })

  // #686 review: ~11 sequential categories x worst-case backoff would outrun
  // the 15-min cron limit, killing the run before logRun writes anything.
  it('passes one shared backoff budget to every category and stops at the run deadline', async () => {
    const budgets = new Set<unknown>()
    let t = 0
    const fetcher = async (_category: string, deps?: { budget?: { backoffMs: number } }) => {
      budgets.add(deps?.budget)
      t += 4 * 60_000 // each category "takes" 4 min
      return []
    }
    await runOsmIngest(env.DB, fetcher as never, { now: () => t })
    expect(budgets.size).toBe(1)
    expect([...budgets][0]).toBeDefined()
    const row = await env.DB.prepare(
      "SELECT errors FROM ingestion_log WHERE source_id='osm' ORDER BY id DESC LIMIT 1",
    ).first<{ errors: string }>()
    const errors = JSON.parse(row!.errors) as string[]
    // 3 categories run (0, 4, 8 min elapsed); the rest are skipped and logged.
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((e) => e.includes('[deadline]'))).toBe(true)
  })
})
