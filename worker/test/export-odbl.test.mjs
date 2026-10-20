import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUMNS, SELECT_SQL, README_TEXT, csvField, toCsv } from '../scripts/export-odbl.mjs'

test('csvField leaves plain values alone and writes numbers as-is', () => {
  assert.equal(csvField('Mission Dolores Park'), 'Mission Dolores Park')
  assert.equal(csvField(37.7596), '37.7596')
  assert.equal(csvField(0), '0')
})

test('csvField neutralises spreadsheet formula triggers with a leading apostrophe', () => {
  assert.equal(csvField('=HYPERLINK("http://evil.example")'), `"'=HYPERLINK(""http://evil.example"")"`)
  assert.equal(csvField('+cmd|calc'), "'+cmd|calc")
  assert.equal(csvField('-2+3'), "'-2+3")
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvField('  =1+1'), "'  =1+1")
  assert.equal(csvField('-Dash Park'), "'-Dash Park")
})

test('csvField keeps plain numbers numeric, including negative longitudes', () => {
  assert.equal(csvField(-122.4194), '-122.4194')
  assert.equal(csvField('-122.4194'), '-122.4194')
  assert.equal(csvField(' -122.4 '), ' -122.4 ')
  assert.equal(csvField('+15551234567'), '+15551234567')
  assert.equal(csvField('-1e-5'), '-1e-5')
  assert.equal(csvField('=1'), "'=1")
})

test('csvField maps null and undefined to an empty cell', () => {
  assert.equal(csvField(null), '')
  assert.equal(csvField(undefined), '')
})

test('csvField quotes commas, newlines and doubles embedded quotes', () => {
  assert.equal(csvField('Smith, Jane'), '"Smith, Jane"')
  assert.equal(csvField('The "Big" Park'), '"The ""Big"" Park"')
  assert.equal(csvField('line1\nline2'), '"line1\nline2"')
  assert.equal(csvField('a\r\nb'), '"a\r\nb"')
})

test('toCsv writes the header, then one CRLF-terminated line per row with nulls empty', () => {
  const csv = toCsv([
    { id: 'osm-node-1', name: 'A, B', category: 'park', lat: 1.5, lng: -2.25, address: null, website: undefined, source_url: 'https://www.openstreetmap.org/node/1', region: 'bay', last_verified: '2026-01-01T00:00:00Z' },
  ])
  assert.equal(
    csv,
    `${COLUMNS.join(',')}\r\nosm-node-1,"A, B",park,1.5,-2.25,,,https://www.openstreetmap.org/node/1,bay,2026-01-01T00:00:00Z\r\n`,
  )
  assert.equal(toCsv([]), `${COLUMNS.join(',')}\r\n`)
})

test('columns, query and README carry the ODbL requirements', () => {
  assert.equal(COLUMNS.join(','), 'id,name,category,lat,lng,address,website,source_url,region,last_verified')
  assert.match(SELECT_SQL, /status = 'approved'/)
  assert.match(SELECT_SQL, /source_type = 'osm'/)
  assert.match(README_TEXT, /Derived Database/)
  assert.match(README_TEXT, /© OpenStreetMap contributors/)
  assert.match(README_TEXT, /start(s)? with =, \+, - or @.*leading apostrophe/)
  assert.match(README_TEXT, /https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\//)
})
