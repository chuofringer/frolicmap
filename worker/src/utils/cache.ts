import { publishedMetros } from '@shared/metros'

/**
 * Invalidate the edge cache entries for `/api/items.json`.
 * Called after any admin mutation that changes visible rows so users see
 * changes immediately instead of waiting up to 1h for the TTL.
 *
 * `?region=` (migration 0016 / plan §2.0) makes this a *set* of URLs rather
 * than one: the edge keys on the full URL, so `/api/items.json` and
 * `/api/items.json?region=bay` are separate entries even though they return
 * the same body today. Purging only the bare URL would leave the SPA's
 * region-scoped response stale for an hour after an admin edit.
 *
 * The purge set is bare + every *published* metro, not all 50. That's
 * complete rather than merely cheap: `/api/items.json` rejects unpublished
 * regions with a `no-store` 404, so an unpublished metro can never have a
 * cacheable response in the first place. If that gate is ever relaxed, this
 * set has to widen to all 50 in the same change.
 */
export async function purgeItemsCache(frontendUrl: string): Promise<void> {
  const cache = caches.default
  const bases = [frontendUrl.replace(/\/$/, ''), 'https://api.frolicmap.app']
  const paths = [
    '/api/items.json',
    ...publishedMetros().map((m) => `/api/items.json?region=${encodeURIComponent(m.id)}`),
  ]
  await Promise.all(
    bases.flatMap((base) => paths.map((path) => cache.delete(`${base}${path}`))),
  )
}

/**
 * Invalidate the edge cache entry for `/api/items/:id` (data-protection Phase 1).
 * Called alongside `purgeItemsCache` on admin mutations so a fix to a
 * description/address/website reaches users within seconds instead of up to
 * 1h. Without this, an admin correction to a user-reported typo would leak
 * the stale detail via bookmarked `?item=X` URLs (the list purge makes the
 * pin disappear on reject/archive, but the detail endpoint stays cached).
 */
export async function purgeItemDetailCache(frontendUrl: string, id: string): Promise<void> {
  const cache = caches.default
  const bases = [frontendUrl.replace(/\/$/, ''), 'https://api.frolicmap.app']
  const encoded = encodeURIComponent(id)
  await Promise.all(bases.map((base) => cache.delete(`${base}/api/items/${encoded}`)))
}
