import type { ListItem, Filters } from '@shared/types'
import { isClosureEventName } from '@shared/closureEvents'
import { todayRange, weekendRange, nextTwoWeeksRange, overlaps, type TimeRange } from './time'
import { nextOccurrences } from './rrule'
import { haversineMiles } from './distance'
import { parseEventTime, venueTimezone, wallEndExclusive, wallNow } from './venueTime'

// Venue-local calendar day as a comparable number (20260825). Day
// granularity on purpose — matching runArchiveExpired's "yesterday's event
// is over" semantics, so an event later today never reads as expired.
function wallDayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/**
 * Always-on visibility for dated event rows (#647) — the timeWindow branch
 * below only runs when a time filter is ACTIVE, so with no filter selected a
 * 2025 one-off, a dateless event, and a "Closed December 25" library-closure
 * entry all reached the map, the list and the event chip. The archive cron
 * (worker runArchiveExpired) is the durable fix for dated rows; this is the
 * client-side defense that also covers rows the cron cannot judge.
 *
 * Scope is `type === 'event'` — venue rows in the event CATEGORY
 * (type='place', e.g. "San Mateo County Event Center") are legitimately
 * dateless and stay. Recurring rows expire only on a past `UNTIL=` (an
 * open-ended series is still generating dates), mirroring the cron.
 */
function eventStillRelevant<T extends ListItem>(item: T, now: Date): boolean {
  if (item.type !== 'event') return true
  if (item.rrule) {
    const until = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(item.rrule)
    if (!until) return true
    const tz = venueTimezone(item.lat, item.lng)
    const untilDay = Number(until[1]) * 10000 + Number(until[2]) * 100 + Number(until[3])
    return untilDay >= wallDayNumber(wallNow(tz, now))
  }
  if (!item.start_time && !item.end_time) return false // dateless event — unusable to a parent
  const tz = venueTimezone(item.lat, item.lng)
  const last = parseEventTime(item.end_time ?? item.start_time!, tz)
  if (!last) return true // unparseable date — leave visibility to the curator, not a guess
  return wallDayNumber(last.wall) >= wallDayNumber(wallNow(tz, now))
}

// "Open now" ('now' timeWindow) answers a stricter question than Today/
// Weekend/2-weeks — not "does this occur on the right calendar day" but "is
// it happening at this exact instant." We don't invent a duration where the
// data doesn't carry one: a dated row only counts as open-now when its
// start/end (or, for a permanently-open venue, its lack of any) genuinely
// supports the answer. Rows with a known start but no known end/duration are
// excluded rather than guessed at — closed-when-we-said-open is the failure
// mode to avoid here (same doctrine as the U-Pick verification routine).
function isOpenNow<T extends ListItem>(item: T, tz: string | undefined, base: Date): boolean {
  if (item.rrule) {
    // Does a recurrence land on the venue's calendar today? If so, use the
    // series' own start/end time-of-day as today's occurrence window —
    // reusing the exact fields the popup already renders ("Every Saturdays
    // at 1:00 PM"), not an invented duration.
    const day = todayRange(base)
    const occs = nextOccurrences(item.rrule, item.start_time, item.exdates, day, 1, tz)
    if (!occs.length) return false
    const occStart = occs[0]
    if (!item.end_time) return false // no known duration — can't safely claim still open
    const start = item.start_time ? parseEventTime(item.start_time, tz) : null
    const end = parseEventTime(item.end_time, tz)
    if (!start || !end || start.dateOnly || end.dateOnly) return false
    const durationMs = wallEndExclusive(end).getTime() - start.wall.getTime()
    if (durationMs <= 0) return false
    const occEnd = new Date(occStart.getTime() + durationMs)
    return occStart <= base && base < occEnd
  }
  if (item.start_time && item.end_time) {
    const start = parseEventTime(item.start_time, tz)
    const end = parseEventTime(item.end_time, tz)
    if (!start || !end) return false
    return start.wall <= base && base < wallEndExclusive(end)
  }
  if (item.start_time) {
    const start = parseEventTime(item.start_time, tz)
    if (!start) return false
    if (item.type === 'place') return start.wall <= base // opened, no known close — season/window rows
    if (start.dateOnly) return start.wall <= base && base < wallEndExclusive(start) // all-day: open all day
    return false // one-off clock-time start with no end/duration — can't safely claim still open
  }
  return false // event/dated row with no dates at all
}

/**
 * Does an item satisfy the category chip selection?
 *
 * A plain `categories.has(item.category)` misses the real-world case #220
 * fixes: a neighborhood park with an on-site playground that was never
 * separately OSM-tagged `leisure=playground`, so it has no standalone
 * playground pin to filter for. Checking "Playground" now ALSO matches a
 * `category='park'` row flagged `has_playground=1` — an attribute of that
 * park, not a second legend category (the legend/pin styling is untouched;
 * this only widens which rows the Playground chip includes).
 */
