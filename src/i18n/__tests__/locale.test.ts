import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  detectLocale,
  isAdminPath,
  redirectToStoredLocale,
  localeFromPath,
  localeBasename,
  localizedHref,
  localizedPath,
  storedLocale,
  storeLocale,
} from '../locale'

describe('localeFromPath', () => {
  it('reads the /zh prefix', () => {
    expect(localeFromPath('/zh')).toBe('zh')
    expect(localeFromPath('/zh/')).toBe('zh')
    expect(localeFromPath('/zh/cities/bay-area')).toBe('zh')
  })

  it('returns null for unprefixed paths', () => {
    expect(localeFromPath('/')).toBeNull()
    expect(localeFromPath('/cities/bay-area')).toBeNull()
    expect(localeFromPath('/signup')).toBeNull()
  })

  it('never treats "en" as a prefix — English is the root', () => {
    expect(localeFromPath('/en')).toBeNull()
  })

  it('does not match a metro slug that merely starts with the prefix', () => {
    // Guards the reserved-namespace assumption: no published metro slug is
    // `zh`, but one could start with those letters.
    expect(localeFromPath('/zhengzhou')).toBeNull()
  })
})

describe('localeBasename', () => {
  it('gives English no prefix so existing URLs are untouched', () => {
    expect(localeBasename('en')).toBeUndefined()
  })

  it('prefixes Chinese', () => {
    expect(localeBasename('zh')).toBe('/zh')
  })
})

describe('localizedHref', () => {
  const at = (href: string) => new URL(href)

  it('adds the prefix and keeps query and hash', () => {
    expect(localizedHref('zh', at('https://funradar.app/?item=pg-1#x')))
      .toBe('/zh/?item=pg-1#x')
  })

  it('strips the prefix going back to English', () => {
    expect(localizedHref('en', at('https://funradar.app/zh/?cat=playground')))
      .toBe('/?cat=playground')
  })

  it('preserves a deep path across the switch', () => {
    expect(localizedHref('zh', at('https://funradar.app/signup'))).toBe('/zh/signup')
    expect(localizedHref('en', at('https://funradar.app/zh/signup'))).toBe('/signup')
  })

  it('is idempotent when already in the target locale', () => {
    expect(localizedHref('zh', at('https://funradar.app/zh/?view=list')))
      .toBe('/zh/?view=list')
  })
})

describe('localizedPath (plain <a> links)', () => {
  // Plain anchors bypass the router basename, so every internal one has to
  // carry the prefix by hand. Getting this wrong drops a Chinese reader onto
  // an English page — which is what /cities, the city picker's per-metro
  // links, and the geolocation match all did.
  it('leaves English paths untouched', () => {
    expect(localizedPath('/cities', '/')).toBe('/cities')
    expect(localizedPath('/cities/seattle', '/cities/bay-area')).toBe('/cities/seattle')
  })

  it('carries the prefix through', () => {
    expect(localizedPath('/cities', '/zh/')).toBe('/zh/cities')
    expect(localizedPath('/cities/seattle', '/zh/cities/bay-area')).toBe('/zh/cities/seattle')
    expect(localizedPath('/', '/zh/cities/seattle')).toBe('/zh/')
  })

  it('is idempotent — an already-localised path is not prefixed twice', () => {
    // The real hazard: a caller forwards a path it read off the DOM, or
    // localises twice through a helper chain.
    expect(localizedPath('/zh/cities', '/zh/')).toBe('/zh/cities')
    expect(localizedPath(localizedPath('/cities', '/zh/'), '/zh/')).toBe('/zh/cities')
  })

  it('strips a stale prefix when the reader is now in English', () => {
    expect(localizedPath('/zh/cities', '/')).toBe('/cities')
  })
})

