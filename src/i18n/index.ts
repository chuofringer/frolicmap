/**
 * i18n bootstrap (#208).
 *
 * Initialised **synchronously** with the English resources bundled inline, so
 * `t()` returns real text on the first render — no Suspense boundary, no
 * loading flash, and no provider needed. `useTranslation()` reads this default
 * instance, which is why `src/test-setup.ts` only has to import this module for
 * the whole existing test suite to keep asserting on English strings.
 *
 * Chinese is loaded lazily by `loadLocale()` before the app mounts, so the
 * English bundle never carries a translation it will not use.
 */
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en, type Resources } from './en'
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from './locale'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Resources }
  }
}

i18next.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  resources: { en: { translation: en } },
  // React already escapes everything it renders; i18next escaping on top of
  // that double-encodes apostrophes in copy like "What's on this weekend".
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

/**
 * Swap in a locale, fetching its bundle on demand. Called once during bootstrap
 * in `main.tsx`, before `createRoot`, so nothing renders in the wrong language.
 */
export async function loadLocale(locale: Locale): Promise<void> {
  if (locale !== 'en' && !i18next.hasResourceBundle(locale, 'translation')) {
    const { zh } = await import('./zh')
    i18next.addResourceBundle(locale, 'translation', zh)
  }
  await i18next.changeLanguage(locale)
  // Captured BEFORE we set it: a prerendered `/zh/cities/*` page (#693) is
  // served with `<html lang="zh-Hans">` and a per-metro Chinese <title>.
  const servedAsZh = document.documentElement.lang === 'zh-Hans'
  document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en'

  // Only a non-English page whose HTML was NOT already localised gets the
  // generic title. English pages keep whatever the served HTML set, and so do
  // prerendered zh pages: `build-seo-pages.mjs` writes a per-metro title into
  // each shell, and clobbering it at runtime would replace a ranking signal
  // with a generic string.
  if (locale !== 'en' && !servedAsZh) document.title = i18next.t('map.documentTitle')
}

/**
 * The active app locale.
 *
 * Read from i18next rather than the URL because it reflects what actually
 * LOADED: `loadLocale` is awaited before `createRoot`, so anything rendering
 * has its bundle, whereas `detectLocale(pathname)` would claim Chinese during
 * the window before the chunk arrives.
 */
export function activeLocale(): Locale {
  return (i18next.resolvedLanguage as Locale) ?? DEFAULT_LOCALE
}

/** BCP-47 tag for the active locale — pass this to every `Intl` formatter. */
export function intlLocale(): string {
  return INTL_LOCALE[activeLocale()] ?? INTL_LOCALE.en
}

export { i18next }
