import { describe, it, expect } from 'vitest'
import { CATEGORIES } from '@/config/categories'
import { CATEGORY_COLOR_EXPR, EMOJI_ICON_EXPR } from '../pinExpressions'
import { EMOJI_ICON_FALLBACK_ID, emojiIconId } from '../emojiIcons'

// The pin glyph is an icon IMAGE, never a text glyph: MapLibre shapes an
// emoji `text-field` with Latin line metrics and it lands off-centre in the
// pin circle (museum 🏛️, library 📚 worst). See emojiIcons.ts.
describe('map pin icon expression', () => {
  const expr = EMOJI_ICON_EXPR as unknown as unknown[]

  it('maps every category to its emoji-* image id plus a fallback', () => {
    expect(expr.slice(0, 2)).toEqual(['match', ['get', 'category']])
    for (const cat of Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]) {
      const i = expr.indexOf(cat)
      expect(i).toBeGreaterThan(1)
      expect(expr[i + 1]).toBe(emojiIconId(cat))
    }
    expect(expr).toHaveLength(2 + Object.keys(CATEGORIES).length * 2 + 1)
    expect(expr[expr.length - 1]).toBe(EMOJI_ICON_FALLBACK_ID)
  })

  it('never puts a raw emoji (text glyph) in the expression', () => {
    for (const e of expr) {
      if (typeof e === 'string') expect(e).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  it('does not alter the colour expression', () => {
    expect(JSON.stringify(CATEGORY_COLOR_EXPR)).toContain(CATEGORIES.museum.color)
  })
})
