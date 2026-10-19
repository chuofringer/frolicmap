// worker/test/normalizeAddress.test.mjs
// Coverage for issue #307: the parse-address-backed structured normalizer
// replacing the old hand-rolled abbreviation regex. Uses node --test (not
// Vitest) — same pattern as dedupCluster.test.mjs, pure string transform.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAddress } from '../scripts/lib/normalizeAddress.mjs'

test('normalizeAddress collapses street-type abbreviation variants', () => {
  const a = normalizeAddress('2000 Bunker Rd, Sausalito, CA 94965')
  const b = normalizeAddress('2000 Bunker Road, Sausalito, CA')
  const c = normalizeAddress('2000 Bunker Rd. Sausalito CA 94965')
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(a, '2000 bunker rd')
})

test('normalizeAddress — issue #307 motivating example: suite-bearing row with no city matches the full row', () => {
  // "2625 Homestead Rd Suite A" — no comma segments, no city/state/zip at
  // all. Under the old regex pass this failed to match the row with city
  // (docstring includes city in the key), which is the exact false
  // negative #307 reports. The structured parser strips the secondary
  // unit (Suite A) and the key excludes city, so both sides match.
  const withCity = normalizeAddress('2625 Homestead Road, Santa Clara, CA 95051')
  const suiteNoCity = normalizeAddress('2625 Homestead Rd Suite A')
  assert.equal(withCity, suiteNoCity)
  assert.equal(withCity, '2625 homestead rd')
})

test('normalizeAddress is case-insensitive and tolerates a missing comma before the state', () => {
  const a = normalizeAddress('2625 Homestead Road, Santa Clara, CA 95051')
  const b = normalizeAddress('2625 HOMESTEAD ROAD, SANTA CLARA CA')
  assert.equal(a, b)
})

test('normalizeAddress strips a venue-name prefix before the numbered street segment', () => {
  const withVenue = normalizeAddress('Classic Bowling Center, 900 King Drive, Daly City, CA')
  const bare = normalizeAddress('900 King Dr, Daly City, CA')
  assert.equal(withVenue, bare)
  assert.equal(withVenue, '900 king dr')
})

test('normalizeAddress normalizes directional prefixes (N vs North)', () => {
  const abbrev = normalizeAddress('1301 7th Ave N, St. Cloud, MN 56303')
  const full = normalizeAddress('1301 7th Avenue North, St Cloud, MN')
  assert.equal(abbrev, full)
})

test('normalizeAddress returns null for venue-name-only addresses with no street number', () => {
  assert.equal(normalizeAddress('Slide Ranch, Muir Beach, CA'), null)
  assert.equal(normalizeAddress('Eucalyptus Grove, Stanford University, Stanford, CA'), null)
})

test('normalizeAddress returns null for non-string / empty input', () => {
  assert.equal(normalizeAddress(null), null)
  assert.equal(normalizeAddress(undefined), null)
  assert.equal(normalizeAddress(''), null)
  assert.equal(normalizeAddress('   '), null)
})

test('normalizeAddress distinguishes genuinely different street numbers', () => {
  const a = normalizeAddress('2625 Homestead Road, Santa Clara, CA')
  const b = normalizeAddress('2627 Homestead Road, Santa Clara, CA')
  assert.notEqual(a, b)
})
