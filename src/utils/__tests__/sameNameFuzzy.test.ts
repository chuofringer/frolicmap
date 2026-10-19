import { describe, it, expect } from 'vitest'
import { nameTokens, sameNameFuzzy } from '../sameNameFuzzy'

describe('nameTokens', () => {
  it('lowercases and splits on whitespace', () => {
    expect(nameTokens('Santa Clara County Fair')).toEqual(['santa', 'clara', 'county', 'fair'])
  })

  it('strips 4-digit years', () => {
    expect(nameTokens('Santa Clara County Fair 2026')).toEqual(['santa', 'clara', 'county', 'fair'])
  })

  it('treats punctuation as token separator', () => {
    expect(nameTokens('Knit & Crochet Circle')).toEqual(['knit', 'crochet', 'circle'])
    expect(nameTokens('Storytime — Toddlers')).toEqual(['storytime', 'toddlers'])
  })

  it('keeps unicode letters and digits', () => {
    expect(nameTokens('Niños Storytime 2')).toEqual(['niños', 'storytime', '2'])
  })

  it('returns empty array for empty / whitespace input', () => {
    expect(nameTokens('')).toEqual([])
    expect(nameTokens('   ')).toEqual([])
  })
})

describe('sameNameFuzzy', () => {
  describe('positive matches (intended dedup targets)', () => {
    it('collapses dated event vs venue with shared multi-word prefix and prefix-on-last token', () => {
      // The motivating case: dated fair + undated fairgrounds at the
      // same lat/lng. 3 shared tokens + "Fair" prefix of "Fairgrounds".
      expect(sameNameFuzzy('Santa Clara County Fair 2026', 'Santa Clara County Fairgrounds')).toBe(true)
    })

    it('treats year drift as same event', () => {
      expect(sameNameFuzzy('Santa Clara County Fair 2026', 'Santa Clara County Fair 2027')).toBe(true)
    })

    it('matches when one name is a token-prefix of a 3+-token other', () => {
      expect(sameNameFuzzy('Family Storytime', 'Family Storytime at Cupertino Library')).toBe(true)
    })

    it('matches with 3+ shared tokens regardless of total chars', () => {
      // 3 short tokens — passes on token count, not char length.
      expect(sameNameFuzzy('Itty Bitty Jam', 'Itty Bitty Jam Session')).toBe(true)
    })

    it('ignores punctuation differences', () => {
      expect(sameNameFuzzy('Knit & Crochet Circle', 'Knit Crochet Circle at Milpitas')).toBe(true)
    })
  })

  describe('negative matches (must NOT collapse)', () => {
    it('rejects generic 2-token city prefixes', () => {
      // "Bay Area" alone shouldn't swallow every "Bay Area X" event.
      expect(sameNameFuzzy('Bay Area', 'Bay Area Discovery Museum')).toBe(false)
      expect(sameNameFuzzy('San Francisco', 'San Francisco Symphony Concert')).toBe(false)
    })

    it('rejects 2-token names with shared prefix-on-last when total chars are short', () => {
      // "Family Story" prefix of "Family Storytime" — only 11 shared chars.
      expect(sameNameFuzzy('Family Story', 'Family Storytime')).toBe(false)
    })

    it('rejects single-token names even when equal', () => {
      // pickEarliestPerSource already collapses exact-name matches; the
      // fuzzy pass needs ≥2 shared tokens to fire.
      expect(sameNameFuzzy('Storytime', 'Storytime')).toBe(false)
      expect(sameNameFuzzy('Storytime', 'Storyteller')).toBe(false)
    })

    it('rejects when first token differs', () => {
      expect(sameNameFuzzy('Baby Storytime', 'Toddler Storytime')).toBe(false)
    })

    it('rejects when only 1 token matches and the next diverges', () => {
      expect(sameNameFuzzy('Family Storytime', 'Family Bookclub')).toBe(false)
    })

    it('rejects when shared prefix is only 2 short tokens', () => {
      // 2 tokens, 7 chars total — under the 15-char floor.
      expect(sameNameFuzzy('Bay Area', 'Bay Area Kids Festival')).toBe(false)
    })

    it('rejects empty / whitespace names', () => {
      expect(sameNameFuzzy('', 'Anything')).toBe(false)
      expect(sameNameFuzzy('Anything', '')).toBe(false)
      expect(sameNameFuzzy('   ', 'Storytime Sessions')).toBe(false)
    })
  })

  it('is symmetric', () => {
    const pairs: Array<[string, string]> = [
      ['Santa Clara County Fair 2026', 'Santa Clara County Fairgrounds'],
      ['Bay Area', 'Bay Area Discovery Museum'],
      ['Family Storytime', 'Family Storytime at Cupertino Library'],
      ['Baby Storytime', 'Toddler Storytime'],
    ]
    for (const [a, b] of pairs) {
      expect(sameNameFuzzy(a, b)).toBe(sameNameFuzzy(b, a))
    }
  })
})
