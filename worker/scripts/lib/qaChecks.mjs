/**
 * Per-metro QA checks — issue #357, plan §4A.3.
 *
 * Pure functions over a metro's rows, so the harness can be unit-tested
 * without a database. Each check returns
 * `{ id, label, status: 'pass'|'warn'|'fail', detail, evidence? }`.
 *
 * The gate this backs is deliberate: **a human signs off on the report, not
 * on rows** (plan §4A.3). 50K auto-approved rows can't be reviewed
 * individually, so the harness has to be the thing that catches a bad metro.
 */

/**
 * Minimum rows per category before a metro can publish.
 *
 * Calibrated against what the shipped 12-metro wave actually produced rather
 * than invented: the smallest wave metro (Phoenix) has ~1,000 parks and ~100
 * libraries. A metro materially below these floors means an importer failed
 * for that category, not that the city has no parks.
 *
 * `playground` is deliberately absent. OSM drops ~95% of playgrounds for
 * having no name, so a floor would fail every metro for a known upstream gap
 * rather than a pipeline fault — see #354. Add one once ParkServe's
 * playground layer lands.
 */
export const CATEGORY_FLOORS = {
  park: 300,
  library: 40,
  museum: 15,
}

/** Coordinates that mean "the importer gave up and used the city centre". */
export const CENTROID_TOLERANCE = 0.0001

/** Dedup rate outside this band suggests the matcher is mis-tuned. */
export const DEDUP_RATE_MIN = 0.02
export const DEDUP_RATE_MAX = 0.45

const pass = (id, label, detail, evidence) => ({ id, label, status: 'pass', detail, evidence })
const warn = (id, label, detail, evidence) => ({ id, label, status: 'warn', detail, evidence })
const fail = (id, label, detail, evidence) => ({ id, label, status: 'fail', detail, evidence })

/** Every approved row must sit inside the metro's own bbox. */
export function checkCoordsInBbox(metro, rows) {
  const { south, west, north, east } = metro.contentBbox
  const outside = rows.filter(
    (r) => !(r.lat >= south && r.lat <= north && r.lng >= west && r.lng <= east),
  )
  if (outside.length === 0) {
    return pass('coords-in-bbox', 'Coordinates inside metro bbox', `${rows.length} rows, all inside`)
  }
  return fail(
    'coords-in-bbox', 'Coordinates inside metro bbox',
    `${outside.length} of ${rows.length} rows fall outside the metro bbox`,
    outside.slice(0, 5).map((r) => `${r.id} (${r.lat}, ${r.lng})`),
  )
}

/**
 * Rows piled on a single coordinate — the classic "geocoder returned the city
 * centre" failure that produced 89 rejected rows in the 2026-04 aggregator
 * cleanup. Detected generically (any coordinate carrying an implausible pile
 * of rows) rather than from a hardcoded list, so it works in metros nobody
 * has hand-audited.
 */
