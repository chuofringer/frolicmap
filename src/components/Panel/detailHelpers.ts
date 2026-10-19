import { i18next, intlLocale } from '@/i18n'
import { haversineMiles } from '@/utils/distance'
import { parseRrule } from '@/utils/rrule'
import {
  isAllDayStart,
  parseEventTime,
  viewerTimezone,
  wallEndExclusive,
  wallNow,
  zoneAbbreviation,
  type ParsedEventTime,
} from '@/utils/venueTime'

// Indexed by parseRrule's day numbers (0 = Sunday). Each locale's `time.days`
// entries own their own plural/singular convention (English pluralises,
// Chinese doesn't).
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function dayName(day: number): string {
  return i18next.t(`time.days.${DAY_KEYS[day]}`)
}

// Not a module-scope constant — computed per call so a locale switch (full
// page reload, but still) and every render pick up the live translation.
function ordinal(nth: number): string {
  if (nth === -1) return i18next.t('time.ordinal.last')
  if (nth < 0) return i18next.t('time.ordinal.toLast', { ordinal: ordinal(-nth) })
  if (nth === 1) return i18next.t('time.ordinal.first')
  if (nth === 2) return i18next.t('time.ordinal.second')
  if (nth === 3) return i18next.t('time.ordinal.third')
  return i18next.t('time.ordinal.nth', { n: nth })
}

/** "2nd, 4th Sundays" / "Saturdays" from parseRrule's byday entries. */
function bydayLabel(byday: { day: number; nth: number }[]): string | null {
  if (!byday.length) return null
  return byday
    .map(({ day, nth }) =>
      nth === 0 ? dayName(day) : i18next.t('time.bydayWithOrdinal', { ordinal: ordinal(nth), day: dayName(day) }),
    )
    .join(i18next.t('time.bydaySeparator'))
}

/**
 * Zone suffix for displayed clock times (" PDT", " EST"). Only rendered
 * when the venue's zone is known, differs from the viewer's, and the
 * stored value pins a real instant — a viewer at home sees plain venue
 * times, a viewer browsing another metro sees which clock they're reading.
 */
function tzSuffix(p: ParsedEventTime | null, tz: string | null | undefined): string {
  if (!p?.instant || !tz || tz === viewerTimezone()) return ''
  const abbrev = zoneAbbreviation(p.instant, tz)
  return abbrev ? ` ${abbrev}` : ''
}

/**
 * Human timing string for the event WHEN box, in the VENUE's wall clock —
 * `tz` is the item's metro zone (see `venueTimezone`). Every stored shape
 * (venue-offset ISO, true-UTC instant, naive local, bare date) renders as
 * the clock on the venue's wall; bare dates render with no clock time at
 * all. This is now the only copy — `ItemPopup.tsx` carried a duplicate under
 * a lockstep contract until #484 deleted it.
 */
