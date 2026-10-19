import { describe, it, expect } from 'vitest'
import { applyFilters } from '../filters'
import { DEFAULT_FILTERS, type Item } from '@shared/types'

const base: Omit<Item, 'id' | 'name' | 'category'> = {
  type: 'place', description: null, lat: 37.7, lng: -122.4, address: null,
  age_min: null, age_max: null, cost: null, price_usd: null, indoor: null,
  opening_hours: null, start_time: null, end_time: null, rrule: null, exdates: null,
  photo_url: null, photo_attribution: null, website: null, source_url: 's', source_type: 'manual', confidence: 'high',
  status: 'approved', last_verified: '2026-01-01', created_at: '2026-01-01', updated_at: '2026-01-01',
  crops: null, crops_state: null, in_season_now: null,
  region: 'bay', city: null, attributes: null, slug: null, has_playground: null, name_zh: null,
}
const makePlace = (id: string, cat: Item['category'], o: Partial<Item> = {}): Item =>
  ({ ...base, id, name: id, category: cat, ...o } as Item)

describe('applyFilters', () => {
  const items = [
    makePlace('pg', 'playground', { indoor: 0, cost: 'free' }),
    makePlace('m', 'museum', { indoor: 1, cost: 'paid' }),
    makePlace('lib', 'library', { indoor: 1, cost: 'free' }),
  ]

  it('shows all with defaults', () => {
    expect(applyFilters(items, DEFAULT_FILTERS).length).toBe(3)
  })

  it('filters by category', () => {
    const f = { ...DEFAULT_FILTERS, categories: new Set(['museum' as const]) }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['m'])
  })

  // #220: the Playground chip also matches a park with an on-site playground
  // that was never separately mapped as its own leisure=playground node.
  it('filters by category: playground chip also matches a flagged park', () => {
    const withParks = [
      ...items,
      makePlace('park-flagged', 'park', { has_playground: 1 }),
      makePlace('park-plain', 'park', { has_playground: null }),
    ]
    const f = { ...DEFAULT_FILTERS, categories: new Set(['playground' as const]) }
    expect(applyFilters(withParks, f).map(i => i.id).sort()).toEqual(['park-flagged', 'pg'])
  })

  it('filters freeOnly', () => {
    const f = { ...DEFAULT_FILTERS, freeOnly: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['pg', 'lib'])
  })

  it('filters indoorOnly', () => {
    const f = { ...DEFAULT_FILTERS, indoorOnly: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['m', 'lib'])
  })

  // Fixed clock for every time-window test below. Real `new Date()` made
  // these tests expire when their hardcoded fixture windows passed
  // (2026-07-16: the farm window ending 2026-07-15 turned CI red).
  const NOW = new Date('2026-04-23T12:00:00')

  it('gates type="place" by start/end when time chip is active', () => {
    // Farm whose window is 2026-04-01 → 2026-07-15. With today = 2026-04-23,
    // the "today" chip should keep it.
    const farm = makePlace('farm', 'upick', {
      type: 'place',
      start_time: '2026-04-01T00:00:00Z',
      end_time: '2026-07-15T23:59:59Z',
    })
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([farm], f, NOW).map(i => i.id)).toEqual(['farm'])
  })

  it('filters type="place" out when start/end do not overlap time chip', () => {
    const farm = makePlace('farm', 'upick', {
      type: 'place',
      start_time: '2027-04-01T00:00:00Z',
      end_time: '2027-07-15T23:59:59Z',
    })
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([farm], f, NOW)).toEqual([])
  })

  it('keeps a start-only event whose start falls inside the time window', () => {
    // LLM-routine extracts often emit start_time + null end_time for one-off
    // events (see runArchiveExpired docs). These must not vanish under a
    // time chip.
    const ev = makePlace('ev', 'event', {
      type: 'event',
      start_time: '2026-04-23T15:00:00',
    })
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], f, NOW).map(i => i.id)).toEqual(['ev'])
  })

  it('hides a start-only event whose start falls outside the time window', () => {
    const ev = makePlace('ev', 'event', {
      type: 'event',
      start_time: '2026-04-24T15:00:00',
    })
    const today = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], today, NOW)).toEqual([])
    // Same event is inside the two-week window.
    const twoweeks = { ...DEFAULT_FILTERS, timeWindow: 'twoweeks' as const }
    expect(applyFilters([ev], twoweeks, NOW).map(i => i.id)).toEqual(['ev'])
  })

  it('keeps a start-only place that has already opened', () => {
    // A place with an opening date but no end (open-ended season) stays
    // visible once opened; one that opens after the window is hidden.
    const open = makePlace('open', 'upick', {
      type: 'place',
      start_time: '2026-04-01T00:00:00',
    })
    const notYet = makePlace('not-yet', 'upick', {
      type: 'place',
      start_time: '2026-06-01T00:00:00',
    })
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([open, notYet], f, NOW).map(i => i.id)).toEqual(['open'])
  })

  it('leaves type="place" without start/end untouched by time chip', () => {
    // Regression guard: parks with no start_time stay permanent.
    const park = makePlace('p', 'park', { type: 'place' })
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([park], f).map(i => i.id)).toEqual(['p'])
  })

  it('inSeasonNow keeps only upick rows with in_season_now=1', () => {
    const items = [
      makePlace('farm-ripe', 'upick', { in_season_now: 1 }),
      makePlace('farm-dormant', 'upick', { in_season_now: 0 }),
      makePlace('park', 'park', { in_season_now: null }),
    ]
    const f = { ...DEFAULT_FILTERS, inSeasonNow: true }
    expect(applyFilters(items, f).map(i => i.id)).toEqual(['farm-ripe'])
  })

  it('inSeasonNow=false leaves rows unchanged on that axis', () => {
    const items = [
      makePlace('farm-dormant', 'upick', { in_season_now: 0 }),
      makePlace('park', 'park', { in_season_now: null }),
    ]
    const f = { ...DEFAULT_FILTERS, inSeasonNow: false }
    expect(applyFilters(items, f).length).toBe(2)
  })

  // ── Venue-timezone regression cases (national metros) ────────────────
  // Time windows must be the VENUE's calendar day, not the runner's/
  // viewer's. Every case below pins `now` as a real instant, so the
  // expected outcome is identical in any runner zone.

  it('keeps a late-evening New York event under "today" on its NY day', () => {
    // Sat Apr 25, 9–11 PM in Manhattan = 01:00–03:00 UTC on Apr 26. A
    // viewer-zone window (the pre-fix behavior) drops it to the wrong day
    // for every viewer west of (or at) UTC.
    const ev = makePlace('nyc-ev', 'event', {
      type: 'event',
      lat: 40.72, lng: -73.98,
      start_time: '2026-04-25T21:00:00-04:00',
      end_time: '2026-04-25T23:00:00-04:00',
    })
    // "now" = Sat Apr 25, 7:30 PM in New York.
    const nowNy = new Date('2026-04-25T23:30:00Z')
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], f, nowNy).map(i => i.id)).toEqual(['nyc-ev'])
  })

  it('keeps a bare-date Bay event on its venue day, late into the evening', () => {
    // `2026-04-23` parsed with plain `new Date()` is UTC midnight — the
    // previous Bay evening. At 9 PM Pacific on Apr 23 the event must still
    // count as "today".
    const ev = makePlace('allday', 'event', {
      type: 'event',
      lat: 37.77, lng: -122.42,
      start_time: '2026-04-23',
    })
    const nowLatePt = new Date('2026-04-24T04:00:00Z') // Apr 23, 9 PM PDT
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], f, nowLatePt).map(i => i.id)).toEqual(['allday'])
  })

  it('a bare-date end_time runs through its whole final venue day', () => {
    const ev = makePlace('window', 'event', {
      type: 'event',
      lat: 37.77, lng: -122.42,
      start_time: '2026-04-01',
      end_time: '2026-04-23',
    })
    const nowLatePt = new Date('2026-04-24T04:00:00Z') // Apr 23, 9 PM PDT
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], f, nowLatePt).map(i => i.id)).toEqual(['window'])
  })

  it('hides a New York event from NY "today" once its NY day has passed', () => {
    const ev = makePlace('nyc-old', 'event', {
      type: 'event',
      lat: 40.72, lng: -73.98,
      start_time: '2026-04-24T21:00:00-04:00',
      end_time: '2026-04-24T23:00:00-04:00',
    })
    const nowNy = new Date('2026-04-25T23:30:00Z') // Sat Apr 25, 7:30 PM ET
    const f = { ...DEFAULT_FILTERS, timeWindow: 'today' as const }
    expect(applyFilters([ev], f, nowNy)).toEqual([])
  })

  it('recurring NY series is gated on NY weekdays', () => {
    // Every Saturday 10 AM in New York. "now" = Fri Apr 24, 10 PM ET
    // (= Sat 02:00 UTC — a viewer-zone weekend/today window would already
    // call this Saturday). NY "today" is still Friday → hidden; NY
    // "weekend" (tomorrow) → visible.
    const ev = makePlace('nyc-storytime', 'event', {
      type: 'event',
      lat: 40.72, lng: -73.98,
      start_time: '2026-04-04T10:00:00-04:00',
      rrule: 'FREQ=WEEKLY;BYDAY=SA',
    })
    const nowFriNight = new Date('2026-04-25T02:00:00Z')
    expect(applyFilters([ev], { ...DEFAULT_FILTERS, timeWindow: 'today' as const }, nowFriNight)).toEqual([])
    expect(
      applyFilters([ev], { ...DEFAULT_FILTERS, timeWindow: 'weekend' as const }, nowFriNight).map(i => i.id),
    ).toEqual(['nyc-storytime'])
  })

  // ── "Open now" ('now') ────────────────────────────────────────────────
  // Stricter than Today/Weekend: a point-in-time check. Rows whose duration
  // isn't knowable from start/end are excluded rather than guessed at.

  describe('timeWindow "now"', () => {
    const nowChip = { ...DEFAULT_FILTERS, timeWindow: 'now' as const }

    it('leaves a permanent venue (no start/end/rrule) untouched', () => {
      const park = makePlace('p', 'park', { type: 'place' })
      expect(applyFilters([park], nowChip).map(i => i.id)).toEqual(['p'])
    })

    it('shows a timed event only while it is actually in progress', () => {
      // start/end are naive strings — taken directly as Bay Area (PDT,
      // UTC-7) wall clock. `now` must be passed as the matching real
      // instant so wallNow's real→venue-wall conversion lines up: 14:00
      // PDT = 21:00Z.
      const ev = makePlace('ev', 'event', {
        type: 'event',
        start_time: '2026-04-23T14:00:00',
        end_time: '2026-04-23T16:00:00',
      })
      expect(applyFilters([ev], nowChip, new Date('2026-04-23T20:00:00Z')).map(i => i.id)).toEqual([])
      expect(applyFilters([ev], nowChip, new Date('2026-04-23T22:00:00Z')).map(i => i.id)).toEqual(['ev'])
      expect(applyFilters([ev], nowChip, new Date('2026-04-23T23:30:00Z')).map(i => i.id)).toEqual([])
    })

    it('hides a one-off, clock-time start with no end/duration data', () => {
      const ev = makePlace('ev', 'event', { type: 'event', start_time: '2026-04-23T14:00:00' })
      // Even checked at the exact start minute, no end is knowable, so we
      // don't claim to know it's still open — the honest default is hidden.
      expect(applyFilters([ev], nowChip, new Date('2026-04-23T21:00:00Z'))).toEqual([])
    })

    it('shows a bare-date (all-day) event for its whole venue day', () => {
      const ev = makePlace('allday', 'event', { type: 'event', lat: 37.77, lng: -122.42, start_time: '2026-04-23' })
      expect(applyFilters([ev], nowChip, new Date('2026-04-23T23:00:00-07:00')).map(i => i.id)).toEqual(['allday'])
      expect(applyFilters([ev], nowChip, new Date('2026-04-24T04:00:00-07:00'))).toEqual([])
    })

    it('shows an open-ended season place once opened, regardless of time of day', () => {
      const open = makePlace('open', 'upick', { type: 'place', start_time: '2026-04-01T00:00:00' })
      const notYet = makePlace('not-yet', 'upick', { type: 'place', start_time: '2026-06-01T00:00:00' })
      expect(applyFilters([open, notYet], nowChip, new Date('2026-04-23T12:00:00')).map(i => i.id)).toEqual(['open'])
    })

    it('recurring series: open only inside today\'s occurrence window, derived from its own start/end', () => {
      const ev = makePlace('storytime', 'event', {
        type: 'event',
        start_time: '2026-04-04T10:00:00-07:00',
        end_time: '2026-04-04T11:00:00-07:00', // 1-hour duration, reused for every occurrence
        rrule: 'FREQ=WEEKLY;BYDAY=SA',
      })
      // Sat Apr 25 10:30 AM PT — inside the 10-11 AM window.
      expect(applyFilters([ev], nowChip, new Date('2026-04-25T17:30:00Z')).map(i => i.id)).toEqual(['storytime'])
      // Sat Apr 25 11:30 AM PT — after the window closes.
      expect(applyFilters([ev], nowChip, new Date('2026-04-25T18:30:00Z'))).toEqual([])
      // Friday — no occurrence that day at all.
      expect(applyFilters([ev], nowChip, new Date('2026-04-24T17:30:00Z'))).toEqual([])
    })

    it('hides a recurring series with no end_time — duration is not knowable', () => {
      const ev = makePlace('storytime', 'event', {
        type: 'event',
        start_time: '2026-04-04T10:00:00-07:00',
        rrule: 'FREQ=WEEKLY;BYDAY=SA',
      })
      expect(applyFilters([ev], nowChip, new Date('2026-04-25T17:30:00Z'))).toEqual([])
    })
  })

  // #647: closure entries and over/dateless events are hidden EVERYWHERE —
  // with no time filter active, not just under a time chip.
  describe('always-on event visibility (#647)', () => {
    const NOW647 = new Date('2026-08-25T12:00:00-07:00')
    const noFilters = DEFAULT_FILTERS // no time window selected

    it('hides holiday-closure calendar entries by name', () => {
      const closure = makePlace('closed-xmas', 'event', { type: 'event', name: 'Closed December 25', start_time: '2026-12-25' })
      const closing = makePlace('closing-party', 'event', { type: 'event', name: 'Season Closing Party', start_time: '2026-12-20T10:00:00-08:00' })
      expect(applyFilters([closure, closing], noFilters, NOW647).map(i => i.id)).toEqual(['closing-party'])
    })

    it('hides a past one-off event with no time filter active (the 2025 Fourth of July case)', () => {
      const past = makePlace('july-2025', 'event', { type: 'event', start_time: '2025-07-04T10:00:00-07:00' })
      const future = makePlace('sept-fair', 'event', { type: 'event', start_time: '2026-09-05T10:00:00-07:00' })
      expect(applyFilters([past, future], noFilters, NOW647).map(i => i.id)).toEqual(['sept-fair'])
    })

    it('keeps an event happening later TODAY (day granularity, matching the archive cron)', () => {
      const today = makePlace('tonight', 'event', { type: 'event', start_time: '2026-08-25T19:00:00-07:00' })
      expect(applyFilters([today], noFilters, NOW647).map(i => i.id)).toEqual(['tonight'])
    })

    it('hides a dateless type=event row but keeps a dateless venue in the event category', () => {
      const dateless = makePlace('mystery-event', 'event', { type: 'event' })
      const venue = makePlace('event-center', 'event', { type: 'place' })
      expect(applyFilters([dateless, venue], noFilters, NOW647).map(i => i.id)).toEqual(['event-center'])
    })

    it('recurring: open-ended series stays; past UNTIL= hides', () => {
      const openEnded = makePlace('weekly', 'event', { type: 'event', start_time: '2025-01-04T10:00:00-08:00', rrule: 'FREQ=WEEKLY;BYDAY=SA' })
      const exhausted = makePlace('spring-series', 'event', { type: 'event', start_time: '2026-03-07T10:00:00-08:00', rrule: 'FREQ=WEEKLY;BYDAY=SA;UNTIL=20260530T170000Z' })
      expect(applyFilters([openEnded, exhausted], noFilters, NOW647).map(i => i.id)).toEqual(['weekly'])
    })
  })
})
