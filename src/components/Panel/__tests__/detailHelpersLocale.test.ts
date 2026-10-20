import { describe, it, expect, afterEach } from 'vitest'
import { formatDistanceMi } from '../detailHelpers'
import { i18next, loadLocale } from '@/i18n'

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('distance', () => {
  const origin: [number, number] = [-122.4, 37.77]

  it('stays in miles in both locales — US venues', async () => {
    const enOut = formatDistanceMi(origin, -122.42, 37.78)
    expect(enOut).toMatch(/^[\d.]+ mi from you$/)

    await loadLocale('zh')
    const zhOut = formatDistanceMi(origin, -122.42, 37.78)
    expect(zhOut).toContain('英里')
    // Same number, only the unit word + origin phrasing differ.
    const number = (s: string) => /[\d.]+/.exec(s)![0]
    expect(number(zhOut!)).toBe(number(enOut!))
  })
})
