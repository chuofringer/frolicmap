import { useQuery } from '@tanstack/react-query'
import { fetchItems } from '@/api/items'
import { useSessionStore } from '@/stores/useSessionStore'
import { useMetro } from '@/hooks/useMetro'

// Fetches `/api/items.json` — the redacted ListItem catalog used for
// client-side filter logic and popup's immediate-render fields (name, age,
// cost, time). `useUrlItem`'s fly-to coordinate lookup was migrated off this
// catalog onto `/api/items/:id/coords` (#250 Phase 2d2 step (d)) — see
// `useItemCoords`.
//
// Phase 2d1 gates this endpoint on a session token (same as detail /
// tiles), so `enabled` gates on `!!token` — without this, the first
// fetch on cold load fires before `useSession()` mints a token, gets
// 401, caches the failure, and wouldn't retry because the queryKey
// doesn't include the token. Matching the `useItemDetail` pattern
// means the query auto-runs as soon as `enabled` transitions
// false → true, once the token arrives.
export function useItems() {
  const token = useSessionStore((s) => s.token)
  // Region is part of the query key (#358): navigating between metros must
  // refetch rather than serve the previous metro's cached catalog.
  const metro = useMetro()
  return useQuery({
    queryKey: ['items', metro.id],
    queryFn: () => fetchItems(metro.id),
    enabled: !!token,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  })
}
