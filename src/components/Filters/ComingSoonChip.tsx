import { useTranslation } from 'react-i18next'

// UI-only roadmap placeholder: Events is NOT a data category, so this chip
// never touches the filter store and is never a pin/legend entry.
const BASE = 'flex items-center gap-2 whitespace-nowrap border bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-transparent cursor-default'
const VARIANTS = {
  grid: 'px-3 py-2 rounded-lg text-sm justify-start',
  inline: 'rounded-full px-3 py-1.5 text-xs font-semibold flex-shrink-0',
} as const

export function ComingSoonChip({ variant = 'grid' }: { variant?: keyof typeof VARIANTS }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={t('filters.eventsComingSoonTitle')}
      className={`${BASE} ${VARIANTS[variant]}`}
    >
      <span aria-hidden className={variant === 'grid' ? 'text-base' : undefined}>🎟️</span>
      <span>{t('filters.eventsChip')}</span>
      <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-300">
        {t('filters.comingSoon')}
      </span>
    </button>
  )
}
