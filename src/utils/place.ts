import type { ListItem } from '@shared/types'

/**
 * The city/suburb to show on a card, or null when the row has none.
 *
 * The list payload's `city` is a mix of importer-written column values and a
 * read-time fallback parsed from the address (worker `cityFromAddress`), so it
 * can arrive as an empty or whitespace-only string. One place normalises that
 * so no card ever renders a "Park ·  · 3.2 mi" gap.
 */
export function cityLabel(item: Pick<ListItem, 'city'>): string | null {
  const city = item.city?.trim()
  return city ? city : null
}
