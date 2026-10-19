import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { trackGoal } from '@/utils/analytics'

/**
 * Map | List segmented control. Lives in the consolidated bar and, on mobile,
 * also in the ListPanel header, so returning to map view never depends on the
 * chip row (which the panel can occlude on small screens).
 */
export function ViewToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const viewMode = useMapStore((s) => s.viewMode)
  const setViewMode = useMapStore((s) => s.setViewMode)
  const set = (v: 'map' | 'list') => { if (v !== viewMode) { setViewMode(v); trackGoal('view_toggle') } }
  const seg = (v: 'map' | 'list', label: string) => (
    <button
      type="button"
      onClick={() => set(v)}
      aria-pressed={viewMode === v}
      className={`text-xs rounded-full transition-colors whitespace-nowrap ${compact ? 'px-2.5 py-1' : 'px-4 py-1.5'} ${viewMode === v ? 'bg-amber-500 text-white font-bold' : 'text-gray-500 dark:text-gray-400 font-semibold'}`}
    >{label}</button>
  )
  return (
    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 flex-shrink-0">
      {seg('map', t('bar.map'))}
      {seg('list', t('bar.list'))}
    </div>
  )
}
