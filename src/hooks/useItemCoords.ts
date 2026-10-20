import { useQuery } from '@tanstack/react-query'
import { fetchItemCoords, ItemFetchError } from '@/api/items'
import { useSessionStore } from '@/stores/useSessionStore'

// Fetches `{lat, lng}` for one id (#250 Phase 2d2 step (d)). Backs
// `useUrlItem`'s `?item=<id>` fly-to resolution now that it no longer reads
// the full `/api/items.json` catalog.
//
// `enabled` gates on both `id` AND a live session token — same rationale as
// `useItemDetail`: firing before `useSession()` has minted would 401 and
// cache the failure under the query key, stranding a deep link that arrived
// before the token did.
//
// `retry` is 404-specific (`useItemDetail` mirrors it, plus the events-gate
// 401): a 404
// here means a stale share link (the item aged out — e.g. a row was
// removed in a data reload, or was never approved), which `useUrlItem` treats as a real, immediate signal to drop
// the `?item=` param — retrying can't change that outcome, so don't delay
// it. Any OTHER failure (a 401 from a token that's mid-refresh, a 429 from
// the shared 60/min detail+coords rate budget, a 5xx, a network blip) is
// plausibly transient — misreading one of those as "item's gone" would
// silently strip a perfectly valid deep link, so those fall back to
// TanStack Query's normal capped-retry behavior instead of failing fast.
export function useItemCoords(id: string | null) {
  const token = useSessionStore((s) => s.token)
  return useQuery({
    queryKey: ['item-coords', id],
    queryFn: () => fetchItemCoords(id!),
    enabled: !!id && !!token,
    staleTime: 60 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ItemFetchError && error.status === 404) return false
      return failureCount < 2
    },
  })
}
