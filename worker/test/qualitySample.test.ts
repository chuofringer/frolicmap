import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs helper, no type declarations
import { seededSample, stratifiedSample, isoWeekWindow, formatVenueLocal, toCsv } from '../scripts/lib/qualitySample.mjs'

const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, source_type: i % 2 ? 'a' : 'b' }))

describe('qualitySample', () => {
  it('is reproducible, order-independent and seed-sensitive', () => {
    const a = seededSample(rows, 50, 'w41') as { id: string }[]
    const b = seededSample([...rows].reverse(), 50, 'w41') as { id: string }[]
    const c = seededSample(rows, 50, 'other') as { id: string }[]
    expect(a).toHaveLength(50)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    expect(a.map((r) => r.id)).not.toEqual(c.map((r) => r.id))
    expect(new Set(a.map((r) => r.id)).size).toBe(50)
  })

  it('returns everything when the population is smaller than n', () => {
    expect(seededSample(rows.slice(0, 3), 50, 's')).toHaveLength(3)
  })

  it('stratifies per source', () => {
    const s = stratifiedSample(rows, 5, 'x') as { source_type: string }[]
    expect(s.filter((r) => r.source_type === 'a')).toHaveLength(5)
    expect(s.filter((r) => r.source_type === 'b')).toHaveLength(5)
  })

  it('maps ISO week labels to a Monday-aligned UTC window', () => {
    expect(isoWeekWindow('2026-W41')).toEqual(['2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'])
    expect(() => isoWeekWindow('nope')).toThrow()
  })

  it('formats venue-local wall clock', () => {
    expect(formatVenueLocal('2026-10-10T10:30:00-07:00', 'America/Los_Angeles')).toBe('Sat 2026-10-10 10:30 PDT')
    expect(formatVenueLocal('2026-10-10T14:30:00Z', 'America/New_York')).toBe('Sat 2026-10-10 10:30 EDT')
    expect(formatVenueLocal('2026-10-10', 'America/New_York')).toBe('2026-10-10 (all day)')
    expect(formatVenueLocal(null, 'America/New_York')).toBe('')
  })

  it('escapes CSV cells', () => {
    const csv = toCsv([{ id: 'x', name: 'A, "B"', region: 'bay', source_type: 's', start: '', end: '', venue: '', source_url: '' }])
    expect(csv).toContain('"A, ""B"""')
  })
})
