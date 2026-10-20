import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  METRO_STORAGE_KEY,
  isHomeLocation,
  storedHomeTarget,
  resolveHomeTarget,
  storeMetroSlug,
  storedMetroSlug,
} from '../useHomeMetroRedirect'

const whereResponse = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch

const setUrl = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setUrl('/')
})
afterEach(() => setUrl('/'))

describe('isHomeLocation', () => {
  it('is true only for the bare home page in either locale', () => {
    for (const p of ['/', '/zh', '/zh/']) expect(isHomeLocation({ pathname: p, search: '', hash: '' }), p).toBe(true)
    for (const p of ['/cities', '/cities/seattle', '/zh/cities/seattle', '/privacy', '/zh/privacy']) {
      expect(isHomeLocation({ pathname: p, search: '', hash: '' }), p).toBe(false)
    }
    // Deep links with an item or filter are never redirected.
    expect(isHomeLocation({ pathname: '/', search: '?item=abc', hash: '' })).toBe(false)
  })
})

describe('storedMetroSlug', () => {
  it('only returns a published metro slug', () => {
    storeMetroSlug('seattle')
    expect(localStorage.getItem(METRO_STORAGE_KEY)).toBe('seattle')
    expect(storedMetroSlug()).toBe('seattle')
    localStorage.setItem(METRO_STORAGE_KEY, 'detroit') // unpublished
    expect(storedMetroSlug()).toBeNull()
    localStorage.setItem(METRO_STORAGE_KEY, '<script>')
    expect(storedMetroSlug()).toBeNull()
  })
})

describe('storedHomeTarget', () => {
  const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

  it('sends / to the stored metro as an unprefixed router path (the basename adds /zh)', () => {
    storeMetroSlug('boston')
    expect(storedHomeTarget(at('/'))).toBe('/cities/boston')
    // Inside the /zh router the pathname is already basename-relative ('/'),
    // and a full URL still being /zh/ is the same home page.
    expect(storedHomeTarget(at('/zh/'))).toBe('/cities/boston')
  })

  it('does nothing without a stored choice, off the home page, or on a deep link', () => {
    expect(storedHomeTarget(at('/'))).toBeNull()
    storeMetroSlug('boston')
    expect(storedHomeTarget(at('/cities/seattle'))).toBeNull()
    expect(storedHomeTarget(at('/', '?item=abc'))).toBeNull()
    expect(storedHomeTarget(at('/', '', '#x'))).toBeNull()
  })

  it('skips crawlers', () => {
    storeMetroSlug('boston')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (compatible; Googlebot/2.1)')
    expect(storedHomeTarget(at('/'))).toBeNull()
    vi.restoreAllMocks()
  })
})

describe('resolveHomeTarget', () => {
  it('opens and stores the metro the edge reports', async () => {
    const f = whereResponse({ lat: 47.6, lng: -122.33, city: 'Seattle', region: 'Washington' })
    expect(await resolveHomeTarget(f)).toBe('/cities/seattle')
    expect(localStorage.getItem(METRO_STORAGE_KEY)).toBe('seattle')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('opens the city list when the edge has no location', async () => {
    expect(await resolveHomeTarget(whereResponse({ lat: null, lng: null, city: null, region: null }))).toBe('/cities')
    expect(localStorage.getItem(METRO_STORAGE_KEY)).toBeNull()
  })

  it('opens the city list when no published metro is in range', async () => {
    expect(await resolveHomeTarget(whereResponse({ lat: 41.5, lng: -99.5, city: 'X', region: 'Nebraska' }))).toBe('/cities')
  })

  it('opens the city list when the request fails or is non-2xx', async () => {
    expect(await resolveHomeTarget(vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch)).toBe('/cities')
    sessionStorage.clear()
    expect(await resolveHomeTarget(whereResponse({}, false))).toBe('/cities')
  })

  it('asks the edge once per session', async () => {
    const f = whereResponse({ lat: null, lng: null })
    expect(await resolveHomeTarget(f)).toBe('/cities')
    expect(await resolveHomeTarget(f)).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('never calls the edge when a choice is stored, off the home page, or for crawlers', async () => {
    const f = whereResponse({ lat: 47.6, lng: -122.33 })
    storeMetroSlug('chicago')
    expect(await resolveHomeTarget(f)).toBeNull()
    localStorage.clear()
    setUrl('/cities/seattle')
    expect(await resolveHomeTarget(f)).toBeNull()
    setUrl('/')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (compatible; Googlebot/2.1)')
    expect(await resolveHomeTarget(f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('does not redirect if the user navigated or picked a city while the request was in flight', async () => {
    let release!: (r: unknown) => void
    const f = vi.fn().mockReturnValue(new Promise((r) => { release = r })) as unknown as typeof fetch
    const p = resolveHomeTarget(f)
    storeMetroSlug('austin')
    release({ ok: true, json: async () => ({ lat: 47.6, lng: -122.33 }) })
    expect(await p).toBeNull()
    expect(storedMetroSlug()).toBe('austin')
  })
})
