import { Popup } from 'react-map-gl/maplibre'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { useItems } from '@/hooks/useItems'
import { CATEGORIES } from '@/config/categories'
import { openItemDetail } from '@/utils/openItem'
import { displayTitle } from '@/utils/displayTitle'

// Rendered when a click lands on 2+ pins within a few pixels of each
// other (see FunMap's click handler). Instead of opening whichever pin
// MapLibre happened to list first, we surface a lightweight picker so
// every overlapping feature stays reachable (e.g. a park, the playground
// inside it, and the library next door).
export function StackedFeatureList() {
  const { t } = useTranslation()
  const cluster = useMapStore((s) => s.stackedFeatures)
  const setStacked = useMapStore((s) => s.setStackedFeatures)
  const { data } = useItems()

  if (!cluster) return null

  const itemsById = new Map(data?.items.map((i) => [i.id, i]) ?? [])

  // Alphabetical by name, so the order is stable between clicks.
  const rows = [...cluster.features].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Popup
      longitude={cluster.lng}
      latitude={cluster.lat}
      anchor="bottom"
      offset={12}
      closeButton={false}
      closeOnClick={false}
      onClose={() => setStacked(null)}
      maxWidth="300px"
      className="frolicmap-popup"
    >
      <div className="text-gray-900 dark:text-gray-100" style={{ minWidth: '220px', maxWidth: '280px' }}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {t('detail.itemsHere', { count: rows.length })}
          </div>
          <button
            aria-label={t('detail.close')}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none flex-shrink-0 -mr-1 -mt-1"
            onClick={() => setStacked(null)}
          >×</button>
        </div>
        <ul
          className="divide-y divide-gray-200 dark:divide-gray-700 overflow-y-auto overscroll-contain"
          style={{ maxHeight: '10.5rem' }}
        >
          {rows.map((f) => {
            const meta = CATEGORIES[f.category]
            const item = itemsById.get(f.id)
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className="w-full text-left py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 -mx-1 px-1 rounded"
                  onClick={() => {
                    openItemDetail(item ?? f)
                  }}
                >
                  <span className="text-base leading-none">{meta?.emoji ?? '❓'}</span>
                  <span className="text-sm truncate flex-1 text-gray-600 dark:text-gray-300">{displayTitle(item ?? f).title}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Popup>
  )
}
