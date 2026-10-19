import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMapStore } from '@/stores/useMapStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useItemCoords } from '@/hooks/useItemCoords'
import { openItemDetail } from '@/utils/openItem'

export function useUrlItem() {
  const [params, setParams] = useSearchParams()
  const selectedId = useMapStore((s) => s.selectedId)
  const setSelectedId = useMapStore((s) => s.setSelectedId)
  const setFlyTo = useMapStore((s) => s.setFlyTo)
  const token = useSessionStore((s) => s.token)

  const urlItemId = params.get('item')
  // Only resolve coords for an id that isn't already the selection — once
  // applied (or once the store already holds it for some other reason),
  // re-fetching would be wasted and would also re-fire the effect below on
  // every render via `coordsQuery`'s changing object identity.
  const needsCoords = urlItemId !== null && urlItemId !== selectedId
  const coordsQuery = useItemCoords(needsCoords ? urlItemId : null)

  // Tracks whether a session token has ever been present. Pins select from
  // vector tiles (not a full catalog — see FunMap.tsx), so a click can set
  // `selectedId` while no token has arrived yet; the state→URL effect below
  // is gated on `token` and can't write `?item=` for that selection yet. On
  // the render where a token first arrives, an absent `?item=` param is
  // therefore ambiguous — it may mean "no selection" or "a selection made
  // during the pre-token window that never got a chance to reach the URL".
  // `hadTokenRef` disambiguates: false only means this render.
  //
  // Token presence (rather than the old items.json catalog) is the
  // readiness signal here: a session token is the thing FunMap's tile
  // source and this hook's own coords lookup are both actually gated on,
  // and it arrives at (or before) the same point in the load sequence that
  // items.json used to.
  const hadTokenRef = useRef(false)

  // Sync URL → state. On `?item=<id>` arrival, resolves the id's coordinates
  // via `/api/items/:id/coords` (see `useItemCoords`) rather than looking it
  // up in a pre-loaded catalog — so this branch spans multiple renders while
  // the fetch is in flight, instead of resolving synchronously.
  useEffect(() => {
    const id = params.get('item')
    if (id && id !== selectedId) {
      if (coordsQuery.data) {
        // Passive: the visitor arrived on the link rather than tapping —
        // counts as a popup_open (bot-guarded) but is not event intent.
        // The coords endpoint returns only `{lat, lng}` — no category/type —
        // but neither is needed for a passive open (see openItemDetail).
        openItemDetail({ id }, { passive: true })
        setFlyTo({ longitude: coordsQuery.data.lng, latitude: coordsQuery.data.lat, zoom: 14 })
      } else if (coordsQuery.isError) {
        // Stale share link — the item aged out (e.g. the daily archive
        // cron retired a one-off event) or was never approved. Selecting a
        // nonexistent id renders NO detail surface while the mobile bottom
        // bar still hides on `selectedId !== null`, stranding the user with
        // no controls. Drop the param instead.
        const next = new URLSearchParams(params)
        next.delete('item')
        setParams(next, { replace: true })
      }
      // else: still loading — leave the param untouched until it resolves.
    }
    if (!id && selectedId) {
      if (hadTokenRef.current) {
        setSelectedId(null)
      } else {
        // A token just arrived for the first time and the URL has no
        // `?item=`, but the store already has a selection — it can only
        // have come from a vector-tile pin click during the pre-token
        // window (#587). Trust it and backfill the URL instead of wiping
        // it; the state→URL effect can't do this itself here because its
        // dependency array doesn't include `token` (see below).
        const next = new URLSearchParams(params)
        next.set('item', selectedId)
        setParams(next, { replace: true })
      }
    }
    if (token) hadTokenRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, token, coordsQuery.data, coordsQuery.isError])

  // Sync state → URL. Gated on a session token having arrived — not a
  // first-run ref — so it can't fire with the initial `selectedId === null`
  // before the URL→state effect above has had a chance to read a deep-link
  // `?item=...` (a first-run *ref* survives React StrictMode's dev-only
  // effect unmount/remount, so on the remount it no longer counts as the
  // first run and wipes the param before resolution has had a chance — #543).
  // `useUrlItem` mounts once for the app's lifetime (see `App.tsx`), and the
  // session token can't be present on that first commit — it's minted
  // asynchronously — so `token` can only flip from absent to present on a
  // later commit, never render alongside a stale `selectedId` closure from
  // the same commit as a fresh URL→state write.
  //
  // `token` is deliberately left out of the dep array: this effect must
  // stay silent on every render until `selectedId` itself changes, the same
  // way the old ref only unblocked once, so it doesn't fire on the render
  // where `token` alone flips from absent to present (selectedId hasn't
  // been set from the URL yet on that render).
  useEffect(() => {
    if (!token) return
    const current = params.get('item')
    if (selectedId && selectedId !== current) {
      const next = new URLSearchParams(params)
      next.set('item', selectedId)
      setParams(next, { replace: true })
    } else if (!selectedId && current) {
      const next = new URLSearchParams(params)
      next.delete('item')
      setParams(next, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
}
