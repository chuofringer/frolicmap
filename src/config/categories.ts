import type { Category } from '@shared/types'
import { seasonalEmoji } from '@shared/seasonalEmoji'
import { CATEGORY_COLOR, CATEGORY_FOLD } from '@shared/categorySlugs'
import { i18next } from '@/i18n'

export interface CategoryMeta {
  emoji: string
  color: string     // hex, for map pin — sourced from CATEGORY_COLOR (shared)
}

// Pin colours live in `shared/categorySlugs.ts::CATEGORY_COLOR` so the static
// `/cities` card dots and these SPA markers stay byte-identical. Only the emoji
// is SPA-local; the `color` is spread in from the shared map.
//
// Labels are NOT here — they are translated copy and live in
// `src/i18n/en/categories.ts`. Read them through `categoryLabel()` below.
export const CATEGORIES: Record<Category, CategoryMeta> = {
  playground: { emoji: '🎢', color: CATEGORY_COLOR.playground },
  museum:     { emoji: '🏛️', color: CATEGORY_COLOR.museum },
  library:    { emoji: '📚', color: CATEGORY_COLOR.library },
  park:       { emoji: '🌳', color: CATEGORY_COLOR.park },
  aquarium:   { emoji: '🐠', color: CATEGORY_COLOR.aquarium },
  // Same color as aquarium (one combined "Aquarium/Zoo" legend entry, one
  // dot); the emoji differs only at high zoom where pins show their glyph.
  zoo:        { emoji: '🦁', color: CATEGORY_COLOR.zoo },
  beach:      { emoji: '🏖️', color: CATEGORY_COLOR.beach },
  waterplay:  { emoji: '💦', color: CATEGORY_COLOR.waterplay },
  hiking:     { emoji: '🥾', color: CATEGORY_COLOR.hiking },
  campground: { emoji: '🏕️', color: CATEGORY_COLOR.campground },
  event:      { emoji: '🎪', color: CATEGORY_COLOR.event },
  upick:      { emoji: '🍓', color: CATEGORY_COLOR.upick },
  birthday_party: { emoji: '🎂', color: CATEGORY_COLOR.birthday_party },
  restaurant: { emoji: '🍔', color: CATEGORY_COLOR.restaurant },
}

/**
 * The category's display label in the active locale — the legend vocabulary.
 *
 * Read this instead of a `.label` field (which deliberately no longer exists,
 * so the compiler finds every render site). Safe to call outside React: it
 * reads the same default i18next instance `useTranslation` does.
 *
 * The category **slug** (`cat` itself) is never translated — it is a `?cat=`
 * deep-link key and a search term.
 */
export function categoryLabel(cat: Category): string {
  return i18next.t(`categories.${cat}`)
}

export const CATEGORY_ORDER = [
  'playground', 'park', 'library', 'museum', 'aquarium', 'zoo', 'beach', 'waterplay', 'hiking', 'campground', 'birthday_party', 'restaurant', 'upick', 'event',
] as const satisfies readonly Category[]

/**
 * Categories that are parked with no launch plan (#199 birthday party, #200
 * restaurant — both P3, zero rows in any metro). Kept out of every public
 * chip/legend surface (operator call 2026-08-25): a permanent "coming soon"
 * row for a category that isn't coming reads as broken, not as a teaser —
 * unlike metro-scoped coming-soon chips, whose category IS live somewhere.
 * Admin surfaces keep the full CATEGORY_ORDER.
 */
const PARKED_CATEGORIES: ReadonlySet<Category> = new Set(['birthday_party', 'restaurant'])

/**
 * Chip/legend render order — CATEGORY_ORDER minus folded categories (#323)
 * and parked ones (above). `zoo` has no row of its own: the aquarium chip
 * renders as "Aquarium/Zoo" and speaks for both. Legend, filter chips and
 * the /cities vocabulary list iterate THIS; admin surfaces (PendingQueue)
 * keep the full CATEGORY_ORDER because curators triage the real DB
 * categories.
 */
export const CHIP_ORDER: readonly Category[] = CATEGORY_ORDER.filter(
  (c) => !(c in CATEGORY_FOLD) && !PARKED_CATEGORIES.has(c),
)

/**
 * Every DB category a chip covers: the chip's own category plus everything
 * folded into it. `chipCategories('aquarium')` → `['aquarium', 'zoo']`; a
 * non-host category resolves through its host first, so
 * `chipCategories('zoo')` returns the same group (useUrlCategory relies on
 * that to make `?cat=zoo` and `?cat=aquarium` open the same combined filter).
 */
export function chipCategories(cat: Category): readonly Category[] {
  const host = CATEGORY_FOLD[cat] ?? cat
  const folded = (Object.keys(CATEGORY_FOLD) as Category[]).filter(
    (m) => CATEGORY_FOLD[m] === host,
  )
  return [host, ...folded]
}

// Compile-time completeness guard: CATEGORY_ORDER must contain EVERY
// Category. `Record<Category, CategoryMeta>` already forces CATEGORIES
// above to be exhaustive, but a plain `Category[]` annotation lets an
// omission compile — and a category missing here has no filter chip, no
// legend entry, and no admin pending-queue group. Same AssertEqual trick
// as LIST_ITEM_FIELDS in shared/types.ts.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _categoryOrderExhaustive: AssertEqual<(typeof CATEGORY_ORDER)[number], Category> = true
void _categoryOrderExhaustive

// Per-render emoji for a category. upick rotates monthly (strawberry Mar-May,
// cherry Jun, peach Jul-Aug, apple Sep-Oct, pumpkin Nov-Feb); all other
// categories return their static `CATEGORIES[cat].emoji`. Date parameter
// exists for testability; callers normally omit it.
export function getCategoryEmoji(cat: Category, date: Date = new Date()): string {
  if (cat === 'upick') return seasonalEmoji(date)
  return CATEGORIES[cat].emoji
}
