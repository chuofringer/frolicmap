import { describe, it, expect, afterEach } from 'vitest'
import { deriveGoodToKnow, parseOpenUntil, formatDistanceMi, formatEventTiming, formatSiblingChip, websiteFor } from '../detailHelpers'
import { viewerTimezone } from '@/utils/venueTime'
import { i18next, loadLocale } from '@/i18n'

describe('formatEventTiming (shared with ItemPopup)', () => {
  it('describes a weekly RRULE by day', () => {
    expect(formatEventTiming('2026-04-11T13:00:00Z', null, 'FREQ=WEEKLY;BYDAY=SA')).toMatch(/^Every Saturdays/)
  })
  it('describes a monthly RRULE by day', () => {
    expect(formatEventTiming('2026-04-11T13:00:00Z', null, 'FREQ=MONTHLY;BYDAY=SA')).toMatch(/^Monthly on Saturdays/)
  })
  it('falls back to Recurring for other freqs', () => {
    expect(formatEventTiming(null, null, 'FREQ=DAILY')).toBe('Recurring')
  })
  it('describes an ordinal-prefixed BYDAY (2nd Saturday) rather than degrading to Recurring', () => {
    expect(formatEventTiming(null, null, 'FREQ=MONTHLY;BYDAY=2SA')).toBe('Monthly on 2nd Saturdays')
  })
  it('applies BYSETPOS ordinals to a single BYDAY weekday (#421)', () => {
    expect(formatEventTiming(null, null, 'FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2,4'))
      .toBe('Monthly on 2nd Sundays, 4th Sundays')
  })
  it('falls back to a generic phrase when BYSETPOS spans multiple weekdays', () => {
    expect(formatEventTiming(null, null, 'FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1')).toBe('Recurring')
  })
  it('renders BYSETPOS ordinals in occurrence order, not token order', () => {
    expect(formatEventTiming(null, null, 'FREQ=MONTHLY;BYDAY=SU;BYSETPOS=4,2'))
      .toBe('Monthly on 2nd Sundays, 4th Sundays')
    expect(formatEventTiming(null, null, 'FREQ=MONTHLY;BYDAY=SU;BYSETPOS=-1,2'))
      .toBe('Monthly on 2nd Sundays, last Sundays')
  })
  it('ignores a vestigial BYSETPOS on non-MONTHLY freqs instead of demoting to Recurring', () => {
    // The expansion engine ignores BYSETPOS outside MONTHLY, so the copy
    // must keep the weekday label the occurrences actually follow.
    expect(formatEventTiming(null, null, 'FREQ=WEEKLY;BYDAY=SA;BYSETPOS=1')).toMatch(/^Every Saturdays/)
  })
  it('renders a single start as date · time and a same-day range with a dash', () => {
    expect(formatEventTiming('2026-04-11T13:00:00Z', null, null)).toContain('·')
    expect(formatEventTiming('2026-04-11T13:00:00Z', '2026-04-11T15:00:00Z', null)).toContain('–')
  })
  it('returns empty string with no timing', () => {
    expect(formatEventTiming(null, null, null)).toBe('')
  })
})

describe('formatEventTiming — venue timezone', () => {
  it('renders a New York event on the New York clock for every viewer', () => {
    const s = formatEventTiming('2026-07-23T08:00:00-04:00', null, null, 'America/New_York')
    expect(s).toContain('Jul 23')
    expect(s).toContain('8:00 AM')
    // Never the shifted clock a non-ET viewer used to see.
    expect(s).not.toContain('5:00 AM')
    expect(s).not.toContain('12:00 PM')
  })

  it('renders a true-UTC stored instant (ICS row) on the venue clock', () => {
    const s = formatEventTiming('2026-05-03T17:30:00.000Z', '2026-05-03T18:30:00.000Z', null, 'America/Los_Angeles')
    expect(s).toContain('10:30 AM')
    expect(s).toContain('11:30 AM')
    expect(s).toContain('May 3')
  })

  it('suffixes the venue zone exactly when it differs from the viewer zone', () => {
    const s = formatEventTiming('2026-07-23T08:00:00-04:00', null, null, 'America/New_York')
    if (viewerTimezone() === 'America/New_York') {
      expect(s).not.toMatch(/E[DS]T/)
    } else {
      expect(s).toMatch(/8:00 AM EDT$/)
    }
  })

  it('weekly RRULE time reads on the venue clock', () => {
    const s = formatEventTiming('2026-07-04T10:00:00-04:00', null, 'FREQ=WEEKLY;BYDAY=SA', 'America/New_York')
    expect(s).toMatch(/^Every Saturdays at 10:00 AM/)
  })

  it('renders bare-date rows as dates with NO clock time', () => {
    const s = formatEventTiming('2027-08-01', null, null, 'America/Los_Angeles')
    expect(s).toBe('Sun, Aug 1')
    expect(s).not.toContain('·')
  })

  it('renders a bare-date range as a date span', () => {
    const s = formatEventTiming('2027-08-01', '2027-08-03', null, 'America/Los_Angeles')
    expect(s).toBe('Sun, Aug 1 – Tue, Aug 3')
  })
})

