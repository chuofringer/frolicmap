import { useMapStore } from '@/stores/useMapStore'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { DetailPanel } from './DetailPanel'
import { BottomSheet } from './BottomSheet'

/**
 * Renders the selected item's detail as a desktop side panel or a mobile
 * bottom sheet — exactly one, chosen by a live media query (never both mounted
 * at once, which would put a hidden `role="dialog"` in the DOM). Replaced the
 * anchored `ItemPopup` render, which was deleted in #484 once panel parity was
 * confirmed.
 */
export function DetailOverlay() {
  const id = useMapStore((s) => s.selectedId)
  const isDesktop = useIsDesktop()
  if (!id) return null
  // Key on the selected id so a sibling switch remounts the surface: scroll,
  // menu, copied-toast and snap state reset to their initial values without an
  // id-change effect.
  return isDesktop ? <DetailPanel key={id} /> : <BottomSheet key={id} />
}
