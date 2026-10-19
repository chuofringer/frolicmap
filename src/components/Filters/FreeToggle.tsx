import { useTranslation } from 'react-i18next'
import { useFiltersStore } from '@/stores/useFiltersStore'

export function FreeToggle() {
  const { freeOnly, setFreeOnly, indoorOnly, outdoorOnly, setIndoorOutdoor } = useFiltersStore()
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700 dark:text-gray-200">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} className="w-4 h-4 accent-amber-500" />
        {t('filters.freeOnly')}
      </label>
      <select
        className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-base md:text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        value={indoorOnly ? 'indoor' : outdoorOnly ? 'outdoor' : 'any'}
        onChange={(e) => setIndoorOutdoor(e.target.value as 'indoor' | 'outdoor' | 'any')}
      >
        <option value="any">{t('filters.indoorAndOutdoor')}</option>
        <option value="indoor">{t('filters.indoorOnly')}</option>
        <option value="outdoor">{t('filters.outdoorOnly')}</option>
      </select>
    </div>
  )
}
