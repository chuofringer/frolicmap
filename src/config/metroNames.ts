import type { Metro } from '@shared/metros'
import { i18next } from '@/i18n'

/**
 * A metro's display name in the active locale.
 *
 * `shared/metros.ts` stays English — it is generator-facing (the SEO page
 * builder and the worker read it), so translations live in the locale files
 * keyed by metro id, and this is the single lookup both the city picker and
 * the FAQ go through. Two call sites resolving a city's name differently is
 * how you end up rendering a half-translated sentence.
 *
 * A metro with no translated name falls back to its English label, so adding a
 * metro to the registry never blocks on translation.
 */
export function metroName(metro: Metro): string {
  return i18next.t(`metro.names.${metro.id}`, { defaultValue: metro.label })
}

/**
 * The picker-trigger variant, which has a narrow box to sit in.
 *
 * English deliberately does NOT go through the locale files here: `names`
 * carries each metro's *long* label, so a lookup would return "San Francisco
 * Bay Area" exactly where `shortLabel` ("SF Bay Area") is needed. Chinese city
 * names are short enough that one entry serves both lengths, so only
 * non-English locales consult the translation.
 */
export function metroShortName(metro: Metro): string {
  const fallback = metro.shortLabel ?? metro.label
  if ((i18next.resolvedLanguage ?? 'en') === 'en') return fallback
  return i18next.t(`metro.names.${metro.id}`, { defaultValue: fallback })
}
