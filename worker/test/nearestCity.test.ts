import { describe, it, expect } from 'vitest'
import { CityDonorIndex, type CityDonor } from '../src/utils/nearestCity'

// ~0.0145° of latitude is a mile; longitude at SF's latitude is ~0.0183°/mi.
const MILE_LAT = 1 / 69
const at = (lat: number, lng: number, city: string): CityDonor => ({ lat, lng, city })

const BASE_LAT = 37.77
const BASE_LNG = -122.42
const north = (miles: number) => BASE_LAT + miles * MILE_LAT

describe('CityDonorIndex', () => {
  it('returns null with no donors at all', () => {
    expect(new CityDonorIndex([]).lookup(BASE_LAT, BASE_LNG)).toBeNull()
  })

  it('trusts a single very close donor', () => {
    const idx = new CityDonorIndex([at(north(0.2), BASE_LNG, 'Alameda')])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBe('Alameda')
  })

  it('takes the majority of the nearest donors', () => {
    const idx = new CityDonorIndex([
      at(north(1.0), BASE_LNG, 'Oakland'),
      at(north(1.2), BASE_LNG, 'Oakland'),
      at(north(1.4), BASE_LNG, 'Oakland'),
      at(north(1.6), BASE_LNG, 'Berkeley'),
      at(north(1.8), BASE_LNG, 'Berkeley'),
    ])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBe('Oakland')
  })

  // A point sitting exactly between two towns must not get a coin-flip city.
  it('returns null on a tie rather than guessing a boundary', () => {
    const idx = new CityDonorIndex([
      at(north(1.0), BASE_LNG, 'Oakland'),
      at(north(1.2), BASE_LNG, 'Berkeley'),
      at(north(1.4), BASE_LNG, 'Oakland'),
      at(north(1.6), BASE_LNG, 'Berkeley'),
    ])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBeNull()
  })

  it('ignores donors beyond the 3-mile radius', () => {
    const idx = new CityDonorIndex([at(north(6), BASE_LNG, 'Faraway')])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBeNull()
  })

  // The grid buckets by 0.05° cells; a donor in an adjacent cell must still be
  // seen, or rows near a cell edge would silently lose their neighbours.
  it('finds donors that fall in an adjacent grid cell', () => {
    const onEdge = Math.ceil(BASE_LAT / 0.05) * 0.05 // first latitude of the next cell
    const idx = new CityDonorIndex([at(onEdge + 0.001, BASE_LNG, 'Nextcell')])
    expect(idx.lookup(onEdge - 0.001, BASE_LNG)).toBe('Nextcell')
  })

  // A degree of longitude is only ~54 mi at 38°N, so 0.05° is ~2.7 mi — a
  // fixed 3x3 cell scan would miss a donor 2.95 mi due west of a point sitting
  // near its cell edge. The scan width has to follow the latitude.
  it('finds an east/west donor at the far edge of the radius', () => {
    const milesPerDegLng = 69 * Math.cos((BASE_LAT * Math.PI) / 180)
    const west = BASE_LNG - 2.95 / milesPerDegLng
    const idx = new CityDonorIndex([at(BASE_LAT, west, 'Westside')])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBe('Westside')
  })

  it('still excludes an east/west donor just beyond the radius', () => {
    const milesPerDegLng = 69 * Math.cos((BASE_LAT * Math.PI) / 180)
    const idx = new CityDonorIndex([at(BASE_LAT, BASE_LNG - 3.4 / milesPerDegLng, 'Toofar')])
    expect(idx.lookup(BASE_LAT, BASE_LNG)).toBeNull()
  })

  it('handles the southern/western hemisphere sign without cell aliasing', () => {
    const idx = new CityDonorIndex([at(-33.86, 151.2, 'Sydney')])
    expect(idx.lookup(-33.861, 151.201, )).toBe('Sydney')
  })
})
