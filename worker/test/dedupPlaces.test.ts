import { describe, it, expect } from 'vitest'
import {
  CELL_DEG, NAME_MIN, NEAR_COORD_M, categoriesCompatible, sourceRank,
  clusterPlaces, mergeCluster, dedupeRegion, placeNameTokens,
  clusterByExactName, clusterByNameContainment, normalizeName, haversineMeters,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/dedupPlaces.mjs'
// @ts-expect-error — plain-JS script lib, no type declarations by design.
import { tokenJaccard } from '../scripts/lib/dedupCluster.mjs'

type Row = Record<string, unknown>
const row = (over: Row = {}): Row => ({
  id: 'r1', name: 'Zilker Park', category: 'park', lat: 30.2672, lng: -97.7431,
  source_type: 'osm', status: 'pending', confidence: 'medium',
  address: null, website: null, opening_hours: null, description: null,
  photo_url: null, photo_attribution: null, city: null, attributes: null,
  ...over,
})

describe('category compatibility', () => {
  it('merges a zoo filed as aquarium with the same institution filed as museum', () => {
    expect(categoriesCompatible('museum', 'aquarium')).toBe(true)
  })

  it('never merges a playground with the park that contains it', () => {
    // Identical coordinates, but these are two different choices a parent
    // makes — collapsing them would delete the playground from the map.
    expect(categoriesCompatible('park', 'playground')).toBe(false)
  })

  it('keeps unrelated categories apart', () => {
    expect(categoriesCompatible('library', 'beach')).toBe(false)
    expect(categoriesCompatible('park', 'park')).toBe(true)
  })
})

describe('source precedence (plan §2.2)', () => {
  it('ranks manual > structured datasets > osm', () => {
    expect(sourceRank('manual')).toBeGreaterThan(sourceRank('imls'))
    expect(sourceRank('imls')).toBeGreaterThan(sourceRank('osm'))
    expect(sourceRank('parkserve')).toBe(sourceRank('nps'))
  })

  it('ranks an unknown source type between osm and the structured datasets', () => {
    expect(sourceRank('something-else')).toBeGreaterThan(sourceRank('osm'))
    expect(sourceRank('something-else')).toBeLessThan(sourceRank('imls'))
  })
})

describe('clustering', () => {
  it('merges the same park from OSM and ParkServe', () => {
    const rows = [
      row({ id: 'osm-1', name: 'Zilker Metropolitan Park', source_type: 'osm' }),
      row({ id: 'ps-1', name: 'Zilker Park', source_type: 'parkserve', lat: 30.2674, lng: -97.7433 }),
    ]
    const clusters = clusterPlaces(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(2)
  })

  it('keeps two distinct nearby places apart', () => {
    const rows = [
      row({ id: 'a', name: 'Riverside Park' }),
      row({ id: 'b', name: 'Eastwoods Park', lat: 30.2674, lng: -97.7433 }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(2)
  })

  it('does not merge same-named places that are far apart', () => {
    // Every metro has a "Lincoln Park"; they are not the same park.
    const rows = [
      row({ id: 'a', name: 'Lincoln Park' }),
      row({ id: 'b', name: 'Lincoln Park', lat: 30.5, lng: -97.9 }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(2)
  })

  it('finds pairs that straddle a grid-cell boundary', () => {
    // The whole reason candidate generation checks the 8 neighbouring cells:
    // two rows 50 m apart can still land in different bins.
    const lat = Math.ceil(30.2672 / CELL_DEG) * CELL_DEG
    const rows = [
      row({ id: 'a', name: 'Boundary Park', lat: lat - 0.00001 }),
      row({ id: 'b', name: 'Boundary Park', lat: lat + 0.00001, source_type: 'parkserve' }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(1)
  })

  it('groups transitive matches into one cluster, order-independently', () => {
    // A~B and B~C but A and C are at opposite ends — union-find keeps them
    // together, where a greedy first-match scan would split them by input order.
    const rows = [
      row({ id: 'a', name: 'Town Square Park', lat: 30.2672 }),
      row({ id: 'b', name: 'Town Square Park', lat: 30.26728, source_type: 'parkserve' }),
      row({ id: 'c', name: 'Town Square Park', lat: 30.26736, source_type: 'imls' }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(1)
    expect(clusterPlaces([...rows].reverse())).toHaveLength(1)
  })

  it('requires real name overlap', () => {
    expect(NAME_MIN).toBeGreaterThan(0.5)
    const rows = [
      row({ id: 'a', name: 'Riverside Park' }),
      row({ id: 'b', name: 'Riverside Playground Annex', lat: 30.26725, category: 'park' }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(2)
  })
})

describe('merge result', () => {
  const cluster = [
    row({ id: 'osm-1', name: 'Zilker Park', source_type: 'osm', website: 'https://osm.example', attributes: { a: 1 } }),
    row({ id: 'ps-1', name: 'Zilker Park', source_type: 'parkserve', address: '2100 Barton Springs Rd', attributes: { acres: 351 } }),
  ]

  it('keeps the higher-precedence source as the survivor', () => {
    expect(mergeCluster(cluster).winner.id).toBe('ps-1')
  })

  it('lifts a multi-source-confirmed place to Tier B', () => {
    // This is the point of the pass: Tier B is what the QA harness and page
    // generator use to decide what earns a standalone page, and it's computed
    // mechanically with no human in the loop (plan §4A.2).
    const m = mergeCluster(cluster)
    expect(m.confidence).toBe('high')
    expect(m.sources).toEqual(['osm', 'parkserve'])
  })

  it('leaves a single-source place at its importer tier', () => {
    const m = mergeCluster([row({ id: 'only', source_type: 'osm', confidence: 'medium' })])
    expect(m.confidence).toBe('medium')
    expect(m.losers).toEqual([])
  })

  it('unions attributes and records provenance', () => {
    const m = mergeCluster(cluster)
    expect(m.attributes).toMatchObject({ a: 1, acres: 351, sources: ['osm', 'parkserve'] })
  })

  it('back-fills empty winner fields from the losers', () => {
    // The ParkServe row wins on precedence but has no website; the OSM row does.
    expect(mergeCluster(cluster).filled.website).toBe('https://osm.example')
  })

  it('never archives a curator-approved row in favour of an unreviewed one', () => {
    // Mirrors the UPSERT contract: an approval is a human decision the merge
    // heuristic does not get to override.
    const m = mergeCluster([
      row({ id: 'approved-osm', source_type: 'osm', status: 'approved' }),
      row({ id: 'pending-ps', source_type: 'parkserve', status: 'pending' }),
    ])
    expect(m.winner.id).toBe('approved-osm')
    expect(m.losers.map((l: Row) => l.id)).toEqual(['pending-ps'])
  })
})

describe('region pass', () => {
  it('reports counts and a dedup rate', () => {
    const rows = [
      row({ id: 'a', name: 'Shared Park' }),
      row({ id: 'b', name: 'Shared Park', source_type: 'parkserve', lat: 30.26725 }),
      row({ id: 'c', name: 'Solo Park', lat: 30.4, lng: -97.9 }),
    ]
    const r = dedupeRegion(rows)
    expect(r.clusters).toBe(2)
    expect(r.archived).toBe(1)
    expect(r.tierB).toBe(1)
    expect(r.dedupRate).toBeCloseTo(1 / 3, 4)
  })

  it('scales linearly enough to run a metro-sized batch', () => {
    // 8,000 rows is a large metro. A greedy O(n²) scan would be ~32M
    // comparisons here; grid-binning keeps it near-linear.
    const rows = Array.from({ length: 8000 }, (_, i) => row({
      id: `r-${i}`,
      name: `Park Number ${i}`,
      lat: 30.05 + (i % 500) * 0.001,
      lng: -98.0 + Math.floor(i / 500) * 0.001,
    }))
    const started = Date.now()
    const r = dedupeRegion(rows)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(r.clusters).toBe(8000)
  })
})


describe('pass 3 — prefix containment (the Dallas Arboretum bug)', () => {
  // Found in prod 2026-07-20: the Dallas Arboretum sat on the map three times
  // — ParkServe "Dallas Arboretum" (centroid), OSM "Dallas Arboretum and
  // Botanical Garden" (polygon) 22 m away, and an IMLS row 241 m away. Pass 1
  // missed it because tokenJaccard is only 0.4 (the longer name's extra tokens
  // dilute the score); pass 2 missed it because the names aren't identical.
  const parkserve = row({ id: 'ps', name: 'Dallas Arboretum', source_type: 'parkserve', lat: 32.8231, lng: -96.7167 })
  const osm = row({ id: 'osm', name: 'Dallas Arboretum and Botanical Garden', source_type: 'osm', lat: 32.8232, lng: -96.7165 })

  it('confirms pass 1 and pass 2 both genuinely miss this pair', () => {
    expect(tokenJaccard(placeNameTokens(parkserve.name), placeNameTokens(osm.name))).toBeLessThan(NAME_MIN)
    expect(clusterByExactName([parkserve, osm])).toHaveLength(0)
  })

  it('merges when one name is a whole-word prefix of the other', () => {
    expect(clusterByNameContainment([parkserve, osm])).toHaveLength(1)
    const r = dedupeRegion([parkserve, osm])
    expect(r.pass3Clusters).toBe(1)
    expect(r.archived).toBe(1)
    // ParkServe outranks OSM, so the shorter canonical name wins.
    expect(r.merges[0].winner.id).toBe('ps')
    expect(r.merges[0].sources).toEqual(['osm', 'parkserve'])
  })

  it('requires a WHOLE-WORD prefix — "Lincoln Park" must not swallow "Lincoln Parkway"', () => {
    const a = row({ id: 'a', name: 'Lincoln Park', lat: 41.92, lng: -87.63 })
    const b = row({ id: 'b', name: 'Lincoln Parkway', lat: 41.9201, lng: -87.6301 })
    expect(clusterByNameContainment([a, b])).toHaveLength(0)
  })

  it('respects the distance threshold — same-prefix names far apart stay separate', () => {
    const a = row({ id: 'a', name: 'Riverside Park', lat: 40.80, lng: -73.97 })
    const b = row({ id: 'b', name: 'Riverside Park North', lat: 40.81, lng: -73.97 }) // ~1.1 km
    expect(clusterByNameContainment([a, b])).toHaveLength(0)
  })

  it('never merges across incompatible categories', () => {
    const park = row({ id: 'p', name: 'Bunche Park', category: 'park', lat: 25.94, lng: -80.24 })
    const pg = row({ id: 'g', name: 'Bunche Park Playground', category: 'playground', lat: 25.9401, lng: -80.2401 })
    expect(clusterByNameContainment([park, pg])).toHaveLength(0)
  })

  it('stays fast when thousands of rows share a first token', () => {
    // The bug this guards: bucketing on the head token ALONE put all 8,000
    // "Park Number i" rows in one bucket and went quadratic (8.1s). Spatial
    // binning keeps the pairwise scan local.
    const rows = Array.from({ length: 8000 }, (_, i) => row({
      id: `r-${i}`, name: `Park Number ${i}`,
      lat: 30.05 + (i % 500) * 0.001, lng: -98.0 + Math.floor(i / 500) * 0.001,
    }))
    const started = Date.now()
    clusterByNameContainment(rows)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('keeps the MORE COMPLETE name even when the winner has the barer one', () => {
    // The bug: ParkServe stores park names without the word "Park" (its
    // designation is a separate column) and outranks OSM, so merging published
    // pins labelled "Jaycee", "Meadows", "Lions" — ~200 of them in prod.
    const ps = row({ id: 'ps', name: 'Jaycee', source_type: 'parkserve', lat: 25.75, lng: -80.25 })
    const osm = row({ id: 'osm', name: 'Jaycee Park', source_type: 'osm', lat: 25.7501, lng: -80.2501 })
    const m = dedupeRegion([ps, osm]).merges[0]
    expect(m.winner.id).toBe('ps')          // source precedence unchanged
    expect(m.filled.name).toBe('Jaycee Park') // but the label gains "Park"
  })

  it('adopts ONLY a missing category noun, never a sub-part or tag artefact', () => {
    // Adopting the longest extension generally would rewrite real prod rows to
    // WORSE labels: "Brickell Park (Burial Ground)", "Washington Park Annex",
    // "Miami Auto Museum - South Building" all name a component, not the
    // destination. Only a bare trailing category noun may be adopted.
    const keep = (winner: string, loser: string) => {
      const a = row({ id: 'a', name: winner, source_type: 'parkserve', lat: 39.7, lng: -104.9 })
      const b = row({ id: 'b', name: loser, source_type: 'osm', lat: 39.7001, lng: -104.9001 })
      return dedupeRegion([a, b]).merges[0]?.filled.name ?? null
    }
    expect(keep('Watson Island', 'Watson Island Park')).toBe('Watson Island Park')
    expect(keep('Palmetto Bay Branch', 'Palmetto Bay Branch Library')).toBe('Palmetto Bay Branch Library')
    // Sub-parts / artefacts must NOT be adopted.
    expect(keep('Brickell Park', 'Brickell Park (Burial Ground)')).toBeNull()
    expect(keep('Washington Park', 'Washington Park Annex')).toBeNull()
    expect(keep('Miami Auto Museum', 'Miami Auto Museum - South Building')).toBeNull()
    // Unrelated longer name: not a whole-word extension at all.
    const c = row({ id: 'c', name: 'Elm', source_type: 'parkserve', lat: 41.0, lng: -73.0 })
    const d = row({ id: 'd', name: 'Elmwood Gardens', source_type: 'osm', lat: 41.0001, lng: -73.0001 })
    expect(dedupeRegion([c, d]).merges.map((x) => x.filled.name).filter(Boolean)).toHaveLength(0)
  })
})

describe('place-name tokenisation', () => {
  it('keeps lone digits, which are often the whole distinction', () => {
    // "PS 1" vs "PS 2" are different schools. dedupCluster.nameTokens drops
    // tokens shorter than 2 chars, which makes them tokenize identically.
    expect(placeNameTokens('PS 1')).toEqual(new Set(['ps', '1']))
    expect(tokenJaccard(placeNameTokens('PS 1'), placeNameTokens('PS 2'))).toBeLessThan(NAME_MIN)
  })

  it('keeps years, which the event stopword list would strip', () => {
    // The nastier failure: stripping "2026" leaves a degenerate token set
    // that scores above the floor against any neighbour sharing its generic
    // words, chaining unrelated rows into one cluster through union-find.
    expect(placeNameTokens('Park Number 2026').has('2026')).toBe(true)
    expect(
      tokenJaccard(placeNameTokens('Park Number 2026'), placeNameTokens('Park Number 1524')),
    ).toBeLessThan(NAME_MIN)
  })

  it('still drops meaningless single letters and stopwords', () => {
    expect(placeNameTokens('The Park at A')).toEqual(new Set(['park']))
  })
})

describe('roman-numeral distinction (found in the Seattle run)', () => {
  it('keeps "Overlook I Park" and "Overlook II Park" apart', () => {
    // A real false merge: the lone "I" was dropped as a short token, leaving
    // {overlook, park}, which scores 0.67 against {overlook, ii, park} — and
    // union-find then chained both distinct parks into one cluster.
    expect(
      tokenJaccard(placeNameTokens('Overlook I Park'), placeNameTokens('Overlook II Park')),
    ).toBeLessThan(NAME_MIN)
    const rows = [
      row({ id: 'a', name: 'Overlook I Park' }),
      row({ id: 'b', name: 'Overlook II Park', lat: 30.26725, source_type: 'parkserve' }),
    ]
    expect(clusterPlaces(rows)).toHaveLength(2)
  })

  it('still merges the genuine name variants the Seattle run got right', () => {
    for (const [a, b] of [
      ['MaST Center Aquarium', 'The MaST Center Aquarium'],
      ['Cecil Powell Park', 'Cecil Powell Neighborhood Park'],
      ['Kobe Terrace', 'Kobe Terrace Park'],
      ['Downtown Park', 'Bellevue Downtown Park'],
    ]) {
      expect(tokenJaccard(placeNameTokens(a), placeNameTokens(b)), `${a} ~ ${b}`)
        .toBeGreaterThanOrEqual(NAME_MIN)
    }
  })
})

describe('provenance across successive runs', () => {
  it('unions attributes.sources from earlier merges instead of overwriting them', () => {
    // Run 1 merged osm+parkserve; the winner carries sources=['osm','parkserve'].
    // Run 2 clusters that winner with a new IMLS row. Recomputing from live
    // members alone would emit ['imls','osm'] and silently drop parkserve —
    // the multi-source evidence the row's Tier B rests on.
    const m = mergeCluster([
      row({ id: 'prev-winner', source_type: 'osm', attributes: { acres: 12, sources: ['osm', 'parkserve'] } }),
      row({ id: 'new-imls', source_type: 'imls' }),
    ])
    expect(m.sources).toEqual(['imls', 'osm', 'parkserve'])
    expect(m.attributes.sources).toEqual(['imls', 'osm', 'parkserve'])
    expect(m.confidence).toBe('high')
  })
})

describe('description never leaks through the fill (deep-review M2)', () => {
  it('does not copy an IMLS vintage disclaimer onto a fresh OSM winner', () => {
    // IMLS museum rows carry "retired 2018 dataset — verify before visit" in
    // description. The winner here is a current OSM row; inheriting that
    // disclaimer would surface it on an approved, current place.
    const m = mergeCluster([
      row({ id: 'osm-cur', source_type: 'manual', description: null }),
      row({ id: 'imls-old', source_type: 'imls', description: 'Source: IMLS MDF (2018 — retired). Verify before visit.' }),
    ])
    expect(m.winner.id).toBe('osm-cur')
    expect(m.filled.description).toBeUndefined()
    // Other gaps still fill.
    const m2 = mergeCluster([
      row({ id: 'w', source_type: 'manual', address: null }),
      row({ id: 'l', source_type: 'imls', address: '1 Real St' }),
    ])
    expect(m2.filled.address).toBe('1 Real St')
  })
})

describe('second pass — exact-name / near-coord sweep (issue #398)', () => {
  // 0.0016° of latitude ≈ 178 m at this latitude: past the ~150 m grid cell,
  // so pass 1's neighbour scan rejects it, but well inside the 300 m sweep.
  const NEAR_DLAT = 0.0016
  // 0.0045° ≈ 501 m: past the 300 m sweep too.
  const FAR_DLAT = 0.0045

  it('sanity-checks the coordinate deltas the scenarios rely on', () => {
    const base = { lat: 30.2672, lng: -97.7431 }
    expect(NEAR_DLAT).toBeGreaterThan(CELL_DEG) // pass 1 misses it
    expect(haversineMeters(base, { lat: 30.2672 + NEAR_DLAT, lng: -97.7431 })).toBeLessThan(NEAR_COORD_M)
    expect(haversineMeters(base, { lat: 30.2672 + FAR_DLAT, lng: -97.7431 })).toBeGreaterThan(NEAR_COORD_M)
  })

  it('normalizeName lowercases and collapses whitespace', () => {
    expect(normalizeName('  Bee   Cave\nPublic Library ')).toBe('bee cave public library')
    expect(normalizeName(null)).toBe('')
  })

  it('clusters a same-name pair that straddles a grid boundary pass 1 misses', () => {
    // Boston "Bennett Street Playground" osm+parkserve, ~178 m apart.
    const rows = [
      row({ id: 'osm-1', name: 'Bennett Street Playground', category: 'playground', source_type: 'osm' }),
      row({ id: 'ps-1', name: 'Bennett Street Playground', category: 'playground', source_type: 'parkserve',
        lat: 30.2672 + NEAR_DLAT }),
    ]
    // Pass 1 alone leaves them apart — that is the residual bug #398 reports.
    expect(clusterPlaces(rows)).toHaveLength(2)
    // The exact-name sweep unites them.
    expect(clusterByExactName(rows)).toHaveLength(1)
    const r = dedupeRegion(rows)
    expect(r.pass1Clusters).toBe(0)
    expect(r.pass2Clusters).toBe(1)
    expect(r.archived).toBe(1)
  })

  it('respects the 300 m threshold — a same-name pair 500 m apart is NOT merged', () => {
    // Same normalized name but genuinely distinct locations across the metro.
    const rows = [
      row({ id: 'a', name: 'Riverside Playground', category: 'playground' }),
      row({ id: 'b', name: 'Riverside Playground', category: 'playground',
        lat: 30.2672 + FAR_DLAT, source_type: 'parkserve' }),
    ]
    expect(clusterByExactName(rows)).toHaveLength(0)
    expect(dedupeRegion(rows).archived).toBe(0)
  })

  it('preserves an approved winner absorbing a pending IMLS twin (corroboration path)', () => {
    // An approved OSM museum and its pending IMLS twin, ~178 m apart — pass 1
    // misses the gap, pass 2 catches it. The approval must survive and the
    // sources must union to lift the row to Tier B.
    const rows = [
      row({ id: 'osm-museum', name: 'City History Museum', category: 'museum',
        source_type: 'osm', status: 'approved' }),
      row({ id: 'imls-museum', name: 'City History Museum', category: 'museum',
        source_type: 'imls', status: 'pending', lat: 30.2672 + NEAR_DLAT }),
    ]
    const r = dedupeRegion(rows)
    expect(r.pass2Clusters).toBe(1)
    expect(r.merges).toHaveLength(1)
    const m = r.merges[0]
    expect(m.winner.id).toBe('osm-museum')
    expect(m.winner.status).toBe('approved')
    expect(m.losers.map((l: Row) => l.id)).toEqual(['imls-museum'])
    expect(m.sources).toEqual(['imls', 'osm'])
    expect(m.confidence).toBe('high')
  })

  it('excludes rows archived by pass 1 from pass 2', () => {
    // A+B merge in pass 1 (~100 m); A (osm) is the loser, archived. C shares
    // the name and sits ~222 m from the archived A but ~323 m from winner B.
    // If A could re-enter pass 2 it would drag C into a merge; it must not.
    const rows = [
      row({ id: 'A', name: 'Lake Park', source_type: 'osm', lat: 30.2672 }),
      row({ id: 'B', name: 'Lake Park', source_type: 'parkserve', lat: 30.2672 + 0.0009 }),
      row({ id: 'C', name: 'Lake Park', source_type: 'imls', lat: 30.2672 - 0.0020 }),
    ]
    const r = dedupeRegion(rows)
    expect(r.pass1Clusters).toBe(1)
    expect(r.pass2Clusters).toBe(0)
    expect(r.archived).toBe(1)
    // Only A was archived; C is untouched (not dragged in via the archived A).
    const losers = r.merges.flatMap((m: { losers: Row[] }) => m.losers.map((l) => l.id))
    expect(losers).toEqual(['A'])
  })

  it('leaves distinct-name rows at identical coordinates untouched', () => {
    const rows = [
      row({ id: 'a', name: 'North Park', lat: 30.2672, lng: -97.7431 }),
      row({ id: 'b', name: 'South Park', lat: 30.2672, lng: -97.7431, source_type: 'parkserve' }),
    ]
    expect(clusterByExactName(rows)).toHaveLength(0)
    expect(dedupeRegion(rows).archived).toBe(0)
  })
})
