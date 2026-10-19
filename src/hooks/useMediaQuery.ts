import { useEffect, useState } from 'react'

/**
 * Reactive `window.matchMedia` hook. Used to pick the desktop detail panel vs.
 * the mobile bottom sheet (and the desktop vs. mobile variant of the
 * consolidated search/filter bar) without double-mounting both — a hidden
 * `role="dialog"` in the DOM is a focus/a11y hazard, so we render exactly one.
 *
 * SSR-safe: defaults to `false` when `window` is absent (prerendered shells),
 * then corrects on mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// Tailwind's `md` breakpoint (768px). The detail panel and consolidated bar
// switch layouts here, matching the `md:` class variants used elsewhere.
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
