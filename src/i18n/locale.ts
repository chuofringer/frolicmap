/**
 * Locale detection and switching (#208).
 *
 * The URL wins over the stored preference: a `/zh` link shared on RedNote must
 * render Chinese for whoever opens it, regardless of what that device chose
 * last time. Storage only decides where a bare `/` visit lands for someone who
 * has already picked.
 *
 * There is deliberately NO `Accept-Language` auto-redirect: it would fragment
 * the Pages edge cache on a header we don't vary on, and it surprises bilingual
 * users who want the English page they clicked. Discovery is handled by the
 * always-visible language toggle in the icon bar instead.
 */

export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Path prefix for a locale — English lives at the root, zh under `/zh`. */
export const localeBasename = (l: Locale): string | undefined => (l === 'en' ? undefined : `/${l}`)

/** BCP-47 tag for `Intl` formatting. Not the same as our route prefix. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
}

const STORAGE_KEY = 'frolicmap.lang'

function isLocale(v: string | null): v is Locale {
  return v !== null && (LOCALES as readonly string[]).includes(v)
}

/** The locale encoded in a pathname, or null when it carries no prefix. */
export function localeFromPath(pathname: string): Locale | null {
  const seg = pathname.split('/')[1]
  // 'en' is never a prefix — English is the root. Only real prefixes count.
  return seg && seg !== 'en' && isLocale(seg) ? seg : null
}

export function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isLocale(v) ? v : null
  } catch {
    return null // private mode
  }
}

export function storeLocale(l: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch { /* private mode */ }
}

/**
 * URL prefix first, then the stored preference, then English.
 *
 * NOTE: this is the *content* locale. It is deliberately NOT the source of the
 * router basename — see `redirectToStoredLocale`.
 */
export function detectLocale(pathname: string = window.location.pathname): Locale {
  return localeFromPath(pathname) ?? storedLocale() ?? DEFAULT_LOCALE
}

/**
 * Send a returning visitor to the language they chose, before anything mounts.
 * Returns true when a navigation was started (the caller must not render).
 *
 * Why a redirect and not just a basename: react-router renders NOTHING when
 * its basename doesn't prefix the current path, so handing a stored `zh` to
 * `basename` while the URL is `/` produces a blank page — for a visitor who is
 * *more* engaged than average, and reachable from our own unprefixed
 * `/cities/{slug}` links. The URL and the basename must always agree.
 *
 * Deliberately narrow: only fires when the URL carries no prefix at all, only
 * for a non-English stored choice. Crawlers have no
 * localStorage, so they never see it.
 */
export function redirectToStoredLocale(
  // Injectable so the guard conditions are testable — jsdom refuses to let a
  // spy replace `window.location.replace`.
  navigate: (href: string) => void = (href) => window.location.replace(href),
): boolean {
  const { pathname } = window.location
  if (localeFromPath(pathname)) return false      // URL already states a locale
  const stored = storedLocale()
  if (stored === null || stored === DEFAULT_LOCALE) return false
  // Target always carries the prefix, so the next load short-circuits above.
  navigate(localizedHref(stored))
  return true
}

/**
 * Prefix an app-absolute path with the locale currently in the URL.
 *
 * For **plain `<a>` links only**. Those are used deliberately wherever the
 * target is (or may be) a generated static file, because a react-router
 * `<Link>` gets swallowed by the catch-all route and never reaches the file
 * (CLAUDE.md, plan §3.2). But a plain `<a href="/cities/seattle">` also
 * bypasses the router's basename, so without this the link silently drops the
 * reader out of their language — which is exactly what `/cities` and every
 * entry in the city picker used to do.
 *
 * `<Link to="...">` needs none of this; the basename handles it.
 */
export function localizedPath(path: string, pathname: string = window.location.pathname): string {
  // Idempotent: a caller that already localised its path (or forwarded one it
  // read off the DOM) gets the same string back, not `/zh/zh/cities`.
  const existing = localeFromPath(path)
  const bare = existing ? path.slice(`/${existing}`.length) || '/' : path
  const prefix = localeFromPath(pathname)
  return prefix ? `/${prefix}${bare === '/' ? '/' : bare}` : bare
}

/**
 * Rewrite the current URL for `next`, preserving path, query and hash — so a
 * language switch keeps `?item=`, `?cat=` and `?view=` deep links intact.
 */
export function localizedHref(next: Locale, url: URL = new URL(window.location.href)): string {
  const current = localeFromPath(url.pathname)
  const bare = current ? url.pathname.slice(`/${current}`.length) || '/' : url.pathname
  const prefix = localeBasename(next) ?? ''
  return `${prefix}${bare === '/' && prefix ? '/' : bare}${url.search}${url.hash}`
}

/**
 * Switch language with a full navigation. Deliberately not client-side: a
 * reload guarantees the zh chunk, `<html lang>`, and every cached `Intl`
 * formatter agree. Language switching is a once-per-visitor action.
 */
export function switchLocale(next: Locale): void {
  storeLocale(next)
  window.location.assign(localizedHref(next))
}

