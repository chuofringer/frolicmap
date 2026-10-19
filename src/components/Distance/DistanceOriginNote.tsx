import { useTranslation } from 'react-i18next'
import { useDistanceOriginInfo } from '@/hooks/useDistanceOrigin'

/**
 * One-line caption naming the point every "X.X mi" on the surface below is
 * measured from.
 *
 * The list and calendar both sort/label by distance, and both used to show a
 * bare number: "3.2 mi" from where? From the device? From the metro? From the
 * pin you last tapped? Each answer implies a different trip, so the number was
 * effectively unreadable. This states the origin once, at the top, instead of
 * repeating it on every card — and when the origin is the map center (the
 * default, since Near-me is opt-in) it also says how to change it.
 */
export function DistanceOriginNote() {
  const { t } = useTranslation()
  const { source } = useDistanceOriginInfo()
  return (
    <p className="flex-shrink-0 px-4 py-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800">
      <span aria-hidden className="mr-1">{source === 'geo' ? '📍' : '🧭'}</span>
      {source === 'geo' ? t('common.distanceFromYou') : t('common.distanceFromMapCenter')}
    </p>
  )
}
