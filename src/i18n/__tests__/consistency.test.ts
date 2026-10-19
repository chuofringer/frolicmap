import { describe, it, expect } from 'vitest'
import { en } from '../en'
import { zh } from '../zh'

/**
 * Cross-surface translation consistency.
 *
 * The resource tree is split per domain so parallel work never edits the same
 * file — which is exactly why the same English sentence can end up on two
 * surfaces, translated twice, differently. `signup.heading` and
 * `pages.signup.heading` are both "Newsletter launching soon" in English; they
 * rendered as two different Chinese sentences until this test existed.
 *
 * The rule: **if two keys say the same thing in English, they must say the
 * same thing in every other language.** Where the surfaces genuinely need
 * different copy, the English differs too, and this test says nothing.
 */
const leaves = (o: unknown, p: string[] = []): [string, unknown][] =>
  typeof o === 'object' && o !== null
    ? Object.entries(o).flatMap(([k, v]) => leaves(v, [...p, k]))
    : [[p.join('.'), o]]

const EN = Object.fromEntries(leaves(en)) as Record<string, string>
const ZH = Object.fromEntries(leaves(zh)) as Record<string, string>

describe('shared English strings share their translation', () => {
  it('has no English sentence rendered two different ways in Chinese', () => {
    const byEnglish = new Map<string, string[]>()
    for (const [key, value] of Object.entries(EN)) {
      // Short tokens (…, ✓) and interpolation-only strings aren't sentences.
      if (typeof value !== 'string' || value.trim().length < 4) continue
      byEnglish.set(value, [...(byEnglish.get(value) ?? []), key])
    }

    const inconsistent: string[] = []
    for (const [english, keys] of byEnglish) {
      if (keys.length < 2) continue
      const renderings = new Set(keys.map((k) => ZH[k]))
      if (renderings.size > 1) {
        inconsistent.push(
          `"${english}"\n` + keys.map((k) => `    ${k} → ${ZH[k]}`).join('\n'),
        )
      }
    }

    expect(inconsistent).toEqual([])
  })
})