describe('formatSiblingChip — venue timezone', () => {
  it('chips carry the venue clock', () => {
    expect(formatSiblingChip('2026-07-23T13:00:00-04:00', 'America/New_York')).toBe('Thu, Jul 23 · 1pm')
  })
  it('bare-date chips carry the date alone', () => {
    expect(formatSiblingChip('2027-08-01', 'America/Los_Angeles')).toBe('Sun, Aug 1')
  })
})

// #573 — midnight-timed rows that are semantically all-day (44 live rows:
// mommypoppins same-day 00:00–23:59 spans, no-end library/farm-season
// midnight starts, and one rrule row) rendered a literal "12:00 AM" instead
// of collapsing to the date alone.
describe('formatEventTiming — midnight-timed all-day rows (#573)', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en')
  })

  it('collapses a same-day 00:00 -> 23:59:00 span to the date alone (aggregator-mommypoppins-pride)', () => {
    const s = formatEventTiming('2026-09-19T00:00:00-07:00', '2026-09-19T23:59:00-07:00', null, 'America/Los_Angeles')
    expect(s).toBe('Sat, Sep 19')
    expect(s).not.toContain('12:00 AM')
  })

  it('collapses a same-day 00:00 -> 23:59:59 span to the date alone', () => {
    const s = formatEventTiming('2026-09-19T00:00:00-07:00', '2026-09-19T23:59:59-07:00', null, 'America/Los_Angeles')
    expect(s).toBe('Sat, Sep 19')
  })

  it('collapses a no-end midnight start to the date alone', () => {
    const s = formatEventTiming('2026-08-21T00:00:00-07:00', null, null, 'America/Los_Angeles')
    expect(s).toBe('Fri, Aug 21')
    expect(s).not.toContain('12:00 AM')
  })

  it('renders the same shapes in Chinese with no leaked "12:00 AM"', async () => {
    await loadLocale('zh')
    const spanS = formatEventTiming('2026-09-19T00:00:00-07:00', '2026-09-19T23:59:00-07:00', null, 'America/Los_Angeles')
    expect(spanS).not.toContain('12:00 AM')
    expect(spanS).not.toContain('·')
    const noEndS = formatEventTiming('2026-08-21T00:00:00-07:00', null, null, 'America/Los_Angeles')
    expect(noEndS).not.toContain('12:00 AM')
    expect(noEndS).not.toContain('·')
  })

  it('suppresses the "at 12:00 AM" suffix on an rrule row whose start is venue-midnight with no real end', () => {
    const s = formatEventTiming('2026-09-08T00:00:00-07:00', null, 'FREQ=WEEKLY;BYDAY=TU', 'America/Los_Angeles')
    expect(s).not.toContain('12:00 AM')
    expect(s).not.toContain(' at ')
  })

  it('does NOT collapse a midnight start with a real same-day end (00:00-01:00) — aggregator-mommypoppins-visit shape', () => {
    const s = formatEventTiming('2026-09-08T00:00:00-07:00', '2026-09-08T01:00:00-07:00', null, 'America/Los_Angeles')
    expect(s).toContain('12:00 AM')
    expect(s).toContain('1:00 AM')
  })

  it('does NOT collapse the same 00:00-01:00 shape on the rrule branch either', () => {
    const s = formatEventTiming('2026-09-08T00:00:00-07:00', '2026-09-08T01:00:00-07:00', 'FREQ=WEEKLY;BYDAY=TU', 'America/Los_Angeles')
    expect(s).toContain('12:00 AM')
  })
})

describe('formatSiblingChip — midnight-timed all-day rows (#573)', () => {
  it('collapses a no-end midnight start to the date alone', () => {
    expect(formatSiblingChip('2026-08-21T00:00:00-07:00', 'America/Los_Angeles')).toBe('Fri, Aug 21')
  })

  it('collapses a same-day 00:00 -> 23:59 span to the date alone when the end is passed', () => {
    expect(formatSiblingChip('2026-09-19T00:00:00-07:00', 'America/Los_Angeles', '2026-09-19T23:59:00-07:00')).toBe('Sat, Sep 19')
  })

  it('keeps the time for a real midnight-to-1am span', () => {
    expect(formatSiblingChip('2026-09-08T00:00:00-07:00', 'America/Los_Angeles', '2026-09-08T01:00:00-07:00')).toBe('Tue, Sep 8 · 12am')
  })
})