function matchesCategoryFilter(item: ListItem, categories: Filters['categories']): boolean {
  if (categories.has(item.category)) return true
  return categories.has('playground') && item.category === 'park' && item.has_playground === 1
}

// Generic over the specific shape of items so both full `Item` (admin
// contexts) and redacted `ListItem` (public list payload) can flow through
// the same filter pipeline. All fields referenced below exist on both.
//
// `now` is injectable so tests can pin the clock — the time-window ranges
// are otherwise computed from the real current date.
export function applyFilters<T extends ListItem>(items: T[], filters: Filters, now: Date = new Date()): T[] {
  // Time windows are computed in each item's VENUE zone, not the viewer's:
  // "Today" for a New York storytime means New York's today, whatever the
  // browser's clock says. Ranges are cached per zone — a pass touches at
  // most a handful of zones, and every wall-clock conversion inside runs
  // per dated item.
  const rangeByTz = new Map<string, TimeRange>()
  const rangeFor = (tz: string | undefined): TimeRange => {
    const key = tz ?? ''
    let range = rangeByTz.get(key)
    if (!range) {
      const base = wallNow(tz, now)
      range = filters.timeWindow === 'today' ? todayRange(base)
        : filters.timeWindow === 'weekend' ? weekendRange(base)
        : nextTwoWeeksRange(base)
      rangeByTz.set(key, range)
    }
    return range
  }

  return items.filter((item) => {
    // #647: closure calendar entries and over/dateless events never show,
    // whatever the filter state — see isClosureEventName / eventStillRelevant.
    if ((item.type === 'event' || item.category === 'event') && isClosureEventName(item.name)) return false
    if (!eventStillRelevant(item, now)) return false
    if (filters.categories.size > 0 && !matchesCategoryFilter(item, filters.categories)) return false
    if (filters.freeOnly && item.cost !== 'free') return false
    if (filters.indoorOnly && item.indoor !== 1) return false
    if (filters.outdoorOnly && item.indoor !== 0) return false
    if (
      (item.age_min != null && item.age_min > filters.ageMax) ||
      (item.age_max != null && item.age_max < filters.ageMin)
    ) return false
    if (filters.inSeasonNow && !(item.category === 'upick' && item.in_season_now === 1)) {
      return false
    }
    if (filters.timeWindow) {
      // type='place' with NO start/end and no rrule: permanent venue, always
      // shows (playgrounds, parks, libraries). type='place' WITH start/end
      // (upick farms w/ seasonal open window): gate on window overlap.
      if (item.type === 'place' && !item.rrule && !item.start_time) {
        // permanent — always shows (and skips the per-item zone lookup:
        // the vast majority of rows take this branch)
      } else if (filters.timeWindow === 'now') {
        // Point-in-time check — orthogonal to the range-based branches
        // below, which answer "does this occur on the right calendar day."
        const tz = venueTimezone(item.lat, item.lng)
        if (!isOpenNow(item, tz, wallNow(tz, now))) return false
      } else {
        const tz = venueTimezone(item.lat, item.lng)
        const range = rangeFor(tz)
        if (item.rrule) {
          // RRULE is checked BEFORE the start/end branch. It used to come after,
          // so any recurring row that ALSO carried start_time+end_time — 291 of
          // the 320 recurring rows in current data — was filtered as a one-off
          // occupying only its first occurrence's 1-4 hour window. A weekly
          // storytime vanished from "Today" on the very day it runs, while its
          // own popup still read "Every Saturdays at 1:00 PM".
          const occs = nextOccurrences(item.rrule, item.start_time, item.exdates, range, 1, tz)
          if (!occs.length) return false
        } else if (item.start_time && item.end_time) {
          const start = parseEventTime(item.start_time, tz)
          const end = parseEventTime(item.end_time, tz)
          if (!start || !end) return false
          if (!overlaps(range, start.wall, wallEndExclusive(end))) return false
        } else if (item.start_time) {
          // start_time with no end_time and no rrule. LLM-routine extracts
          // often emit this shape for one-off events (see runArchiveExpired) —
          // treat the event as occurring at its start. A place with only an
          // opening date (open-ended season) shows once opened. A bare-date
          // start occupies its whole venue day, so the window check uses
          // [wall, endExclusive) overlap rather than the instant.
          const start = parseEventTime(item.start_time, tz)
          if (!start) return false
          if (item.type === 'place') {
            if (start.wall >= range.end) return false
          } else if (start.dateOnly) {
            // A bare-date start occupies its whole venue day.
            if (!overlaps(range, start.wall, wallEndExclusive(start))) return false
          } else if (start.wall < range.start || start.wall >= range.end) {
            return false
          }
        } else {
          return false  // event with no dates — hide when a time filter is active
        }
      }
    }
    if (filters.nearbyCenter) {
      const d = haversineMiles(filters.nearbyCenter, [item.lng, item.lat])
      if (d > filters.nearbyRadiusMiles) return false
    }
    return true
  })
}
