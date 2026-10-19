// Coverage for the duplicate-cluster heuristic that backs both the
// merge-aggregators in-week dedup + cross-week reject pass and the Tier 1
// find-duplicate-items cleanup script. node:test (no Miniflare needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nameTokens,
  addressTokens,
  tokenJaccard,
  dayBucket,
  coordsClose,
  sameCanonicalEvent,
  clusterRows,
} from '../scripts/lib/dedupCluster.mjs'

const HAMMER_LAT = 37.3367
const HAMMER_LNG = -121.8896
const STANFORD_LAT = 37.4298
const STANFORD_LNG = -122.17

test('nameTokens lowercases, strips non-alphanumeric, drops stopwords + short tokens', () => {
  assert.deepEqual([...nameTokens("55th Annual Stanford Powwow!")].sort(), ['55th', 'annual', 'powwow', 'stanford'])
  assert.deepEqual([...nameTokens('a the of for at in on')], [])  // all stopwords
  assert.deepEqual([...nameTokens('A B C')], [])                  // all 1-char
  assert.deepEqual([...nameTokens(null)], [])
})

test('tokenJaccard handles overlap and disjoint sets', () => {
  const a = nameTokens('Stanford Powwow Friday')
  const b = nameTokens('55th Annual Stanford Powwow')
  // a={stanford,powwow,friday}, b={55th,annual,stanford,powwow} → overlap=2, union=5 → 0.4
  assert.equal(tokenJaccard(a, b).toFixed(2), '0.40')
  assert.equal(tokenJaccard(nameTokens(''), nameTokens('foo')), 0)
})

test('dayBucket extracts ISO date prefix; nullish input returns null', () => {
  assert.equal(dayBucket('2026-05-09T11:00:00-07:00'), '2026-05-09')
  assert.equal(dayBucket(null), null)
  assert.equal(dayBucket(undefined), null)
})

test('coordsClose: ~1.5km tolerance', () => {
  // 1km apart: well within 1.5km tol
  assert.equal(coordsClose({ lat: 37.5, lng: -122.0 }, { lat: 37.5090, lng: -122.0 }), true)
  // 2km apart (dlat 0.018): outside 1.5km tol
  assert.equal(coordsClose({ lat: 37.5, lng: -122.0 }, { lat: 37.5180, lng: -122.0 }), false)
})

test('sameCanonicalEvent — Slide Ranch Mother\'s Day cross-source split (mode F)', () => {
  // W18 BAKF row vs W19 marinmommies row — same event, same time, ~85m coord drift.
  const a = {
    name: "Slide Ranch Family Farm Day - Mother's Day",
    lat: 37.8669, lng: -122.5807,
    start_time: '2026-05-09T09:30:00-07:00',
  }
  const b = {
    name: "Family Farm Day: Mother's Day",
    lat: 37.8554, lng: -122.582,
    start_time: '2026-05-09T09:30:00-07:00',
  }
  assert.equal(sameCanonicalEvent(a, b), true)
})

test('sameCanonicalEvent — Stanford Powwow multi-day split (mode E)', () => {
  // Fri/Sat/Sun rows — same venue, names contain "Powwow" + day name.
  // Without allowAdjacentDays they are NOT duplicates.
  const fri = { name: 'Stanford Powwow (Friday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-08T17:00:00-07:00' }
  const sat = { name: 'Stanford Powwow (Saturday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-09T11:00:00-07:00' }
  const sun = { name: 'Stanford Powwow (Sunday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-10T11:00:00-07:00' }
  assert.equal(sameCanonicalEvent(fri, sat), false)
  assert.equal(sameCanonicalEvent(fri, sat, { allowAdjacentDays: true }), true)
  assert.equal(sameCanonicalEvent(fri, sun, { allowAdjacentDays: true }), true)
})

