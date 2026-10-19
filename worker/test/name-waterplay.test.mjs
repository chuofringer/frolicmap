// worker/test/name-waterplay.test.mjs
// Coverage for the pure waterplay-naming logic (#435 follow-up). Uses
// node --test (not Vitest) because nameWaterplay.mjs is a pure module with no
// Miniflare/DB dependency — mirrors dedupCluster.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isGenericWaterplayName,
  waterplayFallbackLabel,
  isEligibleDonor,
  pickWaterplayName,
  nameWaterplayRows,
} from '../scripts/lib/nameWaterplay.mjs'

// ~0.001 deg latitude ≈ 111 m at these latitudes; ~0.003 deg ≈ 333 m.
const NEAR = 0.001 // within 250 m
const FAR = 0.003 // beyond 250 m

const splashRow = { id: 'osm-node-1', name: 'Splash pad', lat: 40.0, lng: -74.0 }

test('isGenericWaterplayName matches the fallback labels, case-insensitively', () => {
  assert.equal(isGenericWaterplayName('Splash pad'), true)
  assert.equal(isGenericWaterplayName('Water park'), true)
  assert.equal(isGenericWaterplayName('Splash Pad'), true) // real-but-generic OSM tag casing
  assert.equal(isGenericWaterplayName('SPLASH PAD'), true)
  assert.equal(isGenericWaterplayName('  water park '), true)
})

test('isGenericWaterplayName rejects real names', () => {
  assert.equal(isGenericWaterplayName('Volunteer Park Splash Pad'), false)
  assert.equal(isGenericWaterplayName('Rotary Waterpark'), false)
  assert.equal(isGenericWaterplayName(''), false)
})

test('waterplayFallbackLabel keeps the right feature word', () => {
  assert.equal(waterplayFallbackLabel('Water park'), 'Water park')
  assert.equal(waterplayFallbackLabel('Splash pad'), 'Splash pad')
  assert.equal(waterplayFallbackLabel('Splash Pad'), 'Splash pad')
})

test('isEligibleDonor rejects generic placeholder names', () => {
  assert.equal(isEligibleDonor({ id: 'a', name: 'Volunteer Park' }), true)
  assert.equal(isEligibleDonor({ id: 'b', name: 'Unknown Park' }), false)
  assert.equal(isEligibleDonor({ id: 'c', name: 'Open Space' }), false)
  assert.equal(isEligibleDonor({ id: 'd', name: 'Park' }), false)
  assert.equal(isEligibleDonor({ id: 'e', name: 'Splash pad' }), false)
  assert.equal(isEligibleDonor({ id: 'f', name: '' }), false)
  assert.equal(isEligibleDonor({ id: 'g' }), false)
})

test('pickWaterplayName lifts the nearest donor name into the "at" form', () => {
  const donors = [{ id: 'p1', name: 'Volunteer Park', lat: 40.0 + NEAR, lng: -74.0 }]
  const picked = pickWaterplayName(splashRow, donors)
  assert.equal(picked.name, 'Splash pad at Volunteer Park')
  assert.equal(picked.donorId, 'p1')
  assert.ok(picked.distanceM > 0 && picked.distanceM <= 250)
})

test('pickWaterplayName picks the nearest of several in-range donors', () => {
  const donors = [
    { id: 'far', name: 'Far Park', lat: 40.0 + NEAR * 2, lng: -74.0 },
    { id: 'near', name: 'Near Park', lat: 40.0 + NEAR * 0.5, lng: -74.0 },
  ]
  const picked = pickWaterplayName(splashRow, donors)
  assert.equal(picked.donorId, 'near')
  assert.equal(picked.name, 'Splash pad at Near Park')
})

test('pickWaterplayName returns null when no donor is within 250 m', () => {
  const donors = [{ id: 'p1', name: 'Distant Park', lat: 40.0 + FAR, lng: -74.0 }]
  assert.equal(pickWaterplayName(splashRow, donors), null)
})

test('pickWaterplayName skips ineligible donors even when they are nearest', () => {
  const donors = [
    { id: 'generic', name: 'Unknown Park', lat: 40.0 + NEAR * 0.5, lng: -74.0 },
    { id: 'real', name: 'Meridian Park', lat: 40.0 + NEAR, lng: -74.0 },
  ]
  const picked = pickWaterplayName(splashRow, donors)
  assert.equal(picked.donorId, 'real')
})

test('pickWaterplayName uses the donor name directly when it already names the feature', () => {
  const donors = [{ id: 'p1', name: 'Rotary Splash Pad', lat: 40.0 + NEAR, lng: -74.0 }]
  const picked = pickWaterplayName(splashRow, donors)
  assert.equal(picked.name, 'Rotary Splash Pad') // not "Splash pad at Rotary Splash Pad"
})

test('pickWaterplayName handles a water-park row and redundant water-park donor', () => {
  const waterRow = { id: 'osm-way-9', name: 'Water park', lat: 40.0, lng: -74.0 }
  const atForm = pickWaterplayName(waterRow, [{ id: 'p1', name: 'Riverside Park', lat: 40.0 + NEAR, lng: -74.0 }])
  assert.equal(atForm.name, 'Water park at Riverside Park')
  const direct = pickWaterplayName(waterRow, [{ id: 'p2', name: 'Big Wave Waterpark', lat: 40.0 + NEAR, lng: -74.0 }])
  assert.equal(direct.name, 'Big Wave Waterpark')
})

