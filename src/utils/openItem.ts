import { trackGoal } from '@/utils/analytics'
import { isLikelyBot } from '@/utils/bot'
import { useMapStore } from '@/stores/useMapStore'

/**
 * Shared "open this item's detail" sequence. Every surface that selects an
 * item goes through here (map pin, list card, stack pick, search suggestion,
 * `?item=` deep link) so none of them can forget a step:
 *   1. `trackGoal('popup_open')` (Cloudflare beacon only).
 *   2. `setSelectedId(id)`.
 *
 * `passive: true` marks an open the visitor didn't perform: today only the
 * `?item=` deep link applied on page load (`useUrlItem`). It still selects,
 * but it is bot-guarded like every other load-time goal (`trackMetroView`,
 * `trackSessionStart`) since crawlers fetch share links.
 */
export function openItemDetail(item: { id: string }, opts: { passive?: boolean } = {}): void {
  const passive = opts.passive === true
  if (!passive || !isLikelyBot()) trackGoal('popup_open')
  useMapStore.getState().setSelectedId(item.id)
}