describe('detectLocale', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to English', () => {
    expect(detectLocale('/')).toBe('en')
  })

  it('prefers the URL over the stored preference, so shared links keep their language', () => {
    storeLocale('zh')
    expect(detectLocale('/')).toBe('zh')      // no prefix — stored wins
    expect(detectLocale('/zh/')).toBe('zh')
    storeLocale('en')
    expect(detectLocale('/zh/')).toBe('zh')   // prefix beats the stored 'en'
  })

  it('pins /admin to English regardless of stored preference', () => {
    storeLocale('zh')
    expect(detectLocale('/admin')).toBe('en')
    expect(detectLocale('/admin/behavior')).toBe('en')
  })
})

describe('storedLocale', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips', () => {
    expect(storedLocale()).toBeNull()
    storeLocale('zh')
    expect(storedLocale()).toBe('zh')
  })

  it('ignores a junk value rather than throwing', () => {
    localStorage.setItem('funradar.lang', 'klingon')
    expect(storedLocale()).toBeNull()
  })
})

describe('basename / URL agreement (the blank-page class of bug)', () => {
  // react-router renders NOTHING when its basename doesn't prefix the current
  // path. So whatever decides the basename must agree with the URL, always.
  // Testing `detectLocale` alone passes while this composition is broken — the
  // reason these assert on the pair.
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  const basenameFor = (pathname: string) =>
    localeBasename(localeFromPath(pathname) ?? 'en')

  it('never yields a basename the path does not start with', () => {
    for (const path of ['/', '/signup', '/cities/bay-area', '/admin', '/zh/', '/zh/signup']) {
      const base = basenameFor(path)
      if (base) expect(path.startsWith(base)).toBe(true)
    }
  })

  it('does NOT let a stored zh preference set the basename on an unprefixed URL', () => {
    storeLocale('zh')
    // This is the P0: detectLocale says 'zh' (correct — it is the *content*
    // locale), but the basename must still be undefined because the URL is '/'.
    expect(detectLocale('/')).toBe('zh')
    expect(basenameFor('/')).toBeUndefined()
  })
})

describe('redirectToStoredLocale', () => {
  const replace = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    replace.mockClear()
    window.history.pushState({}, '', '/')
  })

  it('sends a returning zh visitor from an unprefixed URL to their language', () => {
    storeLocale('zh')
    expect(redirectToStoredLocale(replace)).toBe(true)
    expect(replace).toHaveBeenCalledWith('/zh/')
  })

  it('preserves the path and query so our own /cities links survive', () => {
    storeLocale('zh')
    window.history.pushState({}, '', '/cities/bay-area?cat=playground')
    redirectToStoredLocale(replace)
    expect(replace).toHaveBeenCalledWith('/zh/cities/bay-area?cat=playground')
  })

  it('does not fire when the URL already states a locale — no redirect loop', () => {
    storeLocale('zh')
    window.history.pushState({}, '', '/zh/')
    expect(redirectToStoredLocale(replace)).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not fire for a stored English preference', () => {
    storeLocale('en')
    expect(redirectToStoredLocale(replace)).toBe(false)
  })

  it('does not fire with no stored preference — crawlers and first visits are untouched', () => {
    expect(redirectToStoredLocale(replace)).toBe(false)
  })

  it('never redirects admin, prefixed or not', () => {
    storeLocale('zh')
    for (const path of ['/admin', '/admin/behavior']) {
      window.history.pushState({}, '', path)
      expect(redirectToStoredLocale(replace)).toBe(false)
    }
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('isAdminPath', () => {
  it('recognises admin behind a locale prefix', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/behavior')).toBe(true)
    expect(isAdminPath('/zh/admin')).toBe(true)
    expect(isAdminPath('/zh/admin/behavior')).toBe(true)
  })

  it('leaves the public map alone', () => {
    expect(isAdminPath('/')).toBe(false)
    expect(isAdminPath('/zh/')).toBe(false)
    expect(isAdminPath('/administrator-park')).toBe(false)
  })

  it('pins /zh/admin to English', () => {
    expect(detectLocale('/zh/admin')).toBe('en')
  })
})

