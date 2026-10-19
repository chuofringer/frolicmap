import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFiltersStore } from '@/stores/useFiltersStore'

const MAX_AGE = 18

export function AgeSlider() {
  const { ageMin, ageMax, setAge } = useFiltersStore()
  const { t } = useTranslation()
  const [minStr, setMinStr] = useState(String(ageMin))
  const [maxStr, setMaxStr] = useState(String(ageMax))

  // Keep local strings in sync when the store changes externally (e.g. Reset).
  useEffect(() => { setMinStr(String(ageMin)) }, [ageMin])
  useEffect(() => { setMaxStr(String(ageMax)) }, [ageMax])

  const onMinChange = (raw: string) => {
    setMinStr(raw)
    if (raw === '') return
    const n = Number(raw)
    if (Number.isNaN(n)) return
    const clamped = Math.max(0, Math.min(MAX_AGE, Math.floor(n)))
    setAge(clamped, Math.max(clamped, ageMax))
  }

  const onMaxChange = (raw: string) => {
    setMaxStr(raw)
    if (raw === '') return
    const n = Number(raw)
    if (Number.isNaN(n)) return
    const clamped = Math.max(0, Math.min(MAX_AGE, Math.floor(n)))
    setAge(Math.min(ageMin, clamped), clamped)
  }

  const onMinBlur = () => {
    if (minStr === '') {
      setAge(0, ageMax)
      setMinStr('0')
    }
  }

  const onMaxBlur = () => {
    if (maxStr === '') {
      setAge(ageMin, MAX_AGE)
      setMaxStr(String(MAX_AGE))
    }
  }

  // text-base (16px) on mobile is intentional — iOS Safari auto-zooms the
  // viewport whenever a focused input has font-size < 16px. md:text-sm
  // keeps the desktop filter row compact.
  const inputCls = 'w-14 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-base md:text-sm text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400'

  return (
    <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_AGE}
        value={minStr}
        onChange={(e) => onMinChange(e.target.value)}
        onBlur={onMinBlur}
        aria-label={t('filters.minimumAge')}
        className={inputCls}
      />
      <span className="text-gray-400 dark:text-gray-500">{t('filters.ageTo')}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_AGE}
        value={maxStr}
        onChange={(e) => onMaxChange(e.target.value)}
        onBlur={onMaxBlur}
        aria-label={t('filters.maximumAge')}
        className={inputCls}
      />
    </div>
  )
}