test('nameWaterplayRows aggregates renames and no-donor rows', () => {
  const rows = [
    { id: 'w1', name: 'Splash pad', lat: 40.0, lng: -74.0 }, // has donor
    { id: 'w2', name: 'Splash pad', lat: 41.0, lng: -75.0 }, // no donor nearby
    { id: 'w3', name: 'Water park', lat: 42.0, lng: -76.0 }, // has donor
  ]
  const donors = [
    { id: 'd1', name: 'Alpha Park', lat: 40.0 + NEAR, lng: -74.0 },
    { id: 'd3', name: 'Gamma Park', lat: 42.0 + NEAR, lng: -76.0 },
  ]
  const result = nameWaterplayRows(rows, donors, { maxDistanceM: 250 })
  assert.equal(result.genericCount, 3)
  assert.equal(result.renames.length, 2)
  assert.equal(result.noDonor, 1)
  assert.deepEqual(result.renames.map((r) => r.id).sort(), ['w1', 'w3'])
  assert.equal(result.renames.find((r) => r.id === 'w1').name, 'Splash pad at Alpha Park')
})

test('nameWaterplayRows respects a custom distance threshold', () => {
  const rows = [{ id: 'w1', name: 'Splash pad', lat: 40.0, lng: -74.0 }]
  const donors = [{ id: 'd1', name: 'Alpha Park', lat: 40.0 + FAR, lng: -74.0 }]
  assert.equal(nameWaterplayRows(rows, donors, { maxDistanceM: 250 }).renames.length, 0)
  assert.equal(nameWaterplayRows(rows, donors, { maxDistanceM: 500 }).renames.length, 1)
})

// --- Token-based generic detection (2026-07-21 second pass) ----------------
// The first prod pass matched only the two exact fallback labels; the audit
// found ~14 more purely-descriptive variants. A name is generic when EVERY
// token is a water-feature word; one real token makes it a proper name.

test('isGenericWaterplayName catches purely-descriptive variants', () => {
  for (const n of ['Sprayground', 'Splash Park', 'SplashPark', 'splashpad',
    'water sprinkler', 'water sprayground', 'Spray Pool', 'Spray Pad',
    'spray park', 'Spray & Play Park', 'Water Spray Playground', 'Wading Pool']) {
    assert.equal(isGenericWaterplayName(n), true, `${n} should be generic`)
  }
})

test('isGenericWaterplayName leaves proper names alone', () => {
  for (const n of ['Turtle Splash Water Park', 'Splashpad Texas', 'Splash Station',
    'Splash Country', 'SplashDown Waterpark', 'Splash! La Mirada Regional Aquatics Center',
    'Splash pad at Wright Park', 'WJ Thomas Splash Park', 'Sunny Hill Park Splash Pad']) {
    assert.equal(isGenericWaterplayName(n), false, `${n} should NOT be generic`)
  }
})

test('nameWaterplayRows ignores non-generic rows even when passed in', () => {
  const rows = [
    { id: 'w1', name: 'Sprayground', lat: 40.0, lng: -74.0 },
    { id: 'w2', name: 'Turtle Splash Water Park', lat: 40.0, lng: -74.0 },
  ]
  const donors = [{ id: 'd1', name: 'Alpha Park', lat: 40.0 + NEAR, lng: -74.0 }]
  const result = nameWaterplayRows(rows, donors, { maxDistanceM: 250 })
  assert.equal(result.genericCount, 1)
  assert.deepEqual(result.renames.map((r) => r.id), ['w1'])
  assert.equal(result.renames[0].name, 'Splash pad at Alpha Park')
})

// --- Park preference + revisit (Ballard Commons "The Cove" case) -----------

test('pickWaterplayName prefers a park donor over a nearer playground', () => {
  const row = { name: 'Splash pad', lat: 47.6703812, lng: -122.385191 }
  const donors = [
    { id: 'pg', name: 'The Cove', category: 'playground', lat: 47.6705965, lng: -122.3851347 },
    { id: 'pk', name: 'Ballard Commons Park', category: 'park', lat: 47.6705546, lng: -122.3854794 },
  ]
  const picked = pickWaterplayName(row, donors, 250)
  assert.equal(picked.donorId, 'pk')
  assert.equal(picked.name, 'Splash pad at Ballard Commons Park')
})

test('playground donor still used when no park is in range', () => {
  const row = { name: 'Splash pad', lat: 40.0, lng: -74.0 }
  const donors = [{ id: 'pg', name: 'Alpha Playground', category: 'playground', lat: 40.0 + NEAR, lng: -74.0 }]
  assert.equal(pickWaterplayName(row, donors, 250).name, 'Splash pad at Alpha Playground')
})

test('revisit recomputes composed names, skips unchanged, never counts them no-donor', () => {
  const rows = [
    { id: 'w1', name: 'Splash pad at The Cove', lat: 47.6703812, lng: -122.385191 },
    { id: 'w2', name: 'Splash pad at Alpha Park', lat: 40.0, lng: -74.0 }, // recomputes identically
    { id: 'w3', name: 'Splash pad at Orphan Park', lat: 10.0, lng: 10.0 }, // no donor anywhere
  ]
  const donors = [
    { id: 'pg', name: 'The Cove', category: 'playground', lat: 47.6705965, lng: -122.3851347 },
    { id: 'pk', name: 'Ballard Commons Park', category: 'park', lat: 47.6705546, lng: -122.3854794 },
    { id: 'd1', name: 'Alpha Park', category: 'park', lat: 40.0 + NEAR, lng: -74.0 },
  ]
  const off = nameWaterplayRows(rows, donors, { maxDistanceM: 250 })
  assert.equal(off.renames.length, 0) // composed names untouched without revisit

  const on = nameWaterplayRows(rows, donors, { maxDistanceM: 250, revisit: true })
  assert.deepEqual(on.renames.map((r) => r.id), ['w1'])
  assert.equal(on.renames[0].name, 'Splash pad at Ballard Commons Park')
  assert.equal(on.noDonor, 0) // w3 keeps its composed name, not counted donor-less
})
