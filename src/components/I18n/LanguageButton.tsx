import { useTranslation } from 'react-i18next'
import { switchLocale, type Locale } from '@/i18n/locale'
import { trackGoal } from '@/utils/analytics'

/**
 * One-tap language toggle, sitting in the persistent top-right control cluster
 * on both desktop and mobile.
 *
 * The label is the language you'd GET, not the one you're in: 中文 while
 * reading English, EN while reading Chinese. With exactly two locales a toggle
 * beats a menu — one tap, no intermediate surface.
 *
 * It reads as an icon-sized control but the glyphs are the words themselves,
 * so nothing has to be decoded. A globe would say "language settings exist"
 * without saying which languages, and a flag would be plain wrong — flags mark
 * countries, not languages, and no flag stands for Chinese.
 *
 * Previously this lived only in the FAQ overlay footer, which meant finding it
 * required already suspecting it was there.
 */
const NEXT: Record<Locale, { next: Locale; label: string; title: string }> = {
  en: { next: 'zh', label: '中文', title: '切换到中文' },
  zh: { next: 'en', label: 'EN', title: 'Switch to English' },
}

export function LanguageButton({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const current = (i18n.resolvedLanguage ?? 'en') as Locale
  const { next, label, title } = NEXT[current] ?? NEXT.en

  return (
    <button
      type="button"
      // Both the title and the label are in the TARGET language — the person
      // who needs this control is, by definition, looking for that language.
      title={title}
      aria-label={title}
      lang={next === 'zh' ? 'zh-Hans' : 'en'}
      onClick={() => { trackGoal('lang_switch', next); switchLocale(next) }}
      className={`w-11 h-11 flex items-center justify-center backdrop-blur-md bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 hover:bg-white dark:hover:bg-gray-900 transition-colors font-semibold ${next === 'zh' ? 'text-base' : 'text-sm tracking-tight'} ${className ?? ''}`}
    >
      {label}
    </button>
  )
}