export function formatEventTiming(
  startIso: string | null,
  endIso: string | null,
  rrule: string | null,
  tz: string | null | undefined = null,
): string {
  const locale = intlLocale()
  const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

  if (rrule) {
    // parseRrule handles ordinal BYDAY ("2SA", "-1SU") — the old local
    // `/BYDAY=([A-Z,]+)/` regex silently failed on the leading digit and
    // demoted those rows to a generic "Recurring" (the same bug rrule.ts
    // fixed for filtering; the display copy had kept the old pattern).
    const p = parseRrule(rrule)
    // BYSETPOS picks specific ordinal occurrences out of the month's BYDAY
    // set ("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2,4" = 2nd & 4th Sunday) — until
    // #421 this was ignored entirely, so that rule rendered as "Monthly on
    // Sundays" and a parent showed up on the 1st Sunday, when the venue was
    // closed. Only honestly renderable when there is exactly one BYDAY
    // weekday to apply the ordinals to; a BYSETPOS stacked on multiple
    // weekdays (or on an already-ordinal BYDAY) doesn't reduce to a fixed
    // day of week, so it falls through to the generic "Recurring" phrasing
    // below rather than stating a day that isn't actually fixed. Non-MONTHLY
    // freqs keep their plain weekday label: the expansion engine ignores
    // BYSETPOS outside MONTHLY, so a vestigial one must not demote the copy.
    const singleDayBysetpos = p.freq === 'MONTHLY' && p.bysetpos.length > 0
      && p.byday.length === 1 && p.byday[0].nth === 0
    // Occurrence order, not token order: positives ascending (2nd, 4th),
    // then negatives ascending (2nd-to-last, last) — matches the order the
    // expansion engine emits the dates in.
    const orderedBysetpos = [...p.bysetpos].sort((a, b) =>
      a > 0 && b > 0 ? a - b : a < 0 && b < 0 ? a - b : a < 0 ? 1 : -1)
    const days = singleDayBysetpos
      ? bydayLabel(orderedBysetpos.map((pos) => ({ day: p.byday[0].day, nth: pos })))
      : p.freq === 'MONTHLY' && p.bysetpos.length > 0 ? null : bydayLabel(p.byday)
    const start = startIso ? parseEventTime(startIso, tz) : null
    const end = endIso ? parseEventTime(endIso, tz) : null
    const time = start && !start.dateOnly && !isAllDayStart(start, end)
      ? start.wall.toLocaleTimeString(locale, timeOpts) + tzSuffix(start, tz)
      : null
    if (p.freq === 'WEEKLY' && days) {
      if (p.interval === 2) {
        return time
          ? i18next.t('time.recurrence.weeklyEveryOtherAt', { days, time })
          : i18next.t('time.recurrence.weeklyEveryOther', { days })
      }
      if (p.interval > 2) {
        return time
          ? i18next.t('time.recurrence.weeklyEveryNAt', { n: p.interval, days, time })
          : i18next.t('time.recurrence.weeklyEveryN', { n: p.interval, days })
      }
      return time
        ? i18next.t('time.recurrence.weeklyAt', { days, time })
        : i18next.t('time.recurrence.weekly', { days })
    }
    if (p.freq === 'MONTHLY' && days) {
      return time
        ? i18next.t('time.recurrence.monthlyAt', { days, time })
        : i18next.t('time.recurrence.monthly', { days })
    }
    if (days) {
      return time
        ? i18next.t('time.recurrence.recurringWithDaysAt', { days, time })
        : i18next.t('time.recurrence.recurringWithDays', { days })
    }
    return time
      ? i18next.t('time.recurrence.recurringAt', { time })
      : i18next.t('time.recurrence.recurring')
  }

  if (!startIso) return ''
  const start = parseEventTime(startIso, tz)
  if (!start) return ''
  const end = endIso ? parseEventTime(endIso, tz) : null
  const sameDay = end && start.wall.toDateString() === end.wall.toDateString()

  if (!end) {
    if (start.dateOnly || isAllDayStart(start, null)) return start.wall.toLocaleDateString(locale, dateOpts)
    return start.wall.toLocaleDateString(locale, dateOpts)
      + ' · ' + start.wall.toLocaleTimeString(locale, timeOpts) + tzSuffix(start, tz)
  }
  if (sameDay) {
    if (start.dateOnly || end.dateOnly || isAllDayStart(start, end)) return start.wall.toLocaleDateString(locale, dateOpts)
    return `${start.wall.toLocaleDateString(locale, dateOpts)} · ${start.wall.toLocaleTimeString(locale, timeOpts)} – ${end.wall.toLocaleTimeString(locale, timeOpts)}${tzSuffix(end, tz)}`
  }
  const now = wallNow(tz)
  const multiDay = `${start.wall.toLocaleDateString(locale, dateOpts)} – ${end.wall.toLocaleDateString(locale, dateOpts)}`
  return start.wall <= now && now <= wallEndExclusive(end) ? `${i18next.t('time.ongoing')} · ${multiDay}` : multiDay
}