describe('deriveGoodToKnow', () => {
  it('returns nothing for null/empty attributes (never invents facts)', () => {
    expect(deriveGoodToKnow(null)).toEqual([])
    expect(deriveGoodToKnow({})).toEqual([])
  })

  it('maps recognised positive keys to ✓ facts', () => {
    const facts = deriveGoodToKnow({ restrooms: true, stroller_friendly: 'yes', picnic_tables: 1 })
    expect(facts).toEqual([
      { label: 'Restrooms nearby', state: 'yes' },
      { label: 'Stroller friendly', state: 'yes' },
      { label: 'Picnic tables', state: 'yes' },
    ])
  })

  it('marks partial/limited values as ◐', () => {
    expect(deriveGoodToKnow({ shade: 'partial' })).toEqual([{ label: 'Shade', state: 'partial' }])
  })

  it('skips negative and unrecognised values', () => {
    expect(deriveGoodToKnow({ restrooms: false, stroller: 'no', picnic_tables: 0, foo: 'bar' })).toEqual([])
  })
})

describe('parseOpenUntil', () => {
  const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

  it('parses a daily 12-hour range and returns the closing time when open', () => {
    expect(parseOpenUntil('Open daily · 7:00 AM – 6:00 PM', at(12))).toBe('6 PM')
  })

  it('parses a bare 24-hour range when currently open', () => {
    expect(parseOpenUntil('07:00-18:00', at(9))).toBe('6 PM')
  })

  it('returns null when currently closed', () => {
    expect(parseOpenUntil('07:00-18:00', at(20))).toBeNull()
  })

  it('returns null for per-day schedules it cannot confidently reduce to one range', () => {
    expect(parseOpenUntil('Mo-Fr 09:00-17:00; Sa 10:00-14:00', at(12))).toBeNull()
  })

  it('returns null for missing / unparseable hours', () => {
    expect(parseOpenUntil(null, at(12))).toBeNull()
    expect(parseOpenUntil('by appointment', at(12))).toBeNull()
  })
})

describe('formatDistanceMi', () => {
  it('returns null without an origin', () => {
    expect(formatDistanceMi(null, -122, 37)).toBeNull()
  })

  // #645: this helper only formats the Near-me case now — the map-center
  // origin renders the venue's city instead (useDetailData), never a
  // "from map center" distance.
  it('formats to one decimal as a from-you distance', () => {
    expect(formatDistanceMi([-122.4, 37.77], -122.4, 37.77)).toBe('0.0 mi from you')
  })
})

describe('websiteFor', () => {
  it('prefers the curated website when set', () => {
    expect(websiteFor({ website: 'https://hiller.org', source_url: 'https://x.example', source_type: 'aggregator-bakf' }))
      .toBe('https://hiller.org')
  })

  it('falls back to source_url for canonical-source rows (aggregators, manual, scraped)', () => {
    expect(websiteFor({ website: null, source_url: 'https://www.hiller.org/event', source_type: 'aggregator-bakf' }))
      .toBe('https://www.hiller.org/event')
    expect(websiteFor({ website: null, source_url: 'https://venue.example', source_type: 'manual' }))
      .toBe('https://venue.example')
  })

  it('never promotes a data-catalog source_url (OSM, IMLS, ParkServe)', () => {
    expect(websiteFor({ website: null, source_url: 'https://www.openstreetmap.org/node/1', source_type: 'osm' })).toBeNull()
    expect(websiteFor({ website: null, source_url: 'https://www.imls.gov/x', source_type: 'imls' })).toBeNull()
    expect(websiteFor({ website: null, source_url: 'https://www.tpl.org/parkserve', source_type: 'parkserve' })).toBeNull()
  })

  it('still shows an OSM website tag when the mapper provided one', () => {
    expect(websiteFor({ website: 'https://parks.smcgov.org', source_url: 'https://www.openstreetmap.org/way/2', source_type: 'osm' }))
      .toBe('https://parks.smcgov.org')
  })

  it('returns null with no detail or no urls at all', () => {
    expect(websiteFor(null)).toBeNull()
    expect(websiteFor(undefined)).toBeNull()
    expect(websiteFor({ website: null, source_url: null, source_type: 'manual' })).toBeNull()
  })
})
