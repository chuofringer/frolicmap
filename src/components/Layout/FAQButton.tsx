import { useTranslation } from 'react-i18next'

export function FAQButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
     
      className={`backdrop-blur-md ${active ? 'bg-white dark:bg-gray-900' : 'bg-white/90 dark:bg-gray-900/90'} text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-white dark:hover:bg-gray-900 transition-colors font-semibold text-lg`}
      title={t('faq.heading')}
      aria-label={t('faq.dialogAriaLabel')}
    >
      ?
    </button>
  )
}
