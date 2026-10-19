import { i18next, intlLocale } from '@/i18n'
import { haversineMiles } from '@/utils/distance'
import { timezoneForCoords } from '@shared/metros'

/**
 * The current wall clock at a venue, as a `Date` whose LOCAL fields
 * (`getHours()`, `getMinutes()`) read the venue's clock. Falls back to the
 * viewer's clock when the coordinate is outside every metro (no known zone).
 *
 * "Open · until 5 PM" must compare against the VENUE's clock: a museum's 5 PM
 * close is 5 PM on its own wall, not the viewer's.
 */
export function venueWallNow(lat: number, lng: number, now: Date = new Date()): Date {
  const tz = timezoneForCoords(lat, lng)
  if (!tz) return new Date(now)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(now)
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  } catch {
    return new Date(now)
  }
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
