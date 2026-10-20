import { describe, it, expect, afterEach } from 'vitest'
import { i18next, loadLocale } from '@/i18n'
import { displayTitle, titleHaystack } from '../displayTitle'

const ggp = { name: 'Golden Gate Park', name_zh: '金门公园' }

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('displayTitle', () => {
  it('keeps the English title in English, with nothing underneath', () => {
    expect(displayTitle(ggp, 'en')).toEqual({ title: 'Golden Gate Park', subtitle: null })
  })

  // The whole point of the pairing: the English name is what a parent types
  // into Maps, so a Chinese title never replaces it outright.
  it('leads with the Chinese title and keeps English as the subtitle', () => {
    expect(displayTitle(ggp, 'zh')).toEqual({ title: '金门公园', subtitle: 'Golden Gate Park' })
  })

  it('falls back to English when a row has no translation', () => {
    for (const name_zh of [null, undefined, '   ']) {
      expect(displayTitle({ name: 'Bounce Zone', name_zh }, 'zh')).toEqual({
        title: 'Bounce Zone',
        subtitle: null,
      })
    }
  })

  // What a translator leaves on a name that shouldn't change. Echoing it twice
  // reads as a rendering bug, not as helpful.
  it('adds no subtitle when the translation matches the English name', () => {
    expect(displayTitle({ name: 'YMCA', name_zh: 'YMCA' }, 'zh')).toEqual({
      title: 'YMCA',
      subtitle: null,
    })
  })

  it('trims a padded translation', () => {
    expect(displayTitle({ name: 'Golden Gate Park', name_zh: ' 金门公园 ' }, 'zh').title).toBe('金门公园')
  })

  it('defaults to the active locale', async () => {
    expect(displayTitle(ggp).title).toBe('Golden Gate Park')
    await loadLocale('zh')
    expect(displayTitle(ggp).title).toBe('金门公园')
  })
})

describe('titleHaystack', () => {
  // Locale-independent on purpose: a venue findable in one language and
  // invisible in the other is the failure this exists to prevent.
  it('offers both names regardless of locale', () => {
    expect(titleHaystack(ggp)).toEqual(['Golden Gate Park', '金门公园'])
  })

  it('offers just the English name when there is no distinct translation', () => {
    expect(titleHaystack({ name: 'Bounce Zone', name_zh: null })).toEqual(['Bounce Zone'])
    expect(titleHaystack({ name: 'YMCA', name_zh: 'YMCA' })).toEqual(['YMCA'])
  })
})