export function checkCentroidPileups(metro, rows, { threshold = 15 } = {}) {
  const buckets = new Map()
  for (const r of rows) {
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const piles = [...buckets.entries()].filter(([, n]) => n >= threshold).sort((a, b) => b[1] - a[1])
  if (!piles.length) {
    return pass('centroid-pileup', 'No coordinate pile-ups', `no coordinate carries ${threshold}+ rows`)
  }
  return fail(
    'centroid-pileup', 'No coordinate pile-ups',
    `${piles.length} coordinate(s) carry ${threshold}+ rows — likely a geocoder centroid fallback`,
    piles.slice(0, 5).map(([k, n]) => `${n} rows at ${k}`),
  )
}

/** Per-category row floors. */
export function checkCategoryFloors(metro, rows, floors = CATEGORY_FLOORS) {
  const counts = {}
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1
  const short = Object.entries(floors).filter(([cat, min]) => (counts[cat] ?? 0) < min)
  const summary = Object.entries(floors)
    .map(([cat, min]) => `${cat} ${counts[cat] ?? 0}/${min}`)
    .join(', ')
  if (!short.length) return pass('category-floors', 'Category row floors', summary)
  return fail(
    'category-floors', 'Category row floors',
    `below floor: ${short.map(([c, m]) => `${c} ${counts[c] ?? 0}/${m}`).join(', ')}`,
    [summary],
  )
}

/** Names must exist and be free of the junk that breaks pages downstream. */
export function checkNameQuality(metro, rows) {
  const missing = rows.filter((r) => !r.name || !String(r.name).trim())
  // Embedded newlines/tabs broke a SQL comment during the #355 dedup run and
  // would break page titles and JSON-LD the same way.
  const whitespace = rows.filter((r) => typeof r.name === 'string' && /[\n\r\t]|\s{2,}/.test(r.name))
  if (missing.length) {
    return fail('name-quality', 'Name quality', `${missing.length} rows have no name`,
      missing.slice(0, 5).map((r) => r.id))
  }
  if (whitespace.length) {
    return warn('name-quality', 'Name quality',
      `${whitespace.length} names carry embedded newlines/tabs or double spaces`,
      whitespace.slice(0, 5).map((r) => `${r.id}: ${JSON.stringify(r.name).slice(0, 60)}`))
  }
  return pass('name-quality', 'Name quality', `${rows.length} names clean`)
}

/**
 * Dedup rate sanity. Too low means the matcher isn't finding real overlap
 * between sources; too high means it's collapsing distinct places.
 */
export function checkDedupRate(metro, rows, archivedCount) {
  const total = rows.length + archivedCount
  if (!total) return warn('dedup-rate', 'Dedup rate', 'no rows')
  const rate = archivedCount / total
  const pct = `${(rate * 100).toFixed(1)}%`
  if (rate < DEDUP_RATE_MIN) {
    return warn('dedup-rate', 'Dedup rate', `${pct} — suspiciously low; did the dedup pass run?`)
  }
  if (rate > DEDUP_RATE_MAX) {
    return fail('dedup-rate', 'Dedup rate', `${pct} — above ${DEDUP_RATE_MAX * 100}%, the matcher may be over-merging`)
  }
  return pass('dedup-rate', 'Dedup rate', pct)
}

/**
 * Tier-B coverage. The page generator only gives standalone pages to
 * multi-source-confirmed places, so a metro with almost none produces a
 * near-empty site even when its row count looks healthy.
 */
export function checkTierBCoverage(metro, rows, { minShare = 0.05 } = {}) {
  const tierB = rows.filter((r) => r.confidence === 'high').length
  const share = rows.length ? tierB / rows.length : 0
  const detail = `${tierB} of ${rows.length} (${(share * 100).toFixed(1)}%)`
  if (share < minShare) {
    return warn('tier-b', 'Tier-B coverage', `${detail} — below ${minShare * 100}%; few places will earn a page`)
  }
  return pass('tier-b', 'Tier-B coverage', detail)
}

/** Every row needs a source_url for attribution (ODbL for OSM). */
export function checkAttribution(metro, rows) {
  const missing = rows.filter((r) => !r.source_url)
  if (missing.length) {
    return fail('attribution', 'Source attribution', `${missing.length} rows have no source_url`,
      missing.slice(0, 5).map((r) => r.id))
  }
  return pass('attribution', 'Source attribution', 'every row carries a source_url')
}

/** Page thresholds from plan §3.2: a hub needs ≥50 places, a category page ≥5. */
export function checkPageThresholds(metro, rows, { hubMin = 50, categoryMin = 5 } = {}) {
  if (rows.length < hubMin) {
    return fail('page-thresholds', 'Page thresholds',
      `${rows.length} places — below the ${hubMin} needed for a metro hub page`)
  }
  const counts = {}
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1
  const eligible = Object.entries(counts).filter(([, n]) => n >= categoryMin)
  if (!eligible.length) {
    return fail('page-thresholds', 'Page thresholds', `no category reaches ${categoryMin} places`)
  }
  return pass('page-thresholds', 'Page thresholds',
    `hub ok (${rows.length}), ${eligible.length} category page(s) eligible`)
}

/** Run every check and roll up a verdict. */
export function runQa(metro, rows, { archivedCount = 0, floors } = {}) {
  const checks = [
    checkCoordsInBbox(metro, rows),
    checkCentroidPileups(metro, rows),
    checkCategoryFloors(metro, rows, floors),
    checkNameQuality(metro, rows),
    checkDedupRate(metro, rows, archivedCount),
    checkTierBCoverage(metro, rows),
    checkAttribution(metro, rows),
    checkPageThresholds(metro, rows),
  ]
  const failed = checks.filter((c) => c.status === 'fail')
  const warned = checks.filter((c) => c.status === 'warn')
  return {
    metro: metro.id,
    label: metro.label,
    rows: rows.length,
    checks,
    failed: failed.length,
    warned: warned.length,
    // A warn never blocks: it's information for the human signing the report.
    // Only a fail gates promotion.
    verdict: failed.length ? 'FAIL' : warned.length ? 'PASS (with warnings)' : 'PASS',
    canPublish: failed.length === 0,
  }
}
