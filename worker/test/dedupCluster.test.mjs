// Coverage for the name-token primitives behind the place dedup
// (lib/dedupCluster.mjs, consumed by lib/dedupPlaces.mjs). node:test, no
// Miniflare needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameTokens, tokenJaccard } from '../scripts/lib/dedupCluster.mjs'

test('nameTokens lowercases, strips non-alphanumeric, drops stopwords + short tokens', () => {
  assert.deepEqual([...nameTokens('Golden Gate Park!')].sort(), ['gate', 'golden', 'park'])
  assert.deepEqual([...nameTokens('a the of for at in on')], [])  // all stopwords
  assert.deepEqual([...nameTokens('A B C')], [])                  // all 1-char
  assert.deepEqual([...nameTokens(null)], [])
})

test('nameTokens drops lone digits and year tokens (placeNameTokens restores them)', () => {
  assert.deepEqual([...nameTokens('PS 1')], ['ps'])
  assert.deepEqual([...nameTokens('Park 2026')], ['park'])
})

test('tokenJaccard handles overlap and disjoint sets', () => {
  const a = nameTokens('Washington Square Park')
  const b = nameTokens('Washington Park Playground')
  // a={washington,square,park}, b={washington,park,playground} → overlap=2, union=4 → 0.5
  assert.equal(tokenJaccard(a, b).toFixed(2), '0.50')
  assert.equal(tokenJaccard(nameTokens(''), nameTokens('foo')), 0)
})
