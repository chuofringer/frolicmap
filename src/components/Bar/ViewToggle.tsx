import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { trackGoal } from '@/utils/analytics'

/**
 * Map | List | Calendar segmented control. Lives in the consolidated bar and,
 * on mobile, also in the ListPanel/CalendarPanel headers — so returning to map
 * view never depends on the chip row (which the panels can occlude on small
 * screens). The calendar is sign-in-gated, but the segment carries no lock
 * glyph (operator decision 2026-07-27): everyone can tap it, and the panel
 * itself shows the sign-in gate to signed-out visitors — the tap IS the
 * demand signal (`calendar_gate_view`).
 */
export function ViewToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const viewMode = useMapStore((s) => s.viewMode)
  const setViewMode = useMapStore((s) => s.setViewMode)
  const set = (v: 'map' | 'list' | 'calendar') => { if (v !== viewMode) { setViewMode(v); trackGoal('view_toggle', v) } }
  const seg = (v: 'map' | 'list' | 'calendar', label: string, ariaLabel?: string) => (
    <button
      type="button"
      onClick={() => set(v)}
      aria-pressed={viewMode === v}
      aria-label={ariaLabel}
      className={`text-xs rounded-full transition-colors whitespace-nowrap ${compact ? 'px-2.5 py-1' : 'px-4 py-1.5'} ${viewMode === v ? 'bg-amber-500 text-white font-bold' : 'text-gray-500 dark:text-gray-400 font-semibold'}`}
    >{label}</button>
  )
  // Compact (mobile bar) drops to an emoji so three segments still fit the
  // thumb-zone pill on 320px screens.
  return (
    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 flex-shrink-0">
      {seg('map', t('bar.map'))}
      {seg('list', t('bar.list'))}
      {seg('calendar', compact ? '📅' : t('calendar.calendar'), t('calendar.calendar'))}
    </div>
  )
}
