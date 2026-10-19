import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMapStore } from '@/stores/useMapStore'

/**
 * Two-way sync of the Map/List/Calendar view with `?view=` — same shape as
 * `useUrlItem`. `?view=list` / `?view=calendar` on load selects that view;
 * toggling the view rewrites the param (map removes it). Any other value is
 * treated as the default map view.
 */
export function useUrlView() {
  const [params, setParams] = useSearchParams()
  const viewMode = useMapStore((s) => s.viewMode)
  const setViewMode = useMapStore((s) => s.setViewMode)

  // URL → state. When the URL disagrees with the store, this marks a sync
  // as pending (see below) *before* calling setViewMode, so the state→URL
  // effect below — which always runs after this one within the same
  // commit — sees it still pending even though `setViewMode` hasn't
  // flushed into `viewMode` yet.
  const pendingUrlSync = useRef(false)
  useEffect(() => {
    const raw = params.get('view')
    const want = raw === 'list' || raw === 'calendar' ? raw : 'map'
    if (want !== viewMode) {
      pendingUrlSync.current = true
      setViewMode(want)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  // State → URL. Unlike a first-run ref (the old approach, same as
  // useUrlItem's pre-#543 bug), `pendingUrlSync` isn't a one-shot latch —
  // it's set fresh by the URL→state effect above whenever *it* just told
  // the store to change, and consumed here on the very next run of this
  // effect. On mount, both effects fire in the same commit before any
  // state update flushes, so if the URL→state effect just called
  // `setViewMode`, `viewMode` here is still the stale pre-sync value; the
  // pending flag defers this effect until the real re-render where
  // `viewMode` reflects it. React StrictMode replays that same mount
  // commit's effects a second time (dev-only, before anything flushes),
  // but each replay re-sets-and-reconsumes the flag identically, so it
  // never survives a `viewMode` update it wasn't guarding.
  useEffect(() => {
    if (pendingUrlSync.current) {
      pendingUrlSync.current = false
      return
    }
    const current = params.get('view')
    if (viewMode !== 'map' && current !== viewMode) {
      const next = new URLSearchParams(params)
      next.set('view', viewMode)
      setParams(next, { replace: true })
    } else if (viewMode === 'map' && current) {
      const next = new URLSearchParams(params)
      next.delete('view')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])
}
