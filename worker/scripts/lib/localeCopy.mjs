/**
 * Locale plumbing for the prerendered SEO pages (#693).
 *
 * The Chinese copy is NOT duplicated here: the generator imports the SPA's own
 * `src/i18n/zh/{pages,categories,metro}.ts` slices (Node type-strips them, so
 * those files must keep type-only imports) and hands them to `makeZhContext`.
 * This module is pure string logic.
 */

export const SITE = 'https://frolicmap.app'

/** Legend order, as DB category keys — mirrors LEGEND_CATEGORIES in prerenderShell. */
export const LEGEND_KEYS = [
  'playground', 'park', 'library', 'museum', 'aquarium', 'beach', 'waterplay',
  'hiking', 'campground',
]

/** `{{name}}` interpolation — the only i18next feature the copy uses. */
export function interpolate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
}

/** "a, b & c" with locale-specific separators. */
export function joinList(items, sep, lastSep) {
  if (items.length <= 1) return items.join('')
  return items.slice(0, -1).join(sep) + lastSep + items[items.length - 1]
}

/**
 * Build the zh rendering context from the SPA's locale slices.
 * `names` is `metro.names` (keyed by metro id); an id missing from it falls
 * back to the English label, same as `src/config/metroNames.ts`.
 */
export function makeZhContext({ citySeo, categories, names }) {
  const t = (key, vars) => interpolate(citySeo[key], vars)
  const categoryLabel = (c) => categories[c] ?? c
  const legendList = joinList(LEGEND_KEYS.map(categoryLabel), citySeo.separator, citySeo.lastSeparator)
  return {
    lang: 'zh',
    htmlLang: 'zh-Hans',
    prefix: '/zh',
    t,
    categoryLabel,
    legendList,
    metroName: (metro) => names[metro.id] ?? metro.label,
  }
}

/**
 * Reciprocal alternate links for one page, given its ENGLISH path. Every page
 * in the pair carries the identical trio, which is what makes the annotations
 * reciprocal; `x-default` points at English.
 */
export function hreflangLinks(enPath) {
  const en = `${SITE}${enPath}`
  const zh = `${SITE}/zh${enPath}`
  return (
    `<link rel="alternate" hreflang="en" href="${en}">\n` +
    `<link rel="alternate" hreflang="zh-Hans" href="${zh}">\n` +
    `<link rel="alternate" hreflang="x-default" href="${en}">`
  )
}