test('sameCanonicalEvent — same-day matinee + evening showings are NOT duplicates', () => {
  // Giselle May 16 2pm vs 7pm — distinct showings, must stay separate.
  const matinee = {
    name: 'Giselle (New Ballet) - May 16 Matinee',
    lat: HAMMER_LAT, lng: HAMMER_LNG,
    start_time: '2026-05-16T14:00:00-07:00',
  }
  const evening = {
    name: 'Giselle (New Ballet) - May 16 Evening',
    lat: HAMMER_LAT, lng: HAMMER_LNG,
    start_time: '2026-05-16T19:00:00-07:00',
  }
  assert.equal(sameCanonicalEvent(matinee, evening, { allowAdjacentDays: true }), false)
})

test('sameCanonicalEvent — same-day, same-time but ≤30 min drift IS a duplicate', () => {
  // LLM coord/time drift between weeks for the same event.
  const a = { name: 'Bug Day at Randall Museum', lat: 37.7641, lng: -122.4377, start_time: '2026-04-18T10:00:00-07:00' }
  const b = { name: 'Bug Day at Randall Museum', lat: 37.7618, lng: -122.4375, start_time: '2026-04-18T10:15:00-07:00' }
  assert.equal(sameCanonicalEvent(a, b), true)
})

test('sameCanonicalEvent — rrule absorbs per-occurrence row (mode D reconciliation)', () => {
  // 2nd Saturday on the Farm — W17 emitted as monthly rrule, W18 emitted
  // 9 per-occurrence rows. We want the rrule row to absorb the occurrences.
  const recurring = {
    name: '2nd Saturday on the Farm',
    lat: 36.9385, lng: -121.7501,
    start_time: '2026-04-04T11:00:00-07:00',
    rrule: 'FREQ=MONTHLY;BYDAY=2SA',
  }
  const occurrence = {
    name: '2nd Saturday on the Farm (May)',
    lat: 36.9385, lng: -121.7501,
    start_time: '2026-05-09T11:00:00-07:00',
    rrule: null,
  }
  assert.equal(sameCanonicalEvent(recurring, occurrence), true)
})

test('sameCanonicalEvent — events at >1.5km do NOT match even with identical names', () => {
  const a = { name: 'Family Day', lat: 37.5, lng: -122.0, start_time: '2026-05-09T10:00:00-07:00' }
  // dlat 0.02 ≈ 2.2km — outside the widened tolerance
  const b = { name: 'Family Day', lat: 37.52, lng: -122.0, start_time: '2026-05-09T10:00:00-07:00' }
  assert.equal(sameCanonicalEvent(a, b), false)
})

test('clusterRows groups Stanford Powwow Fri/Sat/Sun into ONE cluster with allowAdjacentDays', () => {
  const rows = [
    { name: 'Stanford Powwow (Friday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-08T17:00:00-07:00' },
    { name: 'Stanford Powwow (Saturday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-09T11:00:00-07:00' },
    { name: 'Stanford Powwow (Sunday)', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-10T11:00:00-07:00' },
  ]
  const clusters = clusterRows(rows, { allowAdjacentDays: true })
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].length, 3)
})

test('clusterRows leaves Giselle matinee + evening in DIFFERENT clusters (no false collapse)', () => {
  const rows = [
    { name: 'Giselle Matinee', lat: HAMMER_LAT, lng: HAMMER_LNG, start_time: '2026-05-16T14:00:00-07:00' },
    { name: 'Giselle Evening', lat: HAMMER_LAT, lng: HAMMER_LNG, start_time: '2026-05-16T19:00:00-07:00' },
  ]
  const clusters = clusterRows(rows, { allowAdjacentDays: true })
  assert.equal(clusters.length, 2)
})

// --- #519: venue-name tokens dominating name similarity ---

test('addressTokens strips stopwords + pure-digit tokens (street numbers, zips)', () => {
  assert.deepEqual(
    [...addressTokens('1301 7th Ave N, St. Cloud, MN 56303')].sort(),
    ['7th', 'ave', 'cloud', 'mn', 'st'],
  )
  assert.deepEqual([...addressTokens(null)], [])
})

