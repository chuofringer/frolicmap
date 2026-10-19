import { useTranslation } from 'react-i18next'

export function Brand() {
  const { t } = useTranslation()
  return (
    <div className="backdrop-blur-md bg-white/90 dark:bg-gray-900/90 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 px-4 py-2 whitespace-nowrap">
      <div className="font-bold text-lg leading-tight">
        <span style={{ color: '#f59e0b' }}>{t('map.brandName')}</span>
        <span className="text-gray-700 dark:text-gray-300">{t('map.brandSuffix')}</span>
      </div>
      <div className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">
        {t('map.developedBy')}{' '}
        <a
          href="https://vibemapper.dev"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted underline-offset-2 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
        >
          {t('map.developerName')}
        </a>
      </div>
    </div>
  )
}
