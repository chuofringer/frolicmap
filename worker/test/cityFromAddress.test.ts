import { describe, it, expect } from 'vitest'
import { cityFromAddress } from '../src/utils/cityFromAddress'

describe('cityFromAddress', () => {
  it('takes the segment before a state code', () => {
    expect(cityFromAddress('1234 Main St, Alameda, CA 94501')).toBe('Alameda')
    expect(cityFromAddress('500 Fulton St, San Francisco, CA')).toBe('San Francisco')
    expect(cityFromAddress('10 Grand Army Plaza, Brooklyn, NY 11238-5600')).toBe('Brooklyn')
  })

  it('handles extra street/unit lines before the city', () => {
    expect(cityFromAddress('2000 Broadway, Suite 300, Oakland, CA 94612')).toBe('Oakland')
  })

  it('handles a city-first address with no street line', () => {
    expect(cityFromAddress('Palo Alto, CA 94301')).toBe('Palo Alto')
  })

  it('falls back to a trailing city when no state code is present', () => {
    expect(cityFromAddress('1234 Main St, Alameda')).toBe('Alameda')
    expect(cityFromAddress('1234 Main St, Alameda 94501')).toBe('Alameda')
  })

  // ICS `LOCATION` free text is full of "venue, room" — without a street line
  // in front, the trailing segment is a room/wing, not a city. Getting this
  // wrong is doubly bad: the bogus label would also become a donor for the
  // neighbour inference and spread to nearby events.
  it('does not mistake a room or wing for a city when there is no street line', () => {
    expect(cityFromAddress('Rinconada Library, Community Room')).toBeNull()
    expect(cityFromAddress('Oakland Museum of California, Great Hall')).toBeNull()
    expect(cityFromAddress('Main Library, Children’s Wing')).toBeNull()
  })

  // A wrong city is worse than none — the card just omits the segment.
  it('returns null rather than guessing', () => {
    expect(cityFromAddress(null)).toBeNull()
    expect(cityFromAddress('')).toBeNull()
    expect(cityFromAddress('Rinconada Library')).toBeNull()
    expect(cityFromAddress('1234 Main St')).toBeNull()
    expect(cityFromAddress('1234 Main St, 94501')).toBeNull()
    // A trailing country/state word is not a city.
    expect(cityFromAddress('1234 Main St, USA')).toBeNull()
    expect(cityFromAddress('1234 Main St, CA')).toBeNull()
    // "Suite 2B" must not get promoted when the segment before it is a street.
    expect(cityFromAddress('1234 Main St, Suite 2B')).toBeNull()
  })
})
