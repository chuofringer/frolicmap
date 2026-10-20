import { describe, it, expect } from 'vitest'
import { CATEGORIES } from '@/config/categories'
import { CATEGORY_COLOR_EXPR, EMOJI_EXPR, stripVariationSelectors } from '../pinExpressions'

// MapLibre shapes U+FE0F as its own advance-bearing glyph, which pushes the
// emoji off-centre in the pin circle (museum 🏛️, beach 🏖️, campground 🏕️).
describe('map pin emoji expression', () => {
  const expr = EMOJI_EXPR as unknown as unknown[]
  const strings = expr.filter((e): e is string => typeof e === 'string')

  it('contains no U+FE0F variation selector anywhere', () => {
    expect(JSON.stringify(expr)).not.toContain('️')
    for (const s of strings) expect(s).not.toContain('️')
  })

  it('still maps every category to its emoji (selector aside) plus a fallback', () => {
    expect(expr.slice(0, 2)).toEqual(['match', ['get', 'category']])
    for (const [cat, meta] of Object.entries(CATEGORIES)) {
      const i = expr.indexOf(cat)
      expect(i).toBeGreaterThan(1)
      expect(expr[i + 1]).toBe(meta.emoji.replace(/️/g, ''))
      expect((expr[i + 1] as string).length).toBeGreaterThan(0)
    }
    expect(expr).toHaveLength(2 + Object.keys(CATEGORIES).length * 2 + 1)
  })

  it('leaves the config strings (legend/chips) untouched', () => {
    // The selector must survive in the DOM-facing config.
    expect(CATEGORIES.museum.emoji).toContain('️')
    expect(stripVariationSelectors(CATEGORIES.museum.emoji)).toBe('\u{1F3DB}')
  })

  it('does not alter the colour expression', () => {
    expect(JSON.stringify(CATEGORY_COLOR_EXPR)).toContain(CATEGORIES.museum.color)
  })
})
