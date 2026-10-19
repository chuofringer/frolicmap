import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { i18next, loadLocale, intlLocale } from '..'
import { categoryLabel } from '@/config/categories'
import { CATEGORY_ORDER } from '@/config/categories'
import { en } from '../en'
import { zh } from '../zh'

function Probe() {
  const { t } = useTranslation()
  return <span data-testid="probe">{t('categories.playground')}</span>
}

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('locale switching', () => {
  it('renders English by default — which is why the rest of the suite needs no i18n wrapper', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('Playground')
  })

  it('renders Chinese after loadLocale', async () => {
    await loadLocale('zh')
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('儿童游乐场')
  })

  it('flips <html lang> so screen readers and crawlers agree with the content', async () => {
    await loadLocale('zh')
    expect(document.documentElement.lang).toBe('zh-Hans')
    await loadLocale('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('reports the right BCP-47 tag for Intl formatting', async () => {
    expect(intlLocale()).toBe('en-US')
    await loadLocale('zh')
    expect(intlLocale()).toBe('zh-CN')
  })
})

describe('translation completeness', () => {
  // `tsc` already enforces this structurally (each zh slice is typed
  // `Translation['<domain>']`). This catches the runtime shape too — an empty
  // string passes the type check but renders as a blank label.
  const leaves = (obj: unknown, path: string[] = []): [string, unknown][] =>
    typeof obj === 'object' && obj !== null
      ? Object.entries(obj).flatMap(([k, v]) => leaves(v, [...path, k]))
      : [[path.join('.'), obj]]

  it('has no empty or whitespace-only Chinese strings', () => {
    const blank = leaves(zh).filter(([, v]) => typeof v === 'string' && v.trim() === '')
    expect(blank.map(([k]) => k)).toEqual([])
  })

  it('covers every English key', () => {
    const enKeys = leaves(en).map(([k]) => k).sort()
    const zhKeys = leaves(zh).map(([k]) => k).sort()
    expect(zhKeys).toEqual(enKeys)
  })

  it('translates every category — the legend vocabulary is the one list that must never fall back', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(zh.categories[cat]).toBeTruthy()
      expect(zh.categories[cat]).not.toBe(en.categories[cat])
    }
  })

  it('resolves category labels through the active locale', async () => {
    expect(categoryLabel('library')).toBe('Library')
    await loadLocale('zh')
    expect(categoryLabel('library')).toBe('图书馆')
  })
})
