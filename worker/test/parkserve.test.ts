import { describe, it, expect } from 'vitest'
import {
  PS_FIELDS, PS_WHERE, PS_OPEN_ACCESS, PS_VISITABLE_STATUS,
  parkserveId, parkserveFeatureToItem,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/parkserve.mjs'
import { metroForCoords } from '@shared/metros'

const TIER = { status: 'approved' as const, confidence: 'medium' as const }

// Zilker Park, Austin.
const feature = (attrs: Record<string, unknown> = {}, centroid: unknown = { x: -97.7431, y: 30.2672 }) => ({
  attributes: {
    [PS_FIELDS.id]: 'TX_Austin_00123',
    [PS_FIELDS.name]: 'Zilker Metropolitan Park',
    [PS_FIELDS.designation]: 'LP',
    [PS_FIELDS.owner]: 'CITY',
    [PS_FIELDS.access]: 3,
    [PS_FIELDS.status]: 'Open',
    [PS_FIELDS.acres]: 351.256789,
    [PS_FIELDS.address]: '2100 Barton Springs Rd',
    [PS_FIELDS.city]: 'AUSTIN',
    [PS_FIELDS.zip]: '78704',
    ...attrs,
  },
  centroid,
})

describe('ParkServe field mapping', () => {
  it('maps a park into an Item with a normalised source-native id', () => {
    const { row } = parkserveFeatureToItem(feature(), metroForCoords, TIER)
    expect(row).toMatchObject({
      id: 'parkserve-tx-austin-00123',
      category: 'park',
      source_type: 'parkserve',
      region: 'austin',
      city: 'Austin',
      indoor: 0,
      cost: 'free',
      confidence: 'medium',
      status: 'approved',
    })
    expect(row.name).toBe('Zilker Metropolitan Park')
    expect(row.address).toBe('2100 Barton Springs Rd, Austin, 78704')
  })

  it('normalises ids to the same shape as the OSM/IMLS ids', () => {
    expect(parkserveId('TX_Austin_00123')).toBe('parkserve-tx-austin-00123')
    expect(parkserveId('  Weird / ID!  ')).toBe('parkserve-weird-id')
    expect(parkserveId('')).toBeNull()
    expect(parkserveId(null)).toBeNull()
  })

  it('carries acreage, designation and owner into attributes', () => {
    // Plan §2.1 row 4 scopes ParkServe to "centroids + amenity flags only".
    // A JSON blob (rather than columns) is what lets the ZIP download's
    // playground flag be grafted on later without touching row identity.
    const { row } = parkserveFeatureToItem(feature(), metroForCoords, TIER)
    expect(row.attributes).toEqual({ acres: 351.26, designation: 'LP', owner: 'CITY' })
  })

  it('drops the service\'s single-space "no value" sentinel', () => {
    const { row } = parkserveFeatureToItem(
      feature({ [PS_FIELDS.designation]: ' ', [PS_FIELDS.owner]: ' ' }), metroForCoords, TIER,
    )
    expect(row.attributes).toEqual({ acres: 351.26 })
  })

  it('drops an UNKNOWN owner rather than storing the word', () => {
    const { row } = parkserveFeatureToItem(feature({ [PS_FIELDS.owner]: 'UNKNOWN' }), metroForCoords, TIER)
    expect(row.attributes.owner).toBeUndefined()
  })

  it('maps OpenFee to a paid park', () => {
    expect(parkserveFeatureToItem(feature({ [PS_FIELDS.status]: 'OpenFee' }), metroForCoords, TIER).row.cost).toBe('paid')
    expect(parkserveFeatureToItem(feature(), metroForCoords, TIER).row.cost).toBe('free')
  })
})

describe('ParkServe filtering', () => {
  it('keeps only Open Access (3)', () => {
    // The documentation is explicit: access 3 is "Open Access", and other
    // values "only remain in the database" for legacy reasons.
    expect(PS_OPEN_ACCESS).toBe(3)
    for (const a of [1, 2, 4]) {
      expect(parkserveFeatureToItem(feature({ [PS_FIELDS.access]: a }), metroForCoords, TIER).skipped)
        .toMatch(/^access /)
    }
  })

  it('keeps Open and OpenFee, drops Closed', () => {
    expect(PS_VISITABLE_STATUS).toEqual(new Set(['Open', 'OpenFee']))
    expect(parkserveFeatureToItem(feature({ [PS_FIELDS.status]: 'Closed' }), metroForCoords, TIER).skipped)
      .toBe('status Closed')
  })

  it('filters server-side so national scale never lands on the client', () => {
    expect(PS_WHERE).toContain('Park_Acces=3')
    expect(PS_WHERE).toContain("Park_Statu IN ('Open','OpenFee')")
  })

  it('skips unnamed parks and parks with no ParkID', () => {
    expect(parkserveFeatureToItem(feature({ [PS_FIELDS.name]: '' }), metroForCoords, TIER).skipped).toBe('no name')
    expect(parkserveFeatureToItem(feature({ [PS_FIELDS.id]: '' }), metroForCoords, TIER).skipped).toBe('no ParkID')
  })

  it('defers parks outside every metro bbox', () => {
    const r = parkserveFeatureToItem(feature({}, { x: -99.5, y: 41.5 }), metroForCoords, TIER)
    expect(r.skipped).toBe('outside every metro bbox')
  })

  it('skips the Bay region by default so the curated Bay park layer is not double-pinned', () => {
    const sf = feature({}, { x: -122.4194, y: 37.7749 })
    expect(parkserveFeatureToItem(sf, metroForCoords, { ...TIER, skipRegions: new Set(['bay']) }).skipped)
      .toBe('bay region (curated separately)')
    expect(parkserveFeatureToItem(sf, metroForCoords, TIER).row.region).toBe('bay')
  })
})

describe('ParkServe coordinate safety', () => {
  it('rejects a Web Mercator centroid instead of writing metres into a lat column', () => {
    // The service defaults to Web Mercator; forgetting `outSR=4326` yields
    // x/y in metres. Latitude can't exceed 90, so this fails loudly.
    const r = parkserveFeatureToItem(feature({}, { x: -10890859.9, y: 3533463.8 }), metroForCoords, TIER)
    expect(r.skipped).toMatch(/WGS84/)
  })

  it('skips a missing or null-island centroid', () => {
    // `null`, not `undefined` — an undefined argument would trigger the
    // helper's default parameter and silently test the happy path.
    expect(parkserveFeatureToItem(feature({}, null), metroForCoords, TIER).skipped).toBe('no centroid')
    expect(parkserveFeatureToItem(feature({}, { x: 0, y: 0 }), metroForCoords, TIER).skipped).toBe('no centroid')
  })
})
