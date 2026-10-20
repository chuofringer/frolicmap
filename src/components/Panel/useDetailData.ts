import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Item, ListItem } from '@shared/types'
import { CATEGORIES, categoryLabel, getCategoryEmoji, type CategoryMeta } from '@/config/categories'
import { useItems } from '@/hooks/useItems'
import { useItemDetail, isTransientDetailError } from '@/hooks/useItemDetail'
import { useDistanceOriginInfo } from '@/hooks/useDistanceOrigin'
import { buildMapsUrls } from '@/utils/mapsUrls'
import { cityLabel } from '@/utils/place'
import {
  formatDistanceMi,
  deriveGoodToKnow,
  parseOpenUntil,
  venueWallNow,
  websiteFor,
  sourceUrlFor,
  type GoodToKnowFact,
} from './detailHelpers'

export interface DetailData {
  id: string
  listItem: ListItem
  detail: Item | undefined
  detailFailed: boolean
  // True when the detail fetch failed for a plausibly-transient reason (token
  // refresh, rate limit, 5xx, network) — the panel/sheet shows "try again"
  // instead of the static "unavailable" line, which stays for 404 / gate 401.
  detailRetryable: boolean
  retryDetail: () => void
  // True while a retry (manual or TanStack's bounded auto-retry) is in flight
  // — the "try again" button disables so repeated taps don't stack refetches.
  detailRetrying: boolean
  meta: CategoryMeta
  /** The category's legend label in the active locale. */
  categoryName: string
  emoji: string
  distanceLabel: string | null
  address: string | null
  description: string | null
  website: string | null
  sourceUrl: string | null
  sourceHost: string | null
  lastVerified: string | null
  googleMapsUrl: string
  appleMapsUrl: string
  priceUsd: number | null
  isFree: boolean
  indoor: 0 | 1 | null
  ageLabel: string | null
  hoursValue: string | null
  // #645: true for a permanent place whose detail resolved with no
  // opening_hours — the panel/sheet renders an explicit "Hours unknown" box
  // instead of silently omitting the section a parent came to check.
  hoursUnknown: boolean
  goodToKnow: GoodToKnowFact[]
  openUntil: string | null
  shareUrl: string
}

/**
 * Shared view model for the desktop detail panel and the mobile bottom sheet.
 *
 * List-item fields (name, category, cost, age) render immediately from the
 * cached `/api/items.json` catalog; curated fields (description, address, hours, website, source, photo,
 * attributes) fill in when the lazy `useItemDetail` fetch resolves. Returns
 * null when nothing is selected or the list row isn't loaded yet.
 */
export function useDetailData(id: string | null): DetailData | null {
  const { t } = useTranslation()
  const { data } = useItems()
  const { origin, source: originSource } = useDistanceOriginInfo()

  const items = data?.items
  const listItem = id ? items?.find((x) => x.id === id) : undefined

  const { data: detail, isError: detailFailed, error: detailError, refetch, isFetching: detailRetrying } = useItemDetail(id)
  const detailRetryable = detailFailed && isTransientDetailError(detailError)
  const retryDetail = useCallback(() => { void refetch() }, [refetch])

  return useMemo(() => {
    if (!id || !listItem) return null

    const meta = CATEGORIES[listItem.category]
    // Resolved here rather than read off `meta` so the panel and sheet render
    // the legend vocabulary in the active locale (#208).
    const categoryName = categoryLabel(listItem.category)
    const emoji = getCategoryEmoji(listItem.category)

    const address = detail?.address ?? null
    const description = detail?.description ?? null
    const website = websiteFor(detail)
    const sourceUrl = sourceUrlFor(detail?.source_url)
    const priceUsd = detail?.price_usd ?? null
    const lastVerified = detail?.last_verified ?? null
    const openingHours = detail?.opening_hours ?? null
    const attributes = detail?.attributes ?? null

    const { google: googleMapsUrl, apple: appleMapsUrl } = buildMapsUrls(listItem, address)
    const sourceHost = sourceUrl
      ? (() => { try { return new URL(sourceUrl).host } catch { return null } })()
      : null

    const ageLabel =
      listItem.age_min != null || listItem.age_max != null
        ? t('detail.ages', { min: listItem.age_min ?? 0, max: listItem.age_max ?? 12 })
        : null

    // Hours box: permanent places show opening_hours when the detail carries it.
    const hoursValue: string | null = openingHours

    // #645: a place sheet with no hours section reads as broken — say "hours
    // unknown" instead. Only once the lazy detail fetch has settled (loaded
    // or failed), so the box doesn't flash "unknown" while hours are in
    // flight.
    const hoursUnknown = hoursValue === null && (detail !== undefined || detailFailed)

    // "Open · until X" must read the VENUE's clock — a museum's 5 PM close
    // is 5 PM on its own wall, not the viewer's.
    const openUntil = parseOpenUntil(openingHours, venueWallNow(listItem.lat, listItem.lng))

    return {
      id,
      listItem,
      detail,
      detailFailed,
      detailRetryable,
      retryDetail,
      detailRetrying,
      meta,
      categoryName,
      emoji,
      // #645: "1.4 mi from map center" is meaningless to a parent planning a
      // trip. Near-me on → real "from you" distance; otherwise anchor the
      // location with the venue's city instead — but only when there's no
      // street address on the same line to say it already.
      distanceLabel:
        originSource === 'geo'
          ? formatDistanceMi(origin, listItem.lng, listItem.lat)
          : address
            ? null
            : cityLabel(listItem),
      address,
      description,
      website,
      sourceUrl,
      sourceHost,
      lastVerified,
      googleMapsUrl,
      appleMapsUrl,
      priceUsd,
      isFree: listItem.cost === 'free',
      indoor: listItem.indoor,
      ageLabel,
      hoursValue,
      hoursUnknown,
      goodToKnow: deriveGoodToKnow(attributes),
      openUntil,
      shareUrl: `${location.origin}${location.pathname}?item=${listItem.id}`,
    }
  }, [id, listItem, detail, detailFailed, detailRetryable, retryDetail, detailRetrying, origin, originSource, t])
}