test('sameCanonicalEvent — Orlando: distinct programs at the same branch, parenthesized venue suffix', () => {
  // "Veterans Memorial - St. Cloud Branch" is most of the token set; without
  // stripping it, both pairs jaccard well above 0.5.
  const addr = '1301 7th St N, St. Cloud, FL 34769'
  const craftyCrew = { name: 'Crafty Crew (Veterans Memorial - St. Cloud Branch)', address: addr, lat: 28.2489, lng: -81.2862, start_time: '2026-06-04T10:00:00-04:00' }
  const babyAndMe = { name: 'Baby & Me (Veterans Memorial - St. Cloud Branch)', address: addr, lat: 28.2489, lng: -81.2862, start_time: '2026-06-04T10:05:00-04:00' }
  assert.equal(sameCanonicalEvent(craftyCrew, babyAndMe), false)

  const preschoolPlaydate = { name: 'Preschool Playdate (Veterans Memorial - St. Cloud Branch)', address: addr, lat: 28.2489, lng: -81.2862, start_time: '2026-06-05T10:00:00-04:00' }
  const foamPalooza = { name: 'Foam-Palooza (Veterans Memorial - St. Cloud Branch)', address: addr, lat: 28.2489, lng: -81.2862, start_time: '2026-06-05T10:10:00-04:00' }
  assert.equal(sameCanonicalEvent(preschoolPlaydate, foamPalooza), false)
})

test('sameCanonicalEvent — Atlanta: two different markets sharing the venue name in the address', () => {
  const addr = '17 Depot St, Marietta, GA 30060' // "Marietta Square" venue, not literally in the street line
  const artisan = { name: 'Marietta Square Artisan Market', address: 'Marietta Square, ' + addr, lat: 33.9526, lng: -84.5499, start_time: '2026-05-16T09:00:00-04:00' }
  const farmers = { name: 'Marietta Square Farmers Market', address: 'Marietta Square, ' + addr, lat: 33.9526, lng: -84.5499, start_time: '2026-05-16T09:15:00-04:00' }
  assert.equal(sameCanonicalEvent(artisan, farmers), false)
})

test('sameCanonicalEvent — Seattle: different tour products sharing venue tokens from the address', () => {
  const addr = '1501 Pike Pl, Seattle, WA 98101'
  const insiders = { name: "Insider's Breakfast and Culture Tour of Pike Place", address: addr, lat: 47.6097, lng: -122.3422, start_time: '2026-06-10T09:00:00-07:00' }
  const original = { name: 'The Original Food and Culture Tour of Pike Place', address: addr, lat: 47.6097, lng: -122.3422, start_time: '2026-06-10T09:30:00-07:00' }
  assert.equal(sameCanonicalEvent(insiders, original), false)
})

test('sameCanonicalEvent — venue-token stripping never empties BOTH sets when name IS the venue name', () => {
  // Degenerate case: name has no non-venue tokens left after stripping —
  // falls back to unstripped comparison rather than a guaranteed non-match.
  const addr = '400 Broad St, Seattle, WA 98109'
  const a = { name: 'Space Needle', address: addr, lat: 47.6205, lng: -122.3493, start_time: '2026-07-04T20:00:00-07:00' }
  const b = { name: 'Space Needle', address: addr, lat: 47.6205, lng: -122.3493, start_time: '2026-07-04T20:05:00-07:00' }
  assert.equal(sameCanonicalEvent(a, b), true)
})

test('sameCanonicalEvent — adjacent-days-only match requires a tighter name bar (0.75) than same-day (0.5)', () => {
  // 0.5 jaccard, adjacent days, no rrule/same-day signal: rejected under the
  // stricter adjacent-day threshold even though it would pass at 0.5.
  const a = { name: 'Spring Market Day One', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-08T10:00:00-07:00' }
  const b = { name: 'Spring Market Day Two Special', lat: STANFORD_LAT, lng: STANFORD_LNG, start_time: '2026-05-09T10:00:00-07:00' }
  // a tokens: {spring,market,day,one} b tokens: {spring,market,day,two,special} → 3/6 = 0.5
  assert.equal(sameCanonicalEvent(a, b, { allowAdjacentDays: true }), false)
})
