import { describe, it, expect, afterEach } from 'vitest'
import { formatEventTiming, formatSiblingChip, formatDistanceMi } from '../detailHelpers'
import { i18next, loadLocale } from '@/i18n'

/**
 * The venue-local wall clock (#489) must be IDENTICAL in both locales — only
 * its presentation changes.
 *
 * The suite runs at TZ=UTC (vitest.config.ts), so the viewer is never in the
 * venue's zone and the zone suffix ("PDT", "EDT") is always rendered. That is
 * deliberate: it exercises the cross-zone path, which is the one a Bay Area
 * reader looking at a New York event actually hits. These cases are the ones most likely to regress:
 * a cross-zone event, a bare all-day date, and RRULE grammar, where English
 * word order used to be concatenated into the logic.
 */

const NY = 'America/New_York'
const LA = 'America/Los_Angeles'

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('cross-zone event', () => {
  // 10:00 on the NY wall clock, read by a viewer whose device is elsewhere.
  const start = '2026-08-15T10:00:00-04:00'

  it('renders the venue wall clock in English', () => {
    const out = formatEventTiming(start, null, null, NY)
    expect(out).toContain('10:00')
    expect(out).toMatch(/Aug/)
  })

  it('renders the SAME wall clock in Chinese', async () => {
    await loadLocale('zh')
    const out = formatEventTiming(start, null, null, NY)
    // Same instant on the venue's wall — 10:00, not shifted into another zone.
    expect(out).toContain('10:00')
    // Chinese month/day formatting, not English month abbreviations.
    expect(out).toMatch(/8月|08/)
    expect(out).not.toMatch(/Aug/)
  })
})

describe('bare all-day date', () => {
  const bare = '2026-08-15'

  it('renders date-only with no clock time in either locale', async () => {
    const enOut = formatEventTiming(bare, null, null, LA)
    expect(enOut).not.toMatch(/\d:\d\d/)

    await loadLocale('zh')
    const zhOut = formatEventTiming(bare, null, null, LA)
    expect(zhOut).not.toMatch(/\d:\d\d/)
    expect(zhOut).not.toBe(enOut) // formatted differently…
    expect(zhOut).toMatch(/8月|08/) // …but still August
  })
})

describe('RRULE grammar', () => {
  const start = '2026-08-02T11:00:00-07:00'

  it('puts the English time phrase after the days', () => {
    const out = formatEventTiming(start, null, 'FREQ=MONTHLY;BYDAY=1SU', LA)
    expect(out).toBe('Monthly on 1st Sundays at 11:00 AM PDT')
  })

  it('uses Chinese word order rather than a translated English skeleton', async () => {
    await loadLocale('zh')
    const out = formatEventTiming(start, null, 'FREQ=MONTHLY;BYDAY=1SU', LA)
    expect(out).toBe('每月第一个周日 11:00 PDT')
    // The English preposition must not survive into Chinese.
    expect(out).not.toContain(' at ')
    expect(out).not.toContain('Monthly')
  })

  it('handles every-other-week in both locales', async () => {
    const rr = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA'
    expect(formatEventTiming(start, null, rr, LA)).toBe('Every other Saturdays at 11:00 AM PDT')
    await loadLocale('zh')
    expect(formatEventTiming(start, null, rr, LA)).toBe('隔周周六 11:00 PDT')
  })

  it('joins multiple days with the locale-correct separator', async () => {
    const rr = 'FREQ=WEEKLY;BYDAY=SA,SU'
    expect(formatEventTiming(null, null, rr, LA)).toBe('Every Saturdays, Sundays')
    await loadLocale('zh')
    // Chinese enumerates with 、 — a comma here would read as foreign.
    expect(formatEventTiming(null, null, rr, LA)).toBe('每周六、周日')
  })

  it('honors BYSETPOS ordinals instead of stating the plain weekday (#421)', () => {
    // aggregator-bakf-marine-science-sunday: 2nd & 4th Sunday, NOT every Sunday.
    const rr = 'FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2,4'
    expect(formatEventTiming(start, null, rr, LA)).toBe('Monthly on 2nd Sundays, 4th Sundays at 11:00 AM PDT')
  })

  it('renders the same BYSETPOS rule in Chinese word order', async () => {
    const rr = 'FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2,4'
    await loadLocale('zh')
    expect(formatEventTiming(start, null, rr, LA)).toBe('每月第二个周日、第4个周日 11:00 PDT')
  })

  it('falls back to the generic recurring phrase when BYSETPOS cannot be reduced to a single weekday', () => {
    // Multiple BYDAY weekdays + BYSETPOS: which weekday "1st" lands on varies
    // by month, so there is no honest fixed-day label to show.
    const rr = 'FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1'
    expect(formatEventTiming(start, null, rr, LA)).toBe('Recurring at 11:00 AM PDT')
    expect(formatEventTiming(null, null, rr, LA)).toBe('Recurring')
  })
})

describe('formatSiblingChip compaction', () => {
  const start = '2026-08-15T13:00:00-07:00'

  it('compacts "1:00 PM" to "1pm" in English', () => {
    expect(formatSiblingChip(start, LA)).toMatch(/1pm$/)
  })

  it('does NOT apply that en-US surgery to Chinese output', async () => {
    await loadLocale('zh')
    const out = formatSiblingChip(start, LA)
    expect(out).not.toMatch(/pm/i)
    expect(out).toContain('13:00')
  })
})

describe('distance', () => {
  const origin: [number, number] = [-122.4, 37.77]

  it('stays in miles in both locales — US venues', async () => {
    const enOut = formatDistanceMi(origin, -122.42, 37.78)
    expect(enOut).toMatch(/^[\d.]+ mi from you$/)

    await loadLocale('zh')
    const zhOut = formatDistanceMi(origin, -122.42, 37.78)
    expect(zhOut).toContain('英里')
    // Same number, only the unit word + origin phrasing differ.
    const number = (s: string) => /[\d.]+/.exec(s)![0]
    expect(number(zhOut!)).toBe(number(enOut!))
  })
})
