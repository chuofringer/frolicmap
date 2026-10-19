import { SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { gateSource, type SourceAccuracyConfig } from '@shared/qualityGate'

describe('gateSource', () => {
  const cfg: SourceAccuracyConfig = {
    thresholds: { approve: 95, hold: 90 },
    sources: { a: { accuracy: 94.9, sampled: 50, week: 'w' }, b: { accuracy: 89, sampled: 50, week: 'w' } },
  }
  it('classifies tiers and unsampled', () => {
    expect(gateSource('a', cfg)).toMatchObject({ decision: 'hold', tier: 'probation' })
    expect(gateSource('b', cfg)).toMatchObject({ decision: 'hold', tier: 'failing' })
    expect(gateSource('zzz', cfg)).toEqual({ decision: 'unsampled', accuracy: null, tier: null })
    expect(gateSource('constructor', cfg).decision).toBe('unsampled')
  })
})

describe('approve-all quality gate route (event-only) is gone', () => {
  // The gate guarded bulk approval of EVENT rows. There are no events and no
  // bulk approve here; `gateSource` stays as a shared library for the scripts.
  it('POST /api/admin/items/approve-all is 404', async () => {
    const res = await SELF.fetch('https://example.com/api/admin/items/approve-all', {
      method: 'POST',
      headers: { 'x-dev-admin': 'yes', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})
