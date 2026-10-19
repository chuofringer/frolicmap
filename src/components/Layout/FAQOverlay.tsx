import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMetro } from '@/hooks/useMetro'
import { metroShortName } from '@/config/metroNames'

export function FAQOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const metro = useMetro()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // `a0` is the only answer that names a place: it takes `metro.shortLabel`
  // in an article-free slot ("currently showing SF Bay Area" / "…Seattle").
  // Every other answer is written to hold in every published metro, so this
  // list stays a flat map with no per-metro branching.
  const FAQ_ITEMS: { q: string; a: string }[] = [
    { q: t('faq.items.q0'), a: t('faq.items.a0', { metro: metroShortName(metro) }) },
    { q: t('faq.items.q1'), a: t('faq.items.a1') },
    { q: t('faq.items.q2'), a: t('faq.items.a2') },
    { q: t('faq.items.q3'), a: t('faq.items.a3') },
    { q: t('faq.items.q4'), a: t('faq.items.a4') },
    { q: t('faq.items.q5'), a: t('faq.items.a5') },
    { q: t('faq.items.q6'), a: t('faq.items.a6') },
    { q: t('faq.items.q7'), a: t('faq.items.a7') },
    { q: t('faq.items.q8'), a: t('faq.items.a8') },
    { q: t('faq.items.q9'), a: t('faq.items.a9') },
    { q: t('faq.items.q10'), a: t('faq.items.a10') },
  ]

  return (
    <>
      <div className="fixed inset-0 z-50 md:hidden bg-black/40" onClick={onClose} />
      <div role="dialog" aria-label={t('faq.dialogAriaLabel')} className="fixed z-50 bg-white dark:bg-gray-900 shadow-xl ring-1 ring-black/20 dark:ring-white/10 inset-0 md:inset-auto md:top-16 md:right-3 md:w-[28rem] md:rounded-lg md:max-h-[calc(100dvh-80px)] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-base">{t('faq.heading')}</h2>
          <button aria-label={t('faq.closeAriaLabel')} onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border rounded-lg border-gray-200 dark:border-gray-700">
              <button
                aria-expanded={openIndex === i}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full text-left px-3 py-2.5 text-sm font-medium flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <span>{item.q}</span>
                <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${openIndex === i ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openIndex === i && (
                <div className="px-3 pb-3 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{item.a}</div>
              )}
            </div>
          ))}
          <ContactSection />
          <div className="flex items-center justify-center gap-3 text-xs text-gray-400 dark:text-gray-500 pt-2">
            <Link to="/terms" className="hover:underline">{t('faq.termsLink')}</Link>
            <span aria-hidden="true">{t('faq.dotSeparator')}</span>
            <Link to="/privacy" className="hover:underline">{t('faq.privacyLink')}</Link>
            <span aria-hidden="true">{t('faq.dotSeparator')}</span>
            <span>{t('faq.copyright')}</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">{t('faq.infoOnly')}</p>
        </div>
      </div>
    </>
  )
}

function ContactSection() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(t('faq.contactEmail')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard denied — ignore */ })
  }, [t])
  return (
    <div className="border rounded-lg border-gray-200 dark:border-gray-700 px-3 py-2.5 flex flex-col gap-1">
      <h3 className="text-sm font-medium">{t('faq.contactHeading')}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('faq.contactPrompt')}{' '}
        <button
          onClick={handleCopy}
          className="hover:underline cursor-pointer"
          style={{ color: '#f59e0b' }}
          title={t('faq.copyEmailTitle')}
        >
          {copied ? t('faq.emailCopied') : t('faq.contactEmail')}
        </button>
      </p>
    </div>
  )
}
