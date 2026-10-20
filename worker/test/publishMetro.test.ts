import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain-JS script lib, no type declarations by design.
import { publishInSource } from '../scripts/lib/publishMetro.mjs'

const SRC = `
export const METROS = [
  metro('seattle', 'Seattle', 'WA', { south: 47.25, west: -122.5, north: 47.85, east: -122.05 }, { wave: true }),
  metro('detroit', 'Detroit', 'MI', { south: 42.0, west: -83.5, north: 42.75, east: -82.85 }),
  metro('miami', 'Miami', 'FL', { south: 25.5, west: -80.5, north: 26.4, east: -80.05 }, { wave: true, published: true }),
]
`

describe('publishInSource (deep-review H1)', () => {
  it('patches the opts object on a wave metro without touching the bbox', () => {
    const out = publishInSource(SRC, 'seattle')!
    expect(out).toContain(
      "metro('seattle', 'Seattle', 'WA', { south: 47.25, west: -122.5, north: 47.85, east: -122.05 }, { wave: true, published: true }),",
    )
  })

  it('appends a fresh opts object for a fast-follow metro with no opts — NOT into the bbox', () => {
    // The proven H1 regression: the old regex matched the LAST {...} before
    // the closing paren, which on a no-opts line is the contentBbox — so all
    // 37 fast-follow metros got `published: true` injected inside their bbox,
    // stayed unpublished, and the verify step aborted.
    const out = publishInSource(SRC, 'detroit')!
    expect(out).toContain(
      "metro('detroit', 'Detroit', 'MI', { south: 42.0, west: -83.5, north: 42.75, east: -82.85 }, { published: true }),",
    )
    // The bbox literal must be untouched.
    expect(out).not.toContain('east: -82.85, published')
  })

  it('is idempotent for an already-published metro', () => {
    expect(publishInSource(SRC, 'miami')).toBe(SRC)
  })

  it('returns null for an unknown metro so the caller can report it', () => {
    expect(publishInSource(SRC, 'atlantis')).toBeNull()
  })
})
