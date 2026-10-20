import type { Item, ListItem } from '@shared/types'
import { API_BASE } from '@/config/constants'
import { getSessionToken } from '@/stores/useSessionStore'

export interface ItemsResponse {
  items: ListItem[]
  region: string
  generated_at: string
}

// Data-protection Phase 2d1 (2026-04-21): `/api/items.json` now requires
// a valid session token (same as detail / tiles). Attach Authorization
// from the Zustand session store. `useItems` gates its query on token
// presence so this function isn't called before a token is available.
// `region` is the metro id from shared/metros.ts (#358). Omitting it means
// the Bay Area server-side, so passing it explicitly keeps the SPA honest
// about which metro it is showing rather than relying on that default.
export async function fetchItems(region?: string): Promise<ItemsResponse> {
  const token = getSessionToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const qs = region ? `?region=${encodeURIComponent(region)}` : ''
  const res = await fetch(`${API_BASE}/api/items.json${qs}`, { headers })
  if (!res.ok) throw new Error(`items.json fetch failed: ${res.status}`)
  return res.json()
}

// Thrown by `fetchItemCoords` / `fetchItemDetail` on a non-OK response. Carries the HTTP status
// so `useItemCoords` can tell a real "gone" signal (404 — anti-enumeration,
// covers both a missing row and a non-approved one) apart from a
// plausibly-transient failure (401 from a token mid-refresh, 429 from the
// shared rate budget, a 5xx) that retrying might resolve. A bare `Error`
// only carries the status inside its message string, which `useUrlItem`
// would otherwise have to parse to make that call.
export class ItemFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ItemFetchError'
    this.status = status
  }
}

// Per-item detail endpoint (data-protection Phase 1 + 2c). Fetched lazily
// on marker click; fields like description / address / source_url /
// website / photo_url / opening_hours / last_verified live here rather
// than in the list payload. Phase 2c requires an `Authorization: Bearer`
// token minted by `POST /api/session`; without one the endpoint returns
// 401 and the popup's error-fallback shows "Details unavailable."
export async function fetchItemDetail(id: string): Promise<Item> {
  const token = getSessionToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/items/${encodeURIComponent(id)}`, { headers })
  if (!res.ok) throw new ItemFetchError(res.status, `items/${id} fetch failed: ${res.status}`)
  const { item } = (await res.json()) as { item: Item }
  return item
}

export interface ItemCoords {
  lat: number
  lng: number
}

// Minimal coordinate-only endpoint (#250 Phase 2d2 step (d)). Lets
// `useUrlItem`'s `?item=<id>` fly-to resolve one id's lat/lng without
// pulling the full `/api/items.json` catalog — tiles carry no lat/lng-by-id
// index since a tile is bbox-scoped, so the deep-linked item may not even
// be in a currently-loaded tile. Same guards (Authorization + session gate)
// and the same anti-enumeration 404 as `fetchItemDetail` above: a missing
// row and a non-approved row are indistinguishable from the outside.
export async function fetchItemCoords(id: string): Promise<ItemCoords> {
  const token = getSessionToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/items/${encodeURIComponent(id)}/coords`, { headers })
  if (!res.ok) throw new ItemFetchError(res.status, `items/${id}/coords fetch failed: ${res.status}`)
  return res.json()
}
