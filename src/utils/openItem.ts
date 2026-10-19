import type { Category, ListItem } from '@shared/types'
import { isGatedEventKind } from '@shared/eventsGate'
import { trackGoal } from '@/utils/analytics'
import { isLikelyBot } from '@/utils/bot'
import { useEngagementStore } from '@/stores/useEngagementStore'
import { useMapStore } from '@/stores/useMapStore'

// A full `ListItem`, or the tile-feature shape FunMap / StackedFeatureList
// have in hand — id plus category/type is all the gate predicate needs.
type ItemOrSummary = ListItem | { id: string; category?: Category; type?: string }

/**
 * Shared "open this item's detail" sequence (#652). Every surface that
 * selects an item goes through here — map pin, list card, stack pick,
 * search suggestion, calendar entry, `?item=` deep link — so none of them
 * can forget one of the three steps (the bug class #652 was):
 *   1. `trackGoal('popup_open', id)` — the D1 funnel row plus the
 *      distinct-popup counter (`useEngagementStore.openedItemIds`) that
 *      arms the popup signup CTA.
 *   2. Bump `eventIntents` when the item is a gated event — the only thing
 *      that arms the sign-in nudge (#642).
 *   3. `setSelectedId(id)`.
 *
 * `passive: true` marks an open the visitor didn't perform — today only the
 * `?item=` deep link applied on page load (`useUrlItem`). It still selects
 * and still counts as a popup_open (a share-link arrival is a real detail
 * view and belongs in the funnel denominator), but:
 *   - it is bot-guarded like every other load-time goal (`trackMetroView`,
 *     `trackSessionStart`): crawlers fetch share links and the worker does
 *     no UA filtering, so an unguarded row would show up in /admin/behavior
 *     as a "tap";
 *   - it never bumps `eventIntents` — #642's readout measures EXPLICIT
 *     interest, and a nudge that fires after zero taps (arrive on an event
 *     link → unlock card → close → nudge) is two asks for no signal.
 *
 * Takes the item object, never a bare id: the intent bump needs the
 * category/type, and a string overload would let a caller skip it silently.
 */
export function openItemDetail(item: ItemOrSummary, opts: { passive?: boolean } = {}): void {
  const passive = opts.passive === true
  if (!passive || !isLikelyBot()) trackGoal('popup_open', item.id)
  if (!passive && isGatedEventKind(item)) useEngagementStore.getState().bumpEventIntent()
  useMapStore.getState().setSelectedId(item.id)
}