/**
 * Sibling "Upcoming dates" chip label, e.g. "Sat, Apr 12 · 1pm", in the
 * venue's wall clock. Bare-date rows render the date alone.
 */
export function formatSiblingChip(
  startIso: string,
  tz: string | null | undefined = null,
  endIso: string | null | undefined = null,
): string {
  const p = parseEventTime(startIso, tz)
  if (!p) return ''
  const locale = intlLocale()
  const date = p.wall.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
  if (p.dateOnly || isAllDayStart(p, endIso ? parseEventTime(endIso, tz) : null)) return date
  const rawTime = p.wall.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  // The ":00" / space / case surgery below turns "1:00 PM" into "1pm" — a
  // compaction that only makes sense for English clock conventions. Chinese
  // (and every other non-English locale) gets the plain Intl output with no
  // surgery.
  const time = (i18next.resolvedLanguage ?? 'en') === 'en'
    ? rawTime.replace(':00', '').replace(' ', '').toLowerCase()
    : rawTime
  return `${date} · ${time}`
}

/**
 * "X.X mi from you" — the distance from the device's Near-me origin to a
 * point, or null when there is no such origin.
 *
 * The bare "X.X mi" this replaced was the single most-asked question about
 * the panel ("from where?"). This helper used to also render "X.X mi from
 * map center" for the map-origin case, but that number is meaningless to a
 * parent planning a trip (#645) — the detail surfaces now show the venue's
 * city instead (see `useDetailData`), and this only formats the geo case.
 */
export function formatDistanceMi(
  origin: [number, number] | null,
  lng: number,
  lat: number,
): string | null {
  if (!origin) return null
  const mi = haversineMiles(origin, [lng, lat])
  return i18next.t('detail.distanceMiFromYou', { value: mi.toFixed(1) })
}

export type GoodToKnowFact = { label: string; state: 'yes' | 'partial' }

// Attribute keys we recognise for the "Good to know" grid. NEVER invented —
// a fact renders only when the item's `attributes` JSON actually carries a
// recognised key with a positive/partial value. Unknown keys and negative /
// unparseable values are skipped, and an empty result hides the whole section.
// `labelKey` is resolved through i18next per call (not a module-scope
// constant) so a locale switch is always reflected.
const GOOD_TO_KNOW_FIELDS = [
  { keys: ['restrooms', 'restroom', 'toilets'], labelKey: 'detail.goodToKnowFacts.restrooms' },
  { keys: ['stroller_friendly', 'stroller'], labelKey: 'detail.goodToKnowFacts.strollerFriendly' },
  { keys: ['picnic_tables', 'picnic'], labelKey: 'detail.goodToKnowFacts.picnicTables' },
  { keys: ['shade', 'shaded'], labelKey: 'detail.goodToKnowFacts.shade' },
] as const

function interpretFact(value: unknown): 'yes' | 'partial' | null {
  if (value === true) return 'yes'
  if (typeof value === 'number') return value > 0 ? 'yes' : null
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'yes' || v === 'true' || v === '1' || v === 'available') return 'yes'
    if (v === 'partial' || v === 'limited' || v === 'some') return 'partial'
  }
  return null
}

export function deriveGoodToKnow(attributes: Record<string, unknown> | null | undefined): GoodToKnowFact[] {
  if (!attributes) return []
  const facts: GoodToKnowFact[] = []
  for (const field of GOOD_TO_KNOW_FIELDS) {
    for (const key of field.keys) {
      if (!(key in attributes)) continue
      const state = interpretFact(attributes[key])
      if (state) { facts.push({ label: i18next.t(field.labelKey), state }); break }
    }
  }
  return facts
}

/**
 * Best-effort "Open · until X" parse.
 *
 * Returns the formatted closing time ONLY when `opening_hours` confidently
 * describes a SINGLE daily range AND the current local time falls inside it.
 * Anything with per-day variation, multiple ranges, or an unrecognised shape
 * returns null so the chip is omitted rather than guessed — the design handoff
 * is explicit that this chip appears only on a confident parse.
 */
