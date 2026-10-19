import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Item, ListItem } from '@shared/types'
import { CATEGORIES, categoryLabel, getCategoryEmoji, type CategoryMeta } from '@/config/categories'
import { EVENTS_GATE_ENABLED } from '@/config/constants'
import { isGatedEventKind } from '@shared/eventsGate'
import { useItems } from '@/hooks/useItems'
import { useItemDetail, isTransientDetailError } from '@/hooks/useItemDetail'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useDistanceOriginInfo } from '@/hooks/useDistanceOrigin'
import { buildMapsUrls } from '@/utils/mapsUrls'
import { cityLabel } from '@/utils/place'
import { findSiblings } from '@/utils/siblings'
import { venueTimezone, wallNow } from '@/utils/venueTime'
import {
  formatEventTiming,
  formatDistanceMi,
  deriveGoodToKnow,
  parseOpenUntil,
  websiteFor,
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
  isUpick: boolean
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
  hoursLabel: 'HOURS' | 'WHEN' | null
  hoursValue: string | null
  // #645: true for a permanent place whose detail resolved with no
  // opening_hours — the panel/sheet renders an explicit "Hours unknown" box
  // instead of silently omitting the section a parent came to check.
  hoursUnknown: boolean
  goodToKnow: GoodToKnowFact[]
  openUntil: string | null
  shareUrl: string
  // Same-named event rows at this venue on other dates (#234) — the only path
  // to non-earliest dates, since the map/list show one row per source. Includes
  // the focused row; length >= 2 means render the "Upcoming dates" strip.
  siblings: ListItem[]
  // Events sign-in gate (2026-07-26 experiment): true when this is an event
  // and the visitor hasn't unlocked events yet — the panel/sheet renders the
  // EventUnlockCard instead of the curated sections, and the lazy detail
  // fetch is held back (see below).
  gated: boolean
  // Affiliate links (#254): true when the worker rewrote this item's
  // Website/Source URL to an affiliate-tagged one — the panel/sheet then
  // shows the FTC disclosure footnote. Always false while no partner is
  // configured server-side (the detail payload carries no `affiliate` key).
  affiliateTagged: boolean
}

/**
 * Shared view model for the desktop detail panel and the mobile bottom sheet.
 *
 * Mirrors `ItemPopup`'s data flow: list-item fields (name, category, cost,
 * age, timing) render immediately from the cached `/api/items.json` catalog;
 * curated fields (description, address, hours, website, source, photo,
 * attributes) fill in when the lazy `useItemDetail` fetch resolves. Returns
 * null when nothing is selected or the list row isn't loaded yet.
 */
export function useDetailData(id: string | null): DetailData | null {
  const { t } = useTranslation()
  const { data } = useItems()
  const { origin, source: originSource } = useDistanceOriginInfo()
  const signedIn = useAuthStore((s) => s.signedIn)
  const sessionMember = useSessionStore((s) => s.member)

  const items = data?.items
  const listItem = id ? items?.find((x) => x.id === id) : undefined

  // Events sign-in gate (real auth, 2026-07-26). `gated` (UI shows the unlock
  // card) flips the moment a credential lands — including via the storage
  // event from a sign-in in another tab. The lazy `/api/items/:id` fetch is held a
  // beat longer, until the SESSION is member-tier: the worker 401s event
  // details on guest sessions, so firing before useSession's credential
  // re-mint completes would just cache a failure. TanStack fires the fetch on
  // the enabled false→true transition, so the fields reveal in place.
  // Shared predicate (shared/eventsGate.ts): category OR type — venue rows
  // in the event category (type='place') gate with the dated events.
  const needsMember = EVENTS_GATE_ENABLED && !!listItem && isGatedEventKind(listItem)
  const gated = needsMember && !signedIn
  const fetchable = !needsMember || (signedIn && sessionMember)
  const { data: detail, isError: detailFailed, error: detailError, refetch, isFetching: detailRetrying } = useItemDetail(fetchable ? id : null)
  const detailRetryable = detailFailed && isTransientDetailError(detailError)
  const retryDetail = useCallback(() => { void refetch() }, [refetch])

  return useMemo(() => {
    if (!id || !listItem) return null

    // Non-upick events can have same-named sibling rows on other dates; the
    // "Upcoming dates" strip is the only way to reach them (map/list show the
    // earliest per source). findSiblings includes the focused row.
    const siblings = listItem.category !== 'upick' && items ? findSiblings(listItem, items) : [listItem]

    const meta = CATEGORIES[listItem.category]
    // Resolved here rather than read off `meta` so the panel and sheet render
    // the legend vocabulary in the active locale (#208).
    const categoryName = categoryLabel(listItem.category)
    const emoji = getCategoryEmoji(listItem.category)
    const isUpick = listItem.category === 'upick'

    const address = detail?.address ?? null
    const description = detail?.description ?? null
    const website = websiteFor(detail)
    const sourceUrl = detail?.source_url ?? null
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

    // Hours box: events (and open-window rows) show WHEN + timing; permanent
    // places show HOURS + opening_hours. U-Pick renders its own season strip
    // instead, so it takes no hours box here. All timing renders in the
    // VENUE's zone, resolved from the item's coordinates.
    const venueTz = venueTimezone(listItem.lat, listItem.lng)
    let hoursLabel: 'HOURS' | 'WHEN' | null = null
    let hoursValue: string | null = null
    if (!isUpick && (listItem.start_time || listItem.rrule)) {
      hoursLabel = 'WHEN'
      hoursValue = formatEventTiming(listItem.start_time, listItem.end_time, listItem.rrule, venueTz)
    } else if (!isUpick && openingHours) {
      hoursLabel = 'HOURS'
      hoursValue = openingHours
    }
    // #645: a place sheet with no hours section reads as broken — say "hours
    // unknown" instead. Only once the lazy detail fetch has settled (loaded
    // or failed), so the box doesn't flash "unknown" while hours are in
    // flight; never for gated events (their WHEN teaser is the timing).
    const hoursUnknown = !isUpick && !gated && hoursLabel === null && (detail !== undefined || detailFailed)

    // "Open · until X" must read the VENUE's clock — a museum's 5 PM close
    // is 5 PM on its own wall, not the viewer's.
    const openUntil =
      !isUpick && !listItem.start_time && !listItem.rrule
        ? parseOpenUntil(openingHours, wallNow(venueTz))
        : null

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
      isUpick,
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
      hoursLabel,
      hoursValue,
      hoursUnknown,
      goodToKnow: deriveGoodToKnow(attributes),
      openUntil,
      shareUrl: `${location.origin}${location.pathname}?item=${listItem.id}`,
      siblings,
      gated,
      affiliateTagged: detail?.affiliate != null && Object.keys(detail.affiliate).length > 0,
    }
  }, [id, listItem, items, detail, detailFailed, detailRetryable, retryDetail, detailRetrying, origin, originSource, gated, t])
}
