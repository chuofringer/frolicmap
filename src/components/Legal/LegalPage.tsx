import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function LegalPage({ title, lastUpdated, children }: { title: string; lastUpdated: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <Link to="/" className="font-bold text-lg whitespace-nowrap">
          <span style={{ color: '#f59e0b' }}>frolicmap</span>
          <span className="text-gray-700 dark:text-gray-300">.app</span>
        </Link>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-100">
          {t('pages.backToMap')}
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-1">{title}</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">{t('pages.legal.lastUpdated', { date: lastUpdated })}</p>
        <div className="prose-legal flex flex-col gap-4 text-sm leading-relaxed">{children}</div>
        <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
          <Link to="/terms" className="hover:underline">{t('pages.legal.termsLink')}</Link>
          <Link to="/privacy" className="hover:underline">{t('pages.legal.privacyLink')}</Link>
          <span className="ml-auto">{t('pages.legal.copyright', { year: new Date().getFullYear() })}</span>
        </footer>
      </main>
    </div>
  )
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold mt-4 mb-1 text-gray-900 dark:text-gray-100">{children}</h2>
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-gray-700 dark:text-gray-300">{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-6 flex flex-col gap-1 text-gray-700 dark:text-gray-300">{children}</ul>
}
