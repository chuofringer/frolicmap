import { activeLocale } from '@/i18n'
import type { Locale } from '@/i18n/locale'

/**
 * How an item's title renders in the active locale (#692).
 *
 * `subtitle` is the English name kept alongside a Chinese title, not a
 * generic second line: a venue title is a proper noun, and it is the string a
 * parent types into Maps or reads out to a driver. Replacing "Golden Gate
 * Park" with 金门公园 outright would translate the label and lose the key, so
 * both ship and the surface renders English underneath.
 *
 * Titles are the ONLY translated item field — `description` and `address` stay
 * English in both locales by decision, so there is no matching helper for
 * them and no half-translated-card state to design around.
 */
export interface DisplayTitle {
  /** What the title line shows. */
  title: string
  /** Secondary line, or null when there is nothing to add under `title`. */
  subtitle: string | null
}

/**
 * `locale` is injectable for tests; production callers read the active one.
 *
 * A translation equal to the English name yields no subtitle — that is what a
 * translator leaves behind on a venue whose name shouldn't change ("YMCA"),
 * and echoing it twice reads like a rendering bug. Blank strings are treated
 * as absent: the admin editor normalizes them to null, but the column is
 * nullable TEXT and this is the one place that assumption is load-bearing.
 */
export function displayTitle(
  item: { name: string; name_zh?: string | null },
  locale: Locale = activeLocale(),
): DisplayTitle {
  const translated = item.name_zh?.trim()
  if (locale !== 'zh' || !translated || translated === item.name.trim()) {
    return { title: item.name, subtitle: null }
  }
  return { title: translated, subtitle: item.name }
}

/**
 * Single-line form — `金门公园 (Golden Gate Park)` — for surfaces with no room
 * for a second line.
 *
 * Used by the search suggestion list specifically, where it isn't a nicety:
 * `titleHaystack` matches the English name too, so a Chinese reader typing
 * "golden" gets a row whose only visible text is Chinese, and the match looks
 * arbitrary until the English is shown next to it.
 */
export function inlineTitle(item: { name: string; name_zh?: string | null }): string {
  const { title, subtitle } = displayTitle(item)
  return subtitle ? `${title} (${subtitle})` : title
}

/**
 * Every string a title could be matched against, for search.
 *
 * Search must find a venue by its Chinese title AND its English name, in
 * either locale — a bilingual reader types whichever comes to mind, and the
 * English name is the one printed on the building. Locale-independent on
 * purpose: matching only the displayed string would make a venue findable in
 * one language and invisible in the other.
 */
export function titleHaystack(item: { name: string; name_zh?: string | null }): string[] {
  const translated = item.name_zh?.trim()
  return translated && translated !== item.name.trim() ? [item.name, translated] : [item.name]
}
