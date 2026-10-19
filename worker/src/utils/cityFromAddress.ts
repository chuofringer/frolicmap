/**
 * Best-effort "which city is this in?" from a US postal address string.
 *
 * Why this exists: the `city` column is only populated for the national
 * static-place importers (OSM/IMLS/ParkServe/NPS). Every EVENT ingester —
 * BiblioCommons, the ICS venue feeds, Localist, the LLM extractor — writes
 * `city: null` and folds the city into the free-text `address` instead. The
 * list payload feeds the list + calendar cards, and those cards are exactly
 * where "which town is this in?" matters most, so the list projection falls
 * back to parsing the address rather than shipping a blank for every event.
 *
 * Deliberately conservative: it only trusts the shapes US addresses actually
 * come in, and returns null when it isn't sure. A wrong city is worse than no
 * city — the card omits the segment when this returns null.
 *
 *   "1234 Main St, Alameda, CA 94501"  → "Alameda"
 *   "500 Fulton St, San Francisco, CA" → "San Francisco"
 *   "Palo Alto, CA 94301"              → "Palo Alto"
 *   "Rinconada Library"                → null  (no comma, no state)
 *   "1234 Main St"                     → null
 *
 * NOTE: this never writes back to D1. It's a read-time display fallback, so a
 * misparse can't corrupt the suburb SEO pages (which read `items.city`).
 */

// Two-letter USPS state codes. Matching against the real list (rather than
// /[A-Z]{2}/) keeps things like "1234 Main St, Suite 2B" from reading as a
// state and promoting "Main St" to a city.
const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
])

/**
 * A house-numbered street line: "1234 Main St", "500 Fulton Street".
 *
 * Used as the evidence that a trailing segment is a city rather than a room,
 * wing or building — an address that opens with a house number is a postal
 * address, and postal addresses put the city last.
 */
const STREET_LINE = /^\d+[\w-]*\s+\S/

/** A segment is a plausible city name: letters, not a street line, not a ZIP. */
function looksLikeCity(segment: string): boolean {
  const s = segment.trim()
  if (s.length < 2 || s.length > 40) return false
  if (!/[A-Za-z]/.test(s)) return false
  // Street lines ("1234 Main St"), unit lines ("Suite 200"), bare ZIPs.
  if (/^\d/.test(s)) return false
  if (/^(suite|ste\.?|apt\.?|unit|#|floor|fl\.?|bldg\.?|building)\b/i.test(s)) return false
  // "CA", "USA" and friends are not the city.
  if (STATE_CODES.has(s.toUpperCase())) return false
  if (/^(usa|united states)$/i.test(s)) return false
  return true
}

export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean)
  if (segments.length < 2) return null

  // Find the "CA" / "CA 94501" segment; the city is the segment before it.
  // This is the reliable anchor — everything left of it can be any number of
  // street/unit lines, and everything right of it is ZIP/country noise.
  for (let i = 1; i < segments.length; i++) {
    const m = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(segments[i])
    if (m && STATE_CODES.has(m[1].toUpperCase())) {
      const candidate = segments[i - 1]
      return looksLikeCity(candidate) ? candidate : null
    }
  }

  // No state anchor. Fall back to the last segment ONLY when the segment
  // before it is a real street line — "1234 Main St, Alameda" is a city;
  // "Rinconada Library, Community Room" is a room, and an ICS `LOCATION` is
  // full of exactly that shape. Without this check a room name would render
  // as the city AND (via the neighbour inference in the list projection)
  // become a donor that spreads the bogus label to nearby events.
  const last = segments[segments.length - 1]
  const preceding = segments[segments.length - 2]
  if (!STREET_LINE.test(preceding)) return null
  const zipStripped = last.replace(/\s+\d{5}(?:-\d{4})?$/, '').trim()
  if (looksLikeCity(zipStripped)) return zipStripped
  return null
}
