import type { ExpressionSpecification } from 'maplibre-gl'
import { CATEGORIES } from '@/config/categories'

// U+FE0F (VARIATION SELECTOR-16) asks for emoji presentation. MapLibre's text
// shaper has no notion of it: it lays the selector out as its own glyph with a
// non-zero advance, which pushes the visible emoji up-left of the circle centre
// (the selector-bearing 🏛️ 🏖️ 🏕️). The config strings keep the selector for the
// legend/chips (DOM text, where the browser handles it); only the map's
// `text-field` strips it.
export function stripVariationSelectors(s: string): string {
  return s.replace(/\uFE0F/g, '')
}

// Build a MapLibre `match` expression over a `Record<Category, X>` map at
// module load time. Keeps the vector-tile layer's styling in sync with the
// CATEGORIES config automatically — add a category to `categories.ts` and
// both the legend (already reads from CATEGORIES) and the map pin
// color/emoji update together.
//
// `unknown`-returning instead of a narrow ExpressionSpecification because
// MapLibre's `match` with N stops is awkward to type precisely; the
// runtime value is a valid expression per the MapLibre style spec.
function matchOnCategory<K extends keyof (typeof CATEGORIES)['playground']>(
  key: K,
  fallback: (typeof CATEGORIES)['playground'][K],
  transform: (value: string) => string = (v) => v,
): unknown {
  const expr: (string | unknown[])[] = ['match', ['get', 'category']]
  for (const [cat, meta] of Object.entries(CATEGORIES)) {
    expr.push(cat, transform(meta[key] as string))
  }
  expr.push(transform(fallback as string))
  return expr
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CATEGORY_COLOR_EXPR = matchOnCategory('color', '#9ca3af') as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CATEGORY_EMOJI_EXPR = matchOnCategory('emoji', '❓', stripVariationSelectors) as any

export const EMOJI_EXPR = CATEGORY_EMOJI_EXPR as unknown as ExpressionSpecification

