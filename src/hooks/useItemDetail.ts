import { useQuery } from '@tanstack/react-query'
import { fetchItemDetail, ItemFetchError } from '@/api/items'
import { useSessionStore } from '@/stores/useSessionStore'

// Fetches the full Item shape for one id (curated fields: description,
// address, source_url, website, photo_url, price_usd, opening_hours,
// last_verified). Fires lazily on marker click. The bulk `/api/items.json`
// list endpoint returns only the redacted `ListItem` fields.
//
// `enabled` gates on both `id` AND a live session token. Phase 2c made
// `/api/items/:id` require `Authorization: Bearer`. Without the token
// gate here, a popup opened before `useSession()` has minted — e.g. by
// URL-param `?item=X` or a rapid click right after page load — would
// fire a token-less fetch, get 401, cache the failure under the query
// key, and show "Details unavailable" even after the token eventually
// arrives. Gating on token means the query doesn't start until a valid
// Authorization can be attached; TanStack Query auto-runs the queryFn
// when `enabled` transitions false → true.
//
// `retry` mirrors `useItemCoords`: a 404 (row gone / never approved) is not
// transient, so it fails fast; anything else (401 from a token mid-refresh,
// 429 from the shared rate budget, 5xx, network blip) gets a bounded retry
// and, if it still fails, the panel offers "try again" rather than claiming
// the item is gone. See `isTransientDetailError`.
//
// Stale-time is 1h to match the worker's browser cache header;
// refetchInterval is left off so we don't hammer the detail endpoint
// per open popup.
export function isTransientDetailError(error: unknown): boolean {
  if (error instanceof ItemFetchError && error.status === 404) return false
  return true
}

export function useItemDetail(id: string | null) {
  const token = useSessionStore((s) => s.token)
  return useQuery({
    queryKey: ['item-detail', id],
    queryFn: () => fetchItemDetail(id!),
    enabled: !!id && !!token,
    staleTime: 60 * 60 * 1000,
    retry: (failureCount, error) => isTransientDetailError(error) && failureCount < 2,
  })
}
