import '@testing-library/jest-dom/vitest'
// Initialises the default i18next instance with the real English resources.
// `useTranslation()` reads that instance without needing a provider, so `t()`
// returns exactly the strings components used to hardcode — which is why the
// suite keeps asserting on English text with no i18n-aware test wrapper.
import './i18n'
