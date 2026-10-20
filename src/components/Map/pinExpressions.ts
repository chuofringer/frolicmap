import type { ExpressionSpecification } from 'maplibre-gl'
import type { Category } from '@shared/types'
import { CATEGORIES } from '@/config/categories'
import { EMOJI_ICON_FALLBACK_ID, emojiIconId } from './emojiIcons'

// Build a MapLibre `match` expression over the CATEGORIES config at module
// load time. Keeps the vector-tile layer's styling in sync with the config
// automatically — add a category to `categories.ts` and both the legend
// (already reads from CATEGORIES) and the map pin colour/icon update together.
//
// `unknown`-returning instead of a narrow ExpressionSpecification because
// MapLibre's `match` with N stops is awkward to type precisely; the
// runtime value is a valid expression per the MapLibre style spec.
function matchOnCategory(value: (cat: Category) => string, fallback: string): unknown {
  const expr: (string | unknown[])[] = ['match', ['get', 'category']]
  for (const cat of Object.keys(CATEGORIES) as Category[]) {
    expr.push(cat, value(cat))
  }
  expr.push(fallback)
  return expr
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CATEGORY_COLOR_EXPR = matchOnCategory((cat) => CATEGORIES[cat].color, '#9ca3af') as any

// The pin glyph is an ICON IMAGE (`icon-image`), never a `text-field`: see
// emojiIcons.ts for why MapLibre cannot centre an emoji drawn as text. The
// images themselves are rasterised on demand by `installEmojiIcons`.
export const EMOJI_ICON_EXPR = matchOnCategory(emojiIconId, EMOJI_ICON_FALLBACK_ID) as unknown as ExpressionSpecification
