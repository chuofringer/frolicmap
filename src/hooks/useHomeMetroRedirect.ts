import { useEffect, useRef } from 'react'
import { getMetroBySlug, nearestPublishedMetro } from '@shared/metros'
import { API_BASE } from '@/config/constants'
import { localeFromPath, localizedPath } from '@/i18n/locale'
import { isLikelyBot } from '@/utils/bot'

/**
 * Open the home page on the visitor's metro (#17).
 *
 * `/` (and `/zh/`) is still the prerendered Bay shell for crawlers; the
 * redirect happens client-side, for humans only, and never on a
 * `/cities/{slug}` deep link.
 *
 *   1. A stored choice (`frolicmap.metro`) wins: go straight to that metro, no
 *      network call. The city switcher writes this key, so an explicit pick
 *      sticks.
 *   2. Otherwise ask the edge once (`GET /api/where`, the approximate city of
 *      the connection, nothing stored server-side). A metro in range is
 *      stored and opened; no match or any failure opens the `/cities` list.
 *
 * Both navigations are full-page `location.replace`: the targets are
 * prerendered static pages, which a react-router navigation would not reach,
 * and `replace` keeps Back from bouncing off `/`.
 */

export const METRO_STORAGE_KEY = 'frolicmap.metro'
/** sessionStorage guard so a visit to `/` after the list page isn't bounced there again. */
const ASKED_KEY = 'frolicmap.where-asked'
const WHERE_TIMEOUT_MS = 4000

/** The stored metro slug, only if it is still a published metro. */
export function storedMetroSlug(): string | null {
  try {
    const v = localStorage.getItem(METRO_STORAGE_KEY)
    const m = v ? getMetroBySlug(v) : undefined
    return m?.published ? m.slug : null
  } catch {
    return null // private mode
  }
}

export function storeMetroSlug(slug: string): void {
  try {
    localStorage.setItem(METRO_STORAGE_KEY, slug)
  } catch { /* private mode: the choice just won't persist */ }
}

/** True for `/`, `/zh` and `/zh/` with no query string or hash (deep links like `?item=` are left alone). */
export function isHomeLocation(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location): boolean {
  if (loc.search || loc.hash) return false
  const prefix = localeFromPath(loc.pathname)
  const bare = prefix ? loc.pathname.slice(prefix.length + 1) : loc.pathname
  return bare === '' || bare === '/'
}

type Navigate = (href: string) => void
const defaultNavigate: Navigate = (href) => window.location.replace(href)

/**
 * Synchronous half, safe to run before the first render: a stored choice sends
 * `/` to that metro with no flash of the Bay map. Returns true when a
 * navigation started (the caller must not render).
 */
export function redirectToStoredMetro(navigate: Navigate = defaultNavigate): boolean {
  if (isLikelyBot() || !isHomeLocation()) return false
  const slug = storedMetroSlug()
  if (!slug) return false
  navigate(localizedPath(`/cities/${slug}`))
  return true
}

interface WhereResponse {
  lat: number | null
  lng: number | null
}

async function fetchWhere(fetchImpl: typeof fetch): Promise<WhereResponse | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), WHERE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${API_BASE}/api/where`, { signal: ctl.signal, cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as WhereResponse
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve where `/` should go when there is no stored choice. Returns the
 * unlocalised target path, or null when nothing should happen (not the home
 * page, a crawler, or already asked this session).
 */
export async function resolveHomeTarget(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (isLikelyBot() || !isHomeLocation() || storedMetroSlug()) return null
  try {
    if (sessionStorage.getItem(ASKED_KEY)) return null
    sessionStorage.setItem(ASKED_KEY, '1')
  } catch { /* sessionStorage blocked: can't dedupe, ask anyway */ }

  const where = await fetchWhere(fetchImpl)
  // The user may have acted while the request was in flight (picked a city,
  // opened an item, followed a link): never yank them away from that.
  if (!isHomeLocation() || storedMetroSlug()) return null

  const metro =
    where && typeof where.lat === 'number' && typeof where.lng === 'number'
      ? nearestPublishedMetro(where.lat, where.lng)
      : null
  if (!metro) return '/cities'
  storeMetroSlug(metro.slug)
  return `/cities/${metro.slug}`
}

/** Mount once near the app root (App.tsx). */
export function useHomeMetroRedirect(navigate: Navigate = defaultNavigate): void {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return // StrictMode double-invokes effects
    started.current = true
    void resolveHomeTarget().then((target) => {
      if (target) navigate(localizedPath(target))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
