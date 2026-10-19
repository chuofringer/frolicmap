import { useTranslation } from 'react-i18next'

export function FiltersButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
     
      className={`backdrop-blur-md ${active ? 'bg-white dark:bg-gray-900' : 'bg-white/90 dark:bg-gray-900/90'} text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-white dark:hover:bg-gray-900 transition-colors`}
      title={t('filters.settingsTitle')}
      aria-label={t('filters.settingsAriaLabel')}
    >
      {/* Gear icon */}
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  )
}
