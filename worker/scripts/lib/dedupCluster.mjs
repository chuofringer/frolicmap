// Shared duplicate-cluster heuristic used by:
//   - worker/scripts/merge-aggregators.mjs (in-extract dedup, replaces the
//     pre-#280 exact-name + 80m + exact-start_time isDupe)
//   - worker/scripts/find-duplicate-items.mjs (Tier 1 D1 cleanup, clusters
//     prod rows fetched via cloudflared)
//
// **Why fuzzy**: the prior strict version missed 116 duplicate clusters
// (281 rows, 47% of W17–W19 aggregator extracts). Specific failure modes:
//   - "Stanford Powwow (Friday)" vs "Stanford Powwow (55th Annual)" —
//     exact-equality `norm()` had no overlap.
//   - Same canonical event emitted with 100m+ coord drift across LLM runs
//     (Roundtable Reading at BAMPFA: 110m W17→W18) — beyond the 80m tol.
//   - Multi-day events emitted as N per-day rows with distinct start_times.
//
// **Algorithm** — two rows are "same canonical event" if ALL of:
//   1. start_day matches (YYYY-MM-DD bucket of start_time, OR both have rrule)
//   2. coords within ~500m (LAT_TOL ≈ 0.0045°, LNG_TOL ≈ 0.0057° at lat≈37.5)
//   3. token-set jaccard of normalized names ≥ NAME_JACCARD_MIN (0.5)
//
// Token jaccard with 0.5 threshold accepts:
//   - "Stanford Powwow (Friday)" ↔ "55th Annual Stanford Powwow" → 2/4 = 0.5 ✓
//   - "Slide Ranch Family Farm Day - Mother's Day" ↔
//     "Family Farm Day: Mother's Day" → 6/8 = 0.75 ✓
// And rejects:
//   - "Bug Day" ↔ "Bug Day at Randall Museum" → 2/5 = 0.4 ✗
//     (these ARE the same event but defensive; coord+day still narrow it)
//
// Multi-day events: when two rows have start_times on adjacent days but
// otherwise match, they're TREATED AS DUPLICATES if `allowAdjacentDays`
// is set (catches Stanford Powwow Fri/Sat/Sun). Off by default — caller
// opts in for the merge-time multi-day reconciliation.

// Coord tolerance: ~1.5 km. Wider than first instinct (500m) because LLM
// coord drift between weekly extracts is the dominant duplicate mode (58 of
// 116 clusters in the W17–W19 audit). The Slide Ranch case had 1.28 km
// drift between W18 BAKF and W19 marinmommies rows for the SAME event.
// False-positive risk (collapsing two genuinely distinct same-named events
// 1.5 km apart on the same day) is bounded by:
//   - in-week merge: drops one row from seed, low impact (curator can spot)
//   - cross-week supersede: emits `UPDATE WHERE status='pending'` so any
//     curator-approved row is untouched — false positives no-op
const LAT_TOL = 0.0135    // ~1.5 km
const LNG_TOL = 0.017     // ~1.5 km at lat≈37.5
const NAME_JACCARD_MIN = 0.5
// Issue #519: when the only day-match signal is `allowAdjacentDays` bridging
// two different days (not same-day, not a shared rrule), venue-name tokens
// dominating the jaccard was enough to bridge genuinely different programs
// (a Friday market absorbing a different Saturday market at the same venue).
// Require a much tighter name match in that case.
const NAME_JACCARD_MIN_ADJACENT_DAYS = 0.75

// Issue #570: the same real-world event scraped by 2-3 different aggregators
// sometimes carries dates that drifted further apart than the ±2-day
// `allowAdjacentDays` window (one aggregator had the wrong date). When the
// caller opts in with `crossSourceWideDays`, tolerate up to a week of drift
// — but demand a near-exact name match, since date proximity is no longer
// confirming the pair and coords+day alone are too weak a signal at range.
const CROSS_SOURCE_DAY_TOL = 7
const NAME_JACCARD_MIN_CROSS_SOURCE_WIDE_DAYS = 0.8
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'at', 'in', 'on', 'for',
  'with', 'to', 'by', 'from', '2025', '2026', '2027',
])

// Issue #519: venue/branch name tokens routinely dominate the token set for
// names like "Crafty Crew (Veterans Memorial - St. Cloud Branch)" — the
// parenthesized branch suffix is most of the tokens, so two distinct
// programs at the same branch look near-identical. Strip parenthesized
// suffixes before tokenizing; `nameTokens` still runs on the result.
function stripParens(s) {
  return typeof s === 'string' ? s.replace(/\([^)]*\)/g, ' ') : s
}

export function nameTokens(s) {
  if (typeof s !== 'string') return new Set()
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  return new Set(tokens)
}

// Tokens derived from a street address — used to strip venue-name words
// (e.g. "Marietta Square", "Pike Place") from event names before comparing,
// so two distinct events/programs held at the same venue don't look similar
// just because they both mention the venue.
export function addressTokens(address) {
  if (typeof address !== 'string') return new Set()
  const tokens = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
  return new Set(tokens)
}

