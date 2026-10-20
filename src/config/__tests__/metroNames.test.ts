import { describe, it, expect, afterEach } from 'vitest'
import { metroName, metroShortName } from '../metroNames'
import { loadLocale, i18next } from '@/i18n'
import { getMetro } from '@shared/metros'

const bay = getMetro('bay')!
const nyc = getMetro('new-york')!

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('metroName', () => {
  it('is the registry label in English', () => {
    expect(metroName(bay)).toBe(bay.label)
  })

  it('is the translated name in Chinese', async () => {
    await loadLocale('zh')
    expect(metroName(bay)).toBe('旧金山湾区')
    expect(metroName(nyc)).toBe('纽约')
  })
})

describe('metroShortName', () => {
  it('uses the registry shortLabel in English, NOT the locale table', () => {
    // The English `names` map carries each metro's LONG label, so a naive
    // t(..., { defaultValue: shortLabel }) would return "San Francisco Bay
    // Area" here and overflow the picker trigger box.
    expect(metroShortName(bay)).toBe('SF Bay Area')
    expect(metroShortName(bay)).not.toBe(bay.label)
  })

  it('falls back to label when a metro has no shortLabel', () => {
    const noShort = { ...nyc, shortLabel: undefined }
    expect(metroShortName(noShort)).toBe(nyc.label)
  })

  it('uses the translated name in Chinese', async () => {
    await loadLocale('zh')
    expect(metroShortName(bay)).toBe('旧金山湾区')
  })
})

describe('fallback for untranslated metros', () => {
  it('renders the English label rather than the raw key', async () => {
    await loadLocale('zh')
    // A metro id with no entry in zh/metro.ts::names must not surface
    // "metro.names.<id>" to a user — adding a metro should never be blocked
    // on translating it.
    const fake = { ...bay, id: 'not-a-real-metro', label: 'Nowhere', shortLabel: undefined }
    expect(metroName(fake)).toBe('Nowhere')
    expect(metroShortName(fake)).toBe('Nowhere')
  })
})
