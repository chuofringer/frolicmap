import { describe, it, expect } from 'vitest'
import { buildMapsUrls } from '../mapsUrls'

const place = { name: 'Cal Academy', lat: 37.7699, lng: -122.4661 }

describe('buildMapsUrls', () => {
  it('uses the place-view (search) scheme, not directions', () => {
    const { google, apple } = buildMapsUrls(place, '55 Music Concourse Dr, San Francisco, CA')
    expect(google).toContain('https://www.google.com/maps/search/?api=1&query=')
    expect(google).not.toContain('/maps/dir/')
    expect(apple).toContain('https://maps.apple.com/?q=')
    expect(apple).not.toContain('daddr=')
  })

  it('place with address → Google name + address query, Apple q + coord sll anchor', () => {
    const { google, apple } = buildMapsUrls(place, '55 Music Concourse Dr, San Francisco, CA')
    const expected = encodeURIComponent('Cal Academy, 55 Music Concourse Dr, San Francisco, CA')
    // Google form is unchanged — name + address is globally unambiguous.
    expect(google).toBe(`https://www.google.com/maps/search/?api=1&query=${expected}`)
    // Apple appends the documented "search near" coordinate anchor.
    expect(apple).toBe(`https://maps.apple.com/?q=${expected}&sll=37.7699,-122.4661`)
  })

  it('place without address → Google @-anchored path form, Apple name + coord sll', () => {
    const { google, apple } = buildMapsUrls(place, null)
    const name = encodeURIComponent('Cal Academy')
    // No address: Google uses the viewport-anchored path form so the search
    // biases to the place's exact area, not near the user.
    expect(google).toBe(`https://www.google.com/maps/search/${name}/@37.7699,-122.4661,15z`)
    // lat/lng present in the anchor.
    expect(google).toContain('/@37.7699,-122.4661,15z')
    // Apple keeps the name-only query but anchors with sll.
    expect(apple).toBe(`https://maps.apple.com/?q=${name}&sll=37.7699,-122.4661`)
  })

  it('place with empty-string address → treated as absent (identical to null case)', () => {
    // Prod D1 has rows with address='' (not null); the detail payload's `?? null` lets
    // '' through, so a blank address must take the anchored fallback rather than
    // produce a trailing-comma "Name, " query.
    const empty = buildMapsUrls(place, '')
    const nul = buildMapsUrls(place, null)
    expect(empty.google).toBe(nul.google)
    expect(empty.apple).toBe(nul.apple)
    expect(empty.google).not.toContain('%2C%20') // no trailing ", "
  })

  it('URL-encodes spaces and commas', () => {
    const { google } = buildMapsUrls(place, '1 A St, City')
    expect(google).toContain('Cal%20Academy%2C%201%20A%20St%2C%20City')
  })
})
