/**
 * Cross-source place dedup + Tier-B computation — issue #355, plan §2.2.
 *
 * Deliberately NOT a new matching engine: the name tokenizer and jaccard score
 * are imported from `dedupCluster.mjs`. What this module adds is the two things
 * place-scale needs:
 *
 *   1. **Spatial binning.** A greedy all-pairs scan is hopeless against 60K
 *      national rows (that's ~1.8 billion comparisons). Grid-binning at ~150 m
 *      makes candidate generation linear.
 *   2. **Place semantics.** Matching is coords + name + category
 *      compatibility.
 */

import { nameTokens, tokenJaccard } from './dedupCluster.mjs'

/**
 * Place-name tokens: `dedupCluster.nameTokens`, with every numeric token
 * restored.
 *
 * That function is a generic title tokenizer, and it discards numbers two ways
 * that are actively wrong for place names:
 *
 *   - **length < 2** drops lone digits, so "PS 1" and "PS 2" tokenize
 *     identically and score a perfect 1.0.
 *   - **year stopwords** (`2025`/`2026`/`2027`) drop the very token that
 *     distinguishes a name. This is the nastier one: it leaves a degenerate
 *     two-token set like `{park, number}`, which then scores 0.67 against
 *     *any* neighbour of the form `{park, number, N}` — above the 0.6 floor.
 *     A scale test caught it collapsing 15 unrelated rows into one cluster
 *     through exactly that chain, and the stopword list would rot every year
 *     besides.
 *
 * In a free-text title, "2026" is noise. For a place, a number is nearly always
 * identity: street numbers, school numbers, route numbers, "Field 3".
 * Letters stay filtered at length ≥ 2 — a stray "a" carries no meaning.
 */
export function placeNameTokens(s) {
  const tokens = nameTokens(s)
  if (typeof s === 'string') {
    for (const t of s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)) {
      // Numbers in any form, plus single-letter roman numerals. The latter
      // caught a real false merge in the Seattle run: "Overlook I Park" and
      // "Overlook II Park" are distinct parks, but the lone "I" was dropped
      // as a short token, leaving {overlook, park} — which scores 0.67
      // against {overlook, ii, park} and chained both into one cluster.
      if (t && (/^[0-9]+$/.test(t) || t === 'i' || t === 'v' || t === 'x')) tokens.add(t)
    }
  }
  return tokens
}

/**
 * ~150 m at mid-latitudes (plan §2.2). Deliberately tight: structured
 * sources carry no LLM coordinate drift to absorb. A park
 * centroid and an OSM node for the same park land within a block of each
 * other; two genuinely different playgrounds 200 m apart in Manhattan must
 * stay distinct.
 */
export const CELL_DEG = 0.00135

/**
 * Name-similarity floor for treating two rows as the same place.
 *
 * Fairly high because places have no date or venue to corroborate a weak
 * name match — the name is most of the signal. 0.6 accepts
 * "Zilker Metropolitan Park" ↔ "Zilker Park" (2/3) and rejects "Riverside
 * Park" ↔ "Riverside Playground" (1/3).
 */
export const NAME_MIN = 0.6

/**
 * Pass-2 near-coordinate threshold, in metres (issue #398).
 *
 * The grid+token pass (`clusterPlaces`) rejects any pair more than one ~150 m
 * cell apart in lat OR lng, so two rows carrying the *exact same* name that
 * sit ~180 m apart — a grid-edge straggler, or coord drift between an OSM node
 * and an IMLS/NPS centroid for the same place — slip through as separate
 * rows. The prod audit found 160 such residual pairs across the wave metros.
 *
 * 300 m is generous enough to catch those stragglers yet tight enough that two
 * genuinely distinct same-name places across a metro ("Lincoln Park" in two
 * neighbourhoods) never merge — those are kilometres, not metres, apart.
 */
export const NEAR_COORD_M = 300

/**
 * Great-circle distance in metres. Pass 2 needs a true metric distance at
 * the 300 m scale, where the box vs. circle difference matters.
 */
