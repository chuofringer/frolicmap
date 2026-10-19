import type { ListItem } from '@shared/types'

export interface MapsUrls {
  google: string
  apple: string
}

/**
 * Build Google/Apple Maps **place-view** URLs (not turn-by-turn directions).
 *
 * We deliberately use the search/place URL schemes
 * (`maps/search/?api=1&query=` and `maps.apple.com/?q=`) so the link lands on
 * the venue's place card — photos + reviews — and the user taps the Maps app's
 * own "Directions" button when they're ready. This is the same free, public
 * URL-scheme mechanism the directions links already used: no API key, no
 * geocoding API call, no cost. Maps runs the search on its side from the
 * `query` string, exactly as if the user typed it into the search box.
 *
 * **Coordinate anchoring (the key fix).** A name-only query is location-relative
 * — Maps searches near the *user's* current location. Someone in SF tapping a
 * Seattle playground would get SF results. This bit anytime the query lacks a
 * globally-unambiguous address: the 11,879 national OSM place rows have a null
 * address, and every place is name-only for the moment before the lazy detail
 * fetch resolves. It also matters inside one metro — a Jersey City place shown
 * on the NYC map must not resolve to a same-named spot elsewhere. So we anchor
 * every URL to the place's own coordinates:
 *  - **Google**: with an address, keep the documented `?api=1&query=<name>, <address>`
 *    form (globally unambiguous, lands on the place card). Without an address,
 *    use the viewport-anchored path form
 *    `maps/search/<name>/@<lat>,<lng>,15z` — the `@` viewport biases the search
 *    to that exact area.
 *  - **Apple**: always append `&sll=<lat>,<lng>` (Apple's documented "search
 *    near" param) to the `?q=` form; when the address is null the `q` stays
 *    name-only (places) or coords (events) but `sll` anchors it to the place.
 *
 * Query construction differs by type:
 *  - **Places** (`type === 'place'`, incl. U-Pick farms): `"<name>, <address>"`
 *    when the address is loaded, else the coordinate-anchored name-only form.
 *  - **Events** (`type === 'event'`): address only, falling back to
 *    `"<lat>,<lng>"` when address is null (already location-exact). We never put
 *    the event name in the query — event rows are named by program description
 *    ("Family Storytime …"), which Maps geocodes to the wrong location.
 *
 * `address` arrives from the lazy detail fetch; until then the place query
 * falls back to the anchored name-only form and self-upgrades when detail
 * resolves.
 */
export function buildMapsUrls(
  item: Pick<ListItem, 'type' | 'name' | 'lat' | 'lng'>,
  address: string | null,
): MapsUrls {
  // Apple "search near" anchor — biases the `?q=` search to this exact place,
  // not the user's current location. Raw `lat,lng` (unencoded comma) per the
  // documented param form.
  const sll = `&sll=${item.lat},${item.lng}`

  // Treat any falsy address as absent: prod D1 has rows with an empty-string
  // address (not null), and ItemPopup's `?? null` lets `''` through. A blank
  // address must take the anchored fallback, not produce `"Name, "` / `""`.
  if (item.type === 'place' && !address) {
    // No address: anchor Google's search to the coordinate viewport so it lands
    // on this exact area rather than near the user.
    const name = encodeURIComponent(item.name)
    return {
      google: `https://www.google.com/maps/search/${name}/@${item.lat},${item.lng},15z`,
      apple: `https://maps.apple.com/?q=${name}${sll}`,
    }
  }

  // Events fall back to raw coords (already location-exact); places with an
  // address use the globally-unambiguous name + address form.
  const query =
    item.type === 'event'
      ? address || `${item.lat},${item.lng}`
      : `${item.name}, ${address}`
  const encoded = encodeURIComponent(query)
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    apple: `https://maps.apple.com/?q=${encoded}${sll}`,
  }
}
