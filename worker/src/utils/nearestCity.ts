/**
 * Infer a city for a row from the cities of nearby rows that already have one.
 *
 * Why: `cityFromAddress` recovers a city for most events (BiblioCommons and
 * Localist compose "street, city" addresses; the aggregator routines require a
 * real street address), but not all of them — an ICS `LOCATION` is free text
 * and is often just a venue name ("Rinconada Library"), and some BAKF rows
 * carry no address at all. Those events would render as "Event · 3.2 mi" with
 * no sense of place, which is the whole complaint.
 *
 * Every row DOES have coordinates, and the dataset is dense with rows whose
 * city is known (IMLS libraries/museums, NPS parks, OSM rows with an
 * `addr:city` tag, and every event whose address parsed). So a city-less event
 * borrows from its neighbours — the same donor-with-a-radius shape the
 * waterplay naming pass uses (`name-waterplay.mjs`, #461).
 *
 * The vote is deliberately conservative, because a wrong city is worse than
 * none (the card simply omits the segment when this returns null):
 *   - donors must be within `MAX_DONOR_MILES`;
 *   - a single donor inside `TRUST_SINGLE_MILES` is trusted outright (a venue
 *     that close is all but certainly in the same town);
 *   - otherwise the K nearest donors vote, and the winner must be strictly
 *     ahead — a tie near a city boundary yields null rather than a coin flip.
 */

export interface CityDonor {
  lat: number
  lng: number
  city: string
}

/** Donors farther than this never vote. ~city-scale, not metro-scale. */
const MAX_DONOR_MILES = 3
/** A lone donor this close decides on its own. */
const TRUST_SINGLE_MILES = 0.6
/** How many nearest donors take part in the vote. */
const VOTE_K = 5

/** Degrees per grid cell (same size on both axes; the SCAN width is what
 *  varies — see `lookup`). */
const CELL_DEG = 0.05

const MILES_PER_DEG_LAT = 69

const R_MILES = 3958.8
const toRad = (d: number) => (d * Math.PI) / 180

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_MILES * Math.asin(Math.sqrt(s))
}

const cellKey = (lat: number, lng: number) =>
  `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`

/**
 * Spatial index over the donors. Built once per request, then queried per
 * city-less event: a linear scan would be rows × donors (millions of haversines
 * on a big metro), which is not a per-request budget worth spending.
 */
export class CityDonorIndex {
  private cells = new Map<string, CityDonor[]>()
  readonly size: number

  constructor(donors: readonly CityDonor[]) {
    for (const d of donors) {
      const key = cellKey(d.lat, d.lng)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(d)
      else this.cells.set(key, [d])
    }
    this.size = donors.length
  }

  /** The inferred city for a coordinate, or null when the evidence is weak. */
  lookup(lat: number, lng: number): string | null {
    if (this.size === 0) return null

    const near: { city: string; miles: number }[] = []
    const cellLat = Math.floor(lat / CELL_DEG)
    const cellLng = Math.floor(lng / CELL_DEG)
    // A degree of longitude shrinks with latitude — 0.05° is ~2.7 mi at SF and
    // ~2.3 mi at Seattle, so a fixed 3×3 scan would NOT cover the 3-mile
    // radius east/west and would silently drop donors (which can also flip the
    // majority vote). Widen the scan by however many cells the radius actually
    // spans at this latitude. cos() is floored so the poles can't divide by ~0.
    const milesPerDegLng = Math.max(1, MILES_PER_DEG_LAT * Math.cos(toRad(lat)))
    const spanLat = Math.ceil(MAX_DONOR_MILES / (MILES_PER_DEG_LAT * CELL_DEG))
    const spanLng = Math.ceil(MAX_DONOR_MILES / (milesPerDegLng * CELL_DEG))
    for (let dLat = -spanLat; dLat <= spanLat; dLat++) {
      for (let dLng = -spanLng; dLng <= spanLng; dLng++) {
        const bucket = this.cells.get(`${cellLat + dLat}:${cellLng + dLng}`)
        if (!bucket) continue
        for (const d of bucket) {
          const miles = haversineMiles(lat, lng, d.lat, d.lng)
          if (miles <= MAX_DONOR_MILES) near.push({ city: d.city, miles })
        }
      }
    }
    if (near.length === 0) return null

    near.sort((a, b) => a.miles - b.miles)
    if (near[0].miles <= TRUST_SINGLE_MILES) return near[0].city

    const votes = new Map<string, number>()
    for (const n of near.slice(0, VOTE_K)) votes.set(n.city, (votes.get(n.city) ?? 0) + 1)

    let best: string | null = null
    let bestCount = 0
    let tied = false
    for (const [city, count] of votes) {
      if (count > bestCount) { best = city; bestCount = count; tied = false }
      else if (count === bestCount) tied = true
    }
    // A tie means the point sits between towns — say nothing.
    return tied ? null : best
  }
}