export function parseOpenUntil(
  openingHours: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!openingHours) return null
  const raw = openingHours.trim()
  if (!raw) return null

  // Strip common "daily" framing so a bare single range remains. Anything with
  // a per-day schedule (e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00") keeps its
  // extra tokens and fails the single-range guard below.
  const stripped = raw
    .replace(/open\s+daily/gi, '')
    .replace(/\bdaily\b/gi, '')
    .replace(/every\s+day/gi, '')
    .replace(/\bmo(n)?\s*[-–]\s*su(n)?\b/gi, '')
    .replace(/\bmon(day)?\s*[-–]\s*sun(day)?\b/gi, '')
    .replace(/[·•]/g, '')
    .trim()

  const nowMin = now.getHours() * 60 + now.getMinutes()

  // 12-hour: "7:00 AM - 6:00 PM" / "7 AM – 6 PM" / "7 AM to 6 PM". The separator
  // is an explicit hyphen/en-dash/em-dash OR the word "to" — not a character
  // class (which would also match stray runs of t/o).
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(stripped)
  if (twelve) {
    const openMin = to24(Number(twelve[1]), Number(twelve[2] ?? 0), twelve[3])
    const closeH = to24h(Number(twelve[4]), twelve[6])
    const closeMin = closeH * 60 + Number(twelve[5] ?? 0)
    return withinNow(openMin, closeMin, nowMin) ? formatClock(closeH, Number(twelve[5] ?? 0)) : null
  }

  // 24-hour: "07:00-18:00"
  const twentyfour = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/.exec(stripped)
  if (twentyfour) {
    const openMin = Number(twentyfour[1]) * 60 + Number(twentyfour[2])
    const closeH = Number(twentyfour[3])
    const closeM = Number(twentyfour[4])
    const closeMin = closeH * 60 + closeM
    return withinNow(openMin, closeMin, nowMin) ? formatClock(closeH, closeM) : null
  }

  return null
}

function to24h(hour12: number, ampm: string): number {
  const pm = ampm.toLowerCase() === 'pm'
  if (hour12 === 12) return pm ? 12 : 0
  return pm ? hour12 + 12 : hour12
}

function to24(hour12: number, minute: number, ampm: string): number {
  return to24h(hour12, ampm) * 60 + minute
}

function withinNow(openMin: number, closeMinRaw: number, nowMin: number): boolean {
  // Spanning-midnight ranges (close <= open) are treated as running into the
  // next day for the comparison.
  const closeMin = closeMinRaw <= openMin ? closeMinRaw + 24 * 60 : closeMinRaw
  const n = nowMin < openMin ? nowMin + 24 * 60 : nowMin
  return n >= openMin && n < closeMin
}

function formatClock(hour24: number, minute: number): string {
  const d = new Date()
  d.setHours(hour24, minute, 0, 0)
  return d.toLocaleTimeString(intlLocale(), minute === 0
    ? { hour: 'numeric' }
    : { hour: 'numeric', minute: '2-digit' })
}

// Data-catalog sources whose `source_url` points at the dataset record
// (openstreetmap.org, imls.gov, tpl.org/parkserve) rather than the venue's
// own site — never promote those into the Website button.
const DATA_CATALOG_SOURCES = new Set<string>(['osm', 'imls', 'parkserve'])

/**
 * The Website button's href. Prefers the curated `website`; falls back to
 * `source_url`, which the canonical-source policy requires to be the
 * venue/organizer's own page — aggregator merges don't carry a `website`
 * column at all, so without the fallback those rows show an orange Source
 * link at the panel's foot but no Website button.
 */
export function websiteFor(
  detail: { website: string | null; source_url: string | null; source_type: string } | null | undefined,
): string | null {
  if (!detail) return null
  if (detail.website) return detail.website
  if (DATA_CATALOG_SOURCES.has(detail.source_type)) return null
  return detail.source_url || null
}
