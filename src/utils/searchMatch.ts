import type { Category, ListItem } from '@shared/types'
import { CATEGORY_SLUG } from '@shared/categorySlugs'

/**
 * Issue #212 — parent-speak keyword search.
 *
 * `/api/items.json` (what `useItems` loads) is the redacted `ListItem` shape:
 * no `description`. Search is deliberately
 * "fuzzy matching against already-loaded fields only" rather than growing the
 * payload (explicit non-goal), so this module only ever looks at `name`,
 * `category`, `indoor`, and `cost` — every field a synonym rule below
 * tests against is one `ListItem` already carries.
 *
 * A predicate (`indoor`/`cost`) narrows a synonym match to items that also
 * satisfy it — "free indoor" requires both, not either.
 */
export interface SearchSynonymRule {
  categories?: Category[]
  indoor?: 0 | 1
  cost?: 'free'
}

/**
 * Curated parent-speak → filter-predicate table (issue #212). Keys are
 * lowercase, single words matched against individual query tokens — add
 * multi-word phrases only if a token-level match would misfire.
 *
 * English-only for now: there's no localized parent-speak corpus to draw
 * synonyms from yet. Chinese queries still get full value from the
 * locale-aware name/category-label/slug matching in `matchesActivity` — this
 * table just doesn't add extra keywords for them. Revisit if Chinese-speaking
 * parents report the gap.
 */
const SEARCH_SYNONYMS: Record<string, SearchSynonymRule> = {
  trampoline: { categories: ['playground'] },
  climbing: { categories: ['playground', 'park'] },
  climb: { categories: ['playground', 'park'] },
  storytime: { categories: ['library'] },
  toddler: { categories: ['playground', 'library'] },
  splash: { categories: ['waterplay'] },
  swim: { categories: ['waterplay', 'beach'] },
  trail: { categories: ['hiking'] },
  hike: { categories: ['hiking'] },
  camp: { categories: ['campground'] },
  camping: { categories: ['campground'] },
  zoo: { categories: ['aquarium'] },
  book: { categories: ['library'] },
  books: { categories: ['library'] },
  reading: { categories: ['library'] },
  art: { categories: ['museum'] },
  history: { categories: ['museum'] },
  free: { cost: 'free' },
  indoor: { indoor: 1 },
  rainy: { indoor: 1 },
}

function tokenize(q: string): string[] {
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean)
}

interface ResolvedPredicate {
  categories: Category[]
  indoor?: 0 | 1
  cost?: 'free'
}

/**
 * Union the categories/predicates named by every recognized token in the
 * query. Returns `null` when no token matches anything, so callers can tell
 * "no synonym applies" apart from "synonym applies but excludes this item".
 */
function synonymPredicate(tokens: string[]): ResolvedPredicate | null {
  let matched = false
  const categories = new Set<Category>()
  let indoor: 0 | 1 | undefined
  let cost: 'free' | undefined
  for (const token of tokens) {
    const rule = SEARCH_SYNONYMS[token]
    if (!rule) continue
    matched = true
    rule.categories?.forEach((c) => categories.add(c))
    if (rule.indoor !== undefined) indoor = rule.indoor
    if (rule.cost !== undefined) cost = rule.cost
  }
  return matched ? { categories: [...categories], indoor, cost } : null
}

export type MatchableItem = Pick<ListItem, 'category' | 'indoor' | 'cost'>

/**
 * Whether `item` matches free-text `query` beyond plain name substring —
 * category label, category slug (the `?cat=` deep-link vocabulary — see
 * `shared/categorySlugs.ts`), or the curated
 * synonym table (§ above), AND-ing in the synonym's `indoor`/`cost`
 * predicate when it names one.
 *
 * `categoryLabel` is injected so this stays a pure function testable without
 * an i18next instance — callers pass `categoryLabel` from
 * `@/config/categories`, which is locale-aware.
 */
export function matchesActivity(
  item: MatchableItem,
  query: string,
  categoryLabel: (c: Category) => string,
): boolean {
  const q = query.toLowerCase().trim()
  if (q.length < 2) return false

  if (categoryLabel(item.category).toLowerCase().includes(q)) return true
  if (CATEGORY_SLUG[item.category].toLowerCase().includes(q)) return true
  if (item.category.includes(q)) return true

  const predicate = synonymPredicate(tokenize(q))
  if (!predicate) return false
  if (predicate.categories.length > 0 && !predicate.categories.includes(item.category)) return false
  if (predicate.indoor !== undefined && item.indoor !== predicate.indoor) return false
  if (predicate.cost !== undefined && item.cost !== predicate.cost) return false
  return true
}
