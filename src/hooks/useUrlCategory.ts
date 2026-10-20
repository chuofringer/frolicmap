import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ALL_CATEGORIES, type Category } from '@shared/types'
import { chipCategories } from '@/config/categories'
import { useFiltersStore } from '@/stores/useFiltersStore'

const isCategory = (v: string): v is Category =>
  (ALL_CATEGORIES as readonly string[]).includes(v)

/**
 * Apply the `?cat=` deep link to the filter store — issue #387 scope addition.
 *
 * The city page emits on-page links like `/cities/seattle?cat=playground`
 * (paths carry search-term slugs, query params carry internal DB vocabulary —
 * so the value here is `playground`, never the `playgrounds` slug). Before
 * this hook, `?cat=` was a dead parameter: only `?item=` was ever read.
 *
 * v1 is deliberately ONE-WAY and ONE-SHOT: on the first render where a `cat`
 * param is present, we apply it (a set of one) and never touch it again. There
 * is no store→URL write-back — toggling filters in the UI doesn't rewrite the
 * URL, and comma-separated multi-cat is left for a real need. Single value
 * matches `?item=`.
 *
 * Why one-shot and not the bidirectional shape `useUrlItem` uses: the
 * `hasSynced` race that hook guards against (PR #239) comes from its state→URL
 * effect, which can wipe a cold-load param before the URL→state effect reads
 * it. A pure URL→store apply has no such back-edge to fight, so the correct
 * shape is simply "apply once when the param is present" — a ref latch, no
 * write-back. An unknown or junk value is silently ignored.
 */
export function useUrlCategory() {
  const [params] = useSearchParams()
  const setCategories = useFiltersStore((s) => s.setCategories)
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current) return
    const cat = params.get('cat')
    if (!cat) return
    // The load-time param is handled exactly once, valid or not — a junk value
    // is ignored rather than re-checked on every later render.
    applied.current = true
    // Expand to the chip's full display group (#323): `?cat=aquarium` and
    // `?cat=zoo` both open the combined "Aquarium/Zoo" filter, matching what
    // tapping that chip selects. Ungrouped categories expand to themselves.
    if (isCategory(cat)) setCategories(new Set(chipCategories(cat)))
  }, [params, setCategories])
}
