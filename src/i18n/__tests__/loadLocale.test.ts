import { describe, it, expect, beforeEach } from 'vitest'
import { loadLocale } from '..'

describe('loadLocale document metadata (#693)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en'
    document.title = 'Original'
  })

  it('sets lang=zh-Hans and the generic zh title on an unlocalised shell', async () => {
    await loadLocale('zh')
    expect(document.documentElement.lang).toBe('zh-Hans')
    expect(document.title).toBe('亲子活动地图 | frolicmap')
    await loadLocale('en')
  })

  it('keeps a prerendered zh page’s per-metro title', async () => {
    document.documentElement.lang = 'zh-Hans'
    document.title = '西雅图亲子活动地图'
    await loadLocale('zh')
    expect(document.title).toBe('西雅图亲子活动地图')
    expect(document.documentElement.lang).toBe('zh-Hans')
    await loadLocale('en')
  })

  it('resets lang to en for English and leaves the title alone', async () => {
    await loadLocale('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Original')
  })
})