// Name tokens for similarity comparison: parenthesized suffixes stripped,
// then any tokens shared with the venue address removed — but only if doing
// so leaves at least one token, so an event whose entire name IS the venue
// name (rare) still compares on its unstripped tokens rather than emptying
// out to a guaranteed non-match.
function comparableNameTokens(row) {
  const base = nameTokens(stripParens(row?.name))
  const venue = addressTokens(row?.address)
  if (!venue.size) return base
  const stripped = new Set([...base].filter((t) => !venue.has(t)))
  return stripped.size ? stripped : base
}

export function tokenJaccard(a, b) {
  if (!a.size || !b.size) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return intersect / (a.size + b.size - intersect)
}

export function dayBucket(startTime) {
  if (typeof startTime !== 'string') return null
  return startTime.slice(0, 10) // YYYY-MM-DD
}

export function coordsClose(a, b) {
  return Math.abs(a.lat - b.lat) <= LAT_TOL && Math.abs(a.lng - b.lng) <= LNG_TOL
}

// Same-day matinee+evening showings (Giselle 2pm + 7pm) are LEGITIMATELY
// distinct events even if name + venue + day match. Threshold for "close
// enough start_time to be a duplicate" — covers minor LLM drift (a few
// minutes) but distinguishes deliberate same-day showings.
const SAME_DAY_MAX_DELTA_MIN = 30

// `a` and `b` are row-shaped objects with at least: name, lat, lng, start_time, rrule.
// Returns true when both are likely the same canonical event.
//
// `crossSourceWideDays` (#570): opt-in for comparing rows known to come from
// different aggregators/weeks, where one source's date may simply be wrong
// (e.g. "2026 Touch-a-Truck SF" posted 09-19 by one aggregator, 09-13 by
// another — 6 days apart, well past `allowAdjacentDays`' ±2-day window).
// Widens the day tolerance to a week but only applies when the name match is
// near-exact, since a wide day window with a loose name bar would swallow
// unrelated events.
export function sameCanonicalEvent(a, b, { allowAdjacentDays = false, crossSourceWideDays = false } = {}) {
  if (!coordsClose(a, b)) return false

  // Day match. Five cases:
  //   - both have rrule → same recurring event ✓
  //   - mixed rrule + explicit start_time → rrule absorbs occurrence (mode D) ✓
  //   - both explicit, same start_day → require start_time within 30 min so
  //     same-day matinee+evening showings stay distinct (e.g. Giselle 2pm/7pm)
  //   - both explicit, adjacent days within 2 days + allowAdjacentDays → ✓
  //     (multi-day events: Stanford Powwow Fri/Sat/Sun)
  //   - both explicit, within a week + crossSourceWideDays → ✓ (name bar raised)
  const aDay = dayBucket(a.start_time)
  const bDay = dayBucket(b.start_time)
  const aRrule = typeof a.rrule === 'string' && a.rrule.length > 0
  const bRrule = typeof b.rrule === 'string' && b.rrule.length > 0
  let dayOk = false
  let viaAdjacentDays = false
  let viaCrossSourceWideDays = false
  if (aRrule && bRrule) {
    // Both recurring — require the rrule strings to match exactly. Otherwise
    // two distinct programs at the same venue (e.g. "Afternoon Art" weekly +
    // "Saturday Science" weekly at Randall Museum) collapse incorrectly.
    if (a.rrule === b.rrule) dayOk = true
  }
  else if (aRrule || bRrule) dayOk = true
  else if (aDay && bDay) {
    if (aDay === bDay) {
      const aMs = Date.parse(a.start_time)
      const bMs = Date.parse(b.start_time)
      if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
        const diffMin = Math.abs(aMs - bMs) / 60000
        if (diffMin <= SAME_DAY_MAX_DELTA_MIN) dayOk = true
      } else {
        dayOk = true   // unparseable timestamps fall back to day-only match
      }
    } else {
      const diffDays = Math.abs((Date.parse(aDay) - Date.parse(bDay)) / 86400000)
      if (allowAdjacentDays && diffDays <= 2) { dayOk = true; viaAdjacentDays = true }
      else if (crossSourceWideDays && diffDays <= CROSS_SOURCE_DAY_TOL) { dayOk = true; viaCrossSourceWideDays = true }
    }
  }
  if (!dayOk) return false

  const jaccardMin = viaCrossSourceWideDays
    ? NAME_JACCARD_MIN_CROSS_SOURCE_WIDE_DAYS
    : viaAdjacentDays
      ? NAME_JACCARD_MIN_ADJACENT_DAYS
      : NAME_JACCARD_MIN
  return tokenJaccard(comparableNameTokens(a), comparableNameTokens(b)) >= jaccardMin
}

// Cluster a set of rows into canonical-event groups. Greedy single-pass —
// good enough for our N≤300 batch sizes; no need for proper hierarchical.
export function clusterRows(rows, opts) {
  const clusters = []
  for (const row of rows) {
    let placed = false
    for (const cluster of clusters) {
      if (sameCanonicalEvent(cluster[0], row, opts)) {
        cluster.push(row)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([row])
  }
  return clusters
}