export function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Normalized place name for exact-match grouping: lowercase, whitespace collapsed. */
export function normalizeName(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Categories that may merge with each other. A centroid-only park and an OSM park
 * polygon are the same place; a park and the playground inside it are two things a
 * parent chooses between, so they never merge even at identical coordinates.
 */
const COMPATIBLE = [
  new Set(['park']),
  new Set(['playground']),
  new Set(['library']),
  // OSM files zoos under `aquarium` (our combined bucket) while a museum-ish
  // source may call the same institution a museum.
  new Set(['museum', 'aquarium']),
  new Set(['beach']),
  new Set(['hiking']),
  new Set(['campground']),
  new Set(['waterplay']),
]

export function categoriesCompatible(a, b) {
  if (a === b) return true
  return COMPATIBLE.some((g) => g.has(a) && g.has(b))
}

/**
 * Field precedence (plan §2.2): manual > imls/nps > osm.
 *
 * Curated rows outrank authoritative datasets, which outrank crowd-sourced
 * OSM. Ties break on richer data, then on id for determinism.
 */
const SOURCE_RANK = {
  manual: 100,
  imls: 70,
  nps: 70,
  osm: 40,
}

export function sourceRank(sourceType) {
  if (SOURCE_RANK[sourceType] != null) return SOURCE_RANK[sourceType]
  return 50
}

/** Richness tiebreaker — prefer the row a user learns more from. */
function richness(r) {
  let n = 0
  for (const f of ['address', 'website', 'opening_hours', 'description', 'photo_url']) {
    if (r[f]) n++
  }
  if (r.attributes && Object.keys(r.attributes).length) n++
  return n
}

export function cellKey(lat, lng) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`
}

/**
 * Group rows into duplicate clusters.
 *
 * Each row is compared only against rows in its own cell and the 8
 * neighbouring cells, so a pair straddling a cell boundary is still found.
 * Union-find keeps transitive matches in one cluster (A~B, B~C ⇒ {A,B,C})
 * without the order-dependence a greedy first-match scan has.
 */
export function clusterPlaces(rows) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  const union = (a, b) => {
    const ra = find(a); const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const grid = new Map()
  for (const r of rows) {
    parent.set(r.id, r.id)
    const key = cellKey(r.lat, r.lng)
    const bucket = grid.get(key)
    if (bucket) bucket.push(r)
    else grid.set(key, [r])
  }

  const tokenCache = new Map()
  const tokensOf = (r) => {
    let t = tokenCache.get(r.id)
    if (!t) { t = placeNameTokens(r.name); tokenCache.set(r.id, t) }
    return t
  }

  for (const r of rows) {
    const ci = Math.floor(r.lat / CELL_DEG)
    const cj = Math.floor(r.lng / CELL_DEG)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const bucket = grid.get(`${ci + di}:${cj + dj}`)
        if (!bucket) continue
        for (const other of bucket) {
          // Compare each unordered pair once.
          if (other.id <= r.id) continue
          if (!categoriesCompatible(r.category, other.category)) continue
          if (Math.abs(r.lat - other.lat) > CELL_DEG || Math.abs(r.lng - other.lng) > CELL_DEG) continue
          if (tokenJaccard(tokensOf(r), tokensOf(other)) < NAME_MIN) continue
          union(r.id, other.id)
        }
      }
    }
  }

  const clusters = new Map()
  for (const r of rows) {
    const root = find(r.id)
    const list = clusters.get(root)
    if (list) list.push(r)
    else clusters.set(root, [r])
  }
  return [...clusters.values()]
}

/**
 * Pick the surviving row and compute the merged result for one cluster.
 *
 * Tier B (plan §1.6) is the point of the exercise: a place confirmed by two
 * independent sources is `confidence='high'`, which is what the QA harness and
 * the page generator use to decide what earns a standalone page. Computed
 * mechanically at merge time — no human in the loop (plan §4A.2).
 *
 * `curator-approved rows always win`: an approved row is never archived in
 * favour of an unreviewed one, mirroring the UPSERT contract.
 */
export function mergeCluster(cluster) {
  const winner = [...cluster].sort((a, b) => {
    // A curator's approval outranks everything.
    const aApproved = a.status === 'approved' ? 1 : 0
    const bApproved = b.status === 'approved' ? 1 : 0
    if (aApproved !== bApproved) return bApproved - aApproved
    const rankDiff = sourceRank(b.source_type) - sourceRank(a.source_type)
    if (rankDiff !== 0) return rankDiff
    const richDiff = richness(b) - richness(a)
    if (richDiff !== 0) return richDiff
    return a.id < b.id ? -1 : 1
  })[0]

  const losers = cluster.filter((r) => r.id !== winner.id)
  // Provenance unions across RUNS, not just across this cluster. A row that
  // won an earlier merge carries attributes.sources from that pass (e.g.
  // ['osm','nps']); when a later run clusters it with a new IMLS row,
  // recomputing sources from current members alone would silently drop
  // 'nps' — the multi-source evidence Tier B rests on. Union the
  // stored history with the live members instead.
  const sources = [...new Set([
    ...cluster.map((r) => r.source_type),
    ...cluster.flatMap((r) => Array.isArray(r.attributes?.sources) ? r.attributes.sources : []),
  ])].sort()

  // Union attributes, winner's values winning on key collision.
  const attributes = {}
  for (const r of [...losers, winner]) {
    if (r.attributes) Object.assign(attributes, r.attributes)
  }
  // Provenance so a later audit can see what fed a merged row (plan §2.2).
  if (sources.length > 1) attributes.sources = sources

  // Tier B = multi-source confirmation. Single-source stays at whatever tier
  // its importer assigned (Tier C for the structured sources).
  const confidence = sources.length > 1 ? 'high' : winner.confidence

  // Fill empty fields on the winner from the losers, best-ranked first.
  const filled = {}
  const ordered = [...losers].sort((a, b) => sourceRank(b.source_type) - sourceRank(a.source_type))
  // `description` is deliberately NOT filled from losers: the IMLS museum
  // rows carry a "retired 2018 dataset — verify before visit" note in their
  // description, and filling it onto a fresh OSM winner would surface that
  // disclaimer on a current, approved row (deep-review finding M2). Plan
  // §2.1 row 3 grafts discipline/phone via attributes, not the disclaimer.
  for (const f of ['address', 'website', 'opening_hours', 'photo_url', 'city']) {
    if (winner[f]) continue
    const donor = ordered.find((r) => r[f])
    if (donor) filled[f] = donor[f]
  }

  // Name: adopt a loser's name ONLY to restore a missing category noun.
  //
  // A structured source can store a park's name WITHOUT the word "Park" (the
  // designation lives in a separate column) and outrank OSM, so merging
  // "Jaycee" [nps] with "Jaycee Park" [osm] published a pin labelled
  // just "Jaycee". A prod audit found rows reading "Meadows", "Lions",
  // "Riverside", "Memorial" — meaningless to a parent scanning a map.
  //
  // The rule is deliberately NARROW: take the loser's name only when it is the
  // winner's name plus exactly one trailing category noun. Adopting the
  // longest extension generally is WORSE — the same audit showed it would
  // rewrite "Brickell Park" → "Brickell Park (Burial Ground)", "Washington
  // Park" → "Washington Park Annex", "Miami Auto Museum" → "Miami Auto Museum
  // - South Building": OSM sub-parts, disambiguators and tag artefacts, all of
  // which name a *component* rather than the destination.
  const NAME_TAIL = new Set([
    'park', 'parks', 'library', 'museum', 'garden', 'gardens', 'beach',
    'playground', 'zoo', 'aquarium', 'preserve', 'trail', 'conservatory',
    'arboretum', 'sanctuary',
  ])
  const bestName = (() => {
    const wn = normalizeName(winner.name)
    if (!wn) return null
    for (const r of losers) {
      const rn = normalizeName(r.name)
      if (!rn.startsWith(wn + ' ')) continue
      const tail = rn.slice(wn.length + 1).split(' ')
      if (tail.length === 1 && NAME_TAIL.has(tail[0])) return r.name
    }
    return null
  })()
  if (bestName) filled.name = bestName

  return {
    winner,
    losers,
    sources,
    confidence,
    attributes: Object.keys(attributes).length ? attributes : null,
    filled,
  }
}

/**
 * Pass 2 (issue #398): exact-name / near-coordinate sweep.
 *
 * The grid+token pass keys candidates on a ~150 m spatial bin and a fuzzy
 * token-set score. Two failure modes leave same-name pairs un-merged:
 *   - the pair straddles more than one cell (grid-edge stragglers > 150 m,
 *     which the neighbour scan rejects on the `> CELL_DEG` guard);
 *   - `placeNameTokens` differs between source name variants ("Bee Cave
 *     Public Library" [imls] vs "Bee Cave Public Library" [osm] tokenize the
 *     same, but a stray punctuation/whitespace variant can still drift).
 *
 * This pass groups the *survivors* of pass 1 by exact normalized name and
 * unions any same-name rows within `NEAR_COORD_M` (true haversine). Category
 * compatibility is still enforced — the park/playground-that-contains-it
 * invariant holds in both passes — and the resulting clusters go through the
 * *same* `mergeCluster` machinery, so winner selection, provenance union, and
 * loser archival behave identically to pass 1.
 */
/**
 * Pass 3: prefix-containment sweep.
 *
 * The failure this fixes, found in prod 2026-07-20: the Dallas Arboretum sat
 * on the map THREE times — a centroid row "Dallas Arboretum", OSM's
 * "Dallas Arboretum and Botanical Garden" (polygon), and an IMLS row — all
 * within 263 m. Pass 1 missed it because token-set similarity between
 * "dallas arboretum" and "dallas arboretum and botanical garden" is 2/5 = 0.4,
 * under NAME_MIN (0.6): the longer name's extra tokens dilute the score even
 * though it *contains* the shorter name outright. Pass 2 missed it because the
 * names aren't identical. A national audit found 903 such pairs, 695 of them
 * the same OSM-polygon/centroid-row park indexed twice.
 *
 * So: merge when one normalized name is a whole-word prefix of the other and
 * the rows sit within `thresholdM`. Whole-word ("dallas arboretum " must be a
 * prefix, not "dallas arb") prevents "Lincoln Park" from swallowing
 * "Lincoln Parkway". Category compatibility still applies, so a playground
 * inside a park is untouched.
 *
 * This deliberately absorbs sub-facilities: "Bunche Park" and "Bunche Park
 * Tennis And Pool" become one pin. That is the right call for this product —
 * a parent filtering for parks wants one marker for one destination, and the
 * merge keeps the shorter canonical name while unioning both rows' provenance.
 */
export function clusterByNameContainment(rows, thresholdM = NEAR_COORD_M) {
  const norm = (r) => normalizeName(r.name)
  // Bucket on (first token + spatial cell), NOT the token alone. Head token
  // alone is not selective enough — a metro has hundreds of "Lincoln …" and
  // "Saint …" places, and the scale test (8,000 rows all headed "Park")
  // degenerates to a single O(n²) bucket. ~330 m cells with a 9-cell
  // neighbour scan keep the pairwise work local while still catching pairs
  // that straddle a cell edge.
  const CELL = 0.003
  const cell = (v) => Math.floor(v / CELL)
  const grid = new Map()
  for (const r of rows) {
    const n = norm(r)
    if (!n) continue
    const key = `${n.split(' ')[0]}|${cell(r.lat)}:${cell(r.lng)}`
    const b = grid.get(key)
    if (b) b.push(r); else grid.set(key, [r])
  }

  const parent = new Map(rows.map((r) => [r.id, r.id]))
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
    return x
  }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

  const matched = new Set()
  for (const r of rows) {
    const na = norm(r)
    if (!na) continue
    const head = na.split(' ')[0]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(`${head}|${cell(r.lat) + dx}:${cell(r.lng) + dy}`) ?? []) {
          if (o.id === r.id) continue
          const nb = norm(o)
          if (na === nb) continue                                // pass 2's job
          const [short, long] = na.length < nb.length ? [na, nb] : [nb, na]
          if (!long.startsWith(short + ' ')) continue            // whole-word prefix only
          if (!categoriesCompatible(r.category, o.category)) continue
          if (haversineMeters(r, o) > thresholdM) continue
          union(r.id, o.id)
          matched.add(r.id); matched.add(o.id)
        }
      }
    }
  }

  const groups = new Map()
  for (const r of rows) {
    if (!matched.has(r.id)) continue
    const root = find(r.id)
    const list = groups.get(root)
    if (list) list.push(r); else groups.set(root, [r])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

export function clusterByExactName(rows, thresholdM = NEAR_COORD_M) {
  const byName = new Map()
  for (const r of rows) {
    const key = normalizeName(r.name)
    if (!key) continue
    const bucket = byName.get(key)
    if (bucket) bucket.push(r)
    else byName.set(key, [r])
  }

  const clusters = []
  for (const bucket of byName.values()) {
    if (bucket.length < 2) continue
    const parent = new Map(bucket.map((r) => [r.id, r.id]))
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)))
        x = parent.get(x)
      }
      return x
    }
    const union = (a, b) => {
      const ra = find(a); const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]; const b = bucket[j]
        if (!categoriesCompatible(a.category, b.category)) continue
        if (haversineMeters(a, b) > thresholdM) continue
        union(a.id, b.id)
      }
    }
    const groups = new Map()
    for (const r of bucket) {
      const root = find(r.id)
      const list = groups.get(root)
      if (list) list.push(r)
      else groups.set(root, [r])
    }
    for (const g of groups.values()) if (g.length > 1) clusters.push(g)
  }
  return clusters
}

/**
 * Run the whole dedup over a region's rows: the grid+token pass (pass 1)
 * followed by the exact-name/near-coord sweep (pass 2, issue #398).
 *
 * The two passes share one in-memory row set. Pass 1's losers are dropped
 * before pass 2 runs, so an archived row can never re-enter and drag a third
 * row into a merge. Pass 1's winners are carried forward carrying their merged
 * `attributes` (including `attributes.sources`) and `confidence`, so when pass
 * 2 re-merges a winner the provenance union spans both passes.
 */
/**
 * Apply a pass's merges to the row set: drop every loser, and replace each
 * winner with its merged state so the NEXT pass sees unioned provenance and
 * filled fields. Shared by all three passes — an archived row can never
 * re-enter a later pass and drag a third row into a merge.
 */
function foldMerges(rows, merges) {
  const archivedIds = new Set()
  const winnerMerge = new Map()
  for (const m of merges) {
    for (const l of m.losers) archivedIds.add(l.id)
    winnerMerge.set(m.winner.id, m)
  }
  return rows
    .filter((r) => !archivedIds.has(r.id))
    .map((r) => {
      const m = winnerMerge.get(r.id)
      if (!m) return r
      return { ...r, confidence: m.confidence, attributes: m.attributes, ...m.filled }
    })
}

export function dedupeRegion(rows) {
  // Pass 1 — grid bin + fuzzy token match.
  const clusters = clusterPlaces(rows)
  const merges1 = clusters.filter((c) => c.length > 1).map(mergeCluster)
  const survivors = foldMerges(rows, merges1)

  // Pass 2 — exact-name / near-coord sweep over the survivors.
  const merges2 = clusterByExactName(survivors).map(mergeCluster)

  // Pass 3 — prefix-containment sweep over what pass 2 left standing. Same
  // fold-forward discipline: pass 2's losers are dropped and its winners carry
  // their merged state, so provenance unions across all three passes.
  const survivors3 = foldMerges(survivors, merges2)
  const merges3 = clusterByNameContainment(survivors3).map(mergeCluster)

  const merges = [...merges1, ...merges2, ...merges3]
  const archived = merges.reduce((n, m) => n + m.losers.length, 0)
  const tierB = merges.filter((m) => m.confidence === 'high').length
  return {
    clusters: clusters.length,
    pass1Clusters: merges1.length,
    pass2Clusters: merges2.length,
    pass3Clusters: merges3.length,
    merges,
    archived,
    tierB,
    dedupRate: rows.length ? archived / rows.length : 0,
  }
}
