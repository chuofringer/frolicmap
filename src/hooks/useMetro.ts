import { useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { DEFAULT_REGION, getMetro, getMetroBySlug, type Metro } from '@shared/metros'

/**
 * The metro the current URL is showing — issue #358, retargeted by #387.
 *
 * `/cities/{slug}` selects a metro; every other path is the Bay Area, which
 * keeps `/` exactly as it has always been (plan §3.2: "`/` stays the Bay
 * map"). Since #387 the city page IS the map: `/cities/seattle` serves the
 * prerendered SPA shell, and this hook is what makes the booted app show
 * Seattle rather than defaulting to Bay — without it the served shell would
 * carry Seattle's head but boot as the Bay map (the head/body mismatch #380
 * existed to kill).
 *
 * An unknown or unpublished slug falls back to Bay rather than erroring: the
 * page still works, it just shows the metro we know is live. Publishing is
 * gated server-side too (#371), so a hand-typed `/cities/chicago` can't reveal
 * an unlaunched metro's data either way.
 */
export function useMetro(): Metro {
  const { pathname } = useLocation()
  return useMemo(() => {
    const bay = getMetro(DEFAULT_REGION)!
    const m = /^\/cities\/([a-z0-9-]+)\/?$/.exec(pathname)
    if (!m) return bay
    const metro = getMetroBySlug(m[1])
    if (!metro || !metro.published) return bay
    return metro
  }, [pathname])
}
