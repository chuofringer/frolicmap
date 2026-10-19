import { env, SELF, applyD1Migrations } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { d1Migrations } from './helpers/migrations'

vi.mock('../src/ingest/osm', () => ({
  runOsmIngest: vi.fn(async () => ({
    started: '2026-04-30T00:00:00Z',
    finished: '2026-04-30T00:00:01Z',
    fetched: 10,
    inserted: 5,
    updated: 0,
    errors: [],
  })),
}))

const DEV_HEADERS = { 'x-dev-admin': 'yes', 'content-type': 'application/json' }

async function seed(id: string, status: string) {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO items (id, type, name, category, lat, lng, source_url, source_type, confidence, status, last_verified, created_at, updated_at)
     VALUES (?, 'place', 'X', 'playground', 37.7, -122.4, 'https://x', 'manual', 'high', ?, ?, ?, ?)`
  ).bind(id, status, now, now, now).run()
}

describe('admin API', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB, d1Migrations) })
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM items; DELETE FROM reports; DELETE FROM ingestion_log;')
  })

  it('requires access (returns 503 when access not configured and no dev header)', async () => {
    const res = await SELF.fetch('https://example.com/api/admin/ping')
    expect(res.status).toBe(503)
  })

  it('lists pending items with dev header', async () => {
    await seed('a', 'pending')
    await seed('b', 'approved')
    const res = await SELF.fetch('https://example.com/api/admin/items?status=pending', { headers: DEV_HEADERS })
    const body = await res.json() as { items: { id: string }[] }
    expect(body.items.map(i => i.id)).toEqual(['a'])
  })

  it('approves an item', async () => {
    await seed('a', 'pending')
    const res = await SELF.fetch('https://example.com/api/admin/items/a/approve', { method: 'POST', headers: DEV_HEADERS })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT status FROM items WHERE id = ?').bind('a').first()
    expect(row).toEqual({ status: 'approved' })
  })

  it('rejects a non-existent item with 404', async () => {
    const res = await SELF.fetch('https://example.com/api/admin/items/nope/approve', { method: 'POST', headers: DEV_HEADERS })
    expect(res.status).toBe(404)
  })

  it('edits item fields via PUT', async () => {
    await seed('a', 'pending')
    const res = await SELF.fetch('https://example.com/api/admin/items/a', {
      method: 'PUT',
      headers: DEV_HEADERS,
      body: JSON.stringify({ description: 'Lovely playground', age_min: 2, age_max: 8 }),
    })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT description, age_min FROM items WHERE id=?').bind('a').first()
    expect(row).toEqual({ description: 'Lovely playground', age_min: 2 })
  })

  describe('PUT photo_url / photo_attribution (#299)', () => {
    it('accepts an https photo_url + attribution and persists both', async () => {
      await seed('photo-1', 'pending')
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-1', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({
          photo_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg',
          photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
        }),
      })
      expect(res.status).toBe(200)
      const row = await env.DB.prepare('SELECT photo_url, photo_attribution FROM items WHERE id=?').bind('photo-1').first()
      expect(row).toEqual({
        photo_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg',
        photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
      })
    })

    it('overwrites a previously-set photo_url via the escape hatch (upsert alone would COALESCE it away)', async () => {
      await seed('photo-2', 'approved')
      // The pre-existing value is written directly (bypassing the PUT
      // validation) to model a legacy/direct-write row — the point of this
      // test is the COALESCE-escape-hatch behavior, not host validation.
      await env.DB.prepare("UPDATE items SET photo_url='https://old-host.example/x.jpg', photo_attribution='Old attribution' WHERE id=?")
        .bind('photo-2').run()
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-2', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_url: 'https://upload.wikimedia.org/y.jpg', photo_attribution: 'New attribution' }),
      })
      expect(res.status).toBe(200)
      const row = await env.DB.prepare('SELECT photo_url, photo_attribution FROM items WHERE id=?').bind('photo-2').first()
      expect(row).toEqual({ photo_url: 'https://upload.wikimedia.org/y.jpg', photo_attribution: 'New attribution' })
    })

    it('clears photo_url + photo_attribution to NULL on an empty-string patch', async () => {
      await seed('photo-3', 'approved')
      await env.DB.prepare("UPDATE items SET photo_url='https://old/x.jpg', photo_attribution='Old attribution' WHERE id=?")
        .bind('photo-3').run()
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-3', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_url: '', photo_attribution: '' }),
      })
      expect(res.status).toBe(200)
      const row = await env.DB.prepare('SELECT photo_url, photo_attribution FROM items WHERE id=?').bind('photo-3').first()
      expect(row).toEqual({ photo_url: null, photo_attribution: null })
    })

    it('rejects a plain http:// photo_url with 400 and writes nothing', async () => {
      await seed('photo-4', 'pending')
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-4', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_url: 'http://example.com/x.jpg' }),
      })
      expect(res.status).toBe(400)
      const row = await env.DB.prepare('SELECT photo_url FROM items WHERE id=?').bind('photo-4').first()
      expect(row).toEqual({ photo_url: null })
    })

    it('rejects a javascript: URL with 400', async () => {
      await seed('photo-5', 'pending')
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-5', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_url: 'javascript:alert(1)' }),
      })
      expect(res.status).toBe(400)
      const row = await env.DB.prepare('SELECT photo_url FROM items WHERE id=?').bind('photo-5').first()
      expect(row).toEqual({ photo_url: null })
    })

    it('rejects an https URL on a non-allow-listed host with 400 and writes nothing (host allow-list, not just scheme)', async () => {
      await seed('photo-5b', 'pending')
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-5b', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_url: 'https://evil.example/tracker.jpg' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/allow-listed|wikimedia/i)
      const row = await env.DB.prepare('SELECT photo_url FROM items WHERE id=?').bind('photo-5b').first()
      expect(row).toEqual({ photo_url: null })
    })

    it('rejects an over-length photo_attribution with 400', async () => {
      await seed('photo-6', 'pending')
      const res = await SELF.fetch('https://example.com/api/admin/items/photo-6', {
        method: 'PUT',
        headers: DEV_HEADERS,
        body: JSON.stringify({ photo_attribution: 'x'.repeat(2049) }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/admin/run/:source', () => {
    it('returns 503 without admin auth (CF Access not configured)', async () => {
      // Same as 'requires access' baseline test — no x-dev-admin header set
      const res = await SELF.fetch('https://example.com/api/admin/run/osm', {
        method: 'POST',
      })
      expect(res.status).toBe(503)
    })

    it('returns 400 for unknown source', async () => {
      const res = await SELF.fetch('https://example.com/api/admin/run/bogus', {
        method: 'POST',
        headers: DEV_HEADERS,
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/unknown source/i)
    })

    it('runs osm and returns stats', async () => {
      const res = await SELF.fetch('https://example.com/api/admin/run/osm', {
        method: 'POST',
        headers: DEV_HEADERS,
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { source: string; inserted: number }
      expect(body.source).toBe('osm')
      expect(body.inserted).toBe(5)
    })

  })

  describe('GET /api/admin/observability', () => {
    it('returns the osm cron card even on a clean DB', async () => {
      const res = await SELF.fetch('https://example.com/api/admin/observability', { headers: DEV_HEADERS })
      expect(res.status).toBe(200)
      const body = await res.json() as {
        crons: Array<{ source_id: string; status: string; last_run_at: string | null }>
      }
      // The single quarterly OSM cron is always present, even with no log rows.
      expect(body.crons.map((c) => c.source_id)).toEqual(['osm'])
      // No log rows -> status='unknown', last_run_at=null.
      expect(body.crons[0].status).toBe('unknown')
      expect(body.crons[0].last_run_at).toBeNull()
      // No outbound-click telemetry in this deployment.
      expect(body).not.toHaveProperty('outbound_clicks')
    })

    it('classifies a recent clean osm run as healthy', async () => {
      const recent = new Date().toISOString()
      await env.DB.prepare(
        "INSERT INTO ingestion_log (source_id, started_at, finished_at, fetched, inserted, updated, errors) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind('osm', recent, recent, 12, 7, 5, null).run()

      const res = await SELF.fetch('https://example.com/api/admin/observability', { headers: DEV_HEADERS })
      const body = await res.json() as { crons: Array<{ source_id: string; status: string; last_inserted: number | null }> }
      expect(body.crons[0].status).toBe('healthy')
      expect(body.crons[0].last_inserted).toBe(7)
    })

    it('classifies a run with errors as failed and surfaces them', async () => {
      const recent = new Date().toISOString()
      await env.DB.prepare(
        "INSERT INTO ingestion_log (source_id, started_at, finished_at, fetched, inserted, updated, errors) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind('osm', recent, recent, 0, 0, 0, JSON.stringify(['boom'])).run()

      const res = await SELF.fetch('https://example.com/api/admin/observability', { headers: DEV_HEADERS })
      const body = await res.json() as { crons: Array<{ status: string; last_errors: string[] | null }> }
      expect(body.crons[0].status).toBe('failed')
      expect(body.crons[0].last_errors).toEqual(['boom'])
    })

    it('classifies a run older than twice the quarterly cadence as failed', async () => {
      const stale = new Date(Date.now() - 200 * 86400000).toISOString() // 200 days ago
      await env.DB.prepare(
        "INSERT INTO ingestion_log (source_id, started_at, finished_at, fetched, inserted, updated, errors) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind('osm', stale, stale, 1, 1, 0, null).run()

      const res = await SELF.fetch('https://example.com/api/admin/observability', { headers: DEV_HEADERS })
      const body = await res.json() as { crons: Array<{ status: string }> }
      expect(body.crons[0].status).toBe('failed')
    })

    it('requires admin auth', async () => {
      const res = await SELF.fetch('https://example.com/api/admin/observability')
      expect(res.status).toBe(503)
    })
  })
})
