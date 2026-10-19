import type { Category } from './types'

/**
 * URL slugs for categories — issue #356, plan §3.2.
 *
 * **Category slugs are search terms, not DB values.** The plan is explicit
 * about this: people search "splash pads near me", not "waterplay"; "zoos and
 * aquariums", not "aquarium". The DB value is our internal vocabulary, the
 * slug is the query we want to rank for, and conflating them would cost the
 * traffic the static pages exist to capture.
 *
 * Lives next to `config/categories.ts` conceptually but in `shared/` because
 * the page generator (plain Node) and the SPA both need it.
 */
export const CATEGORY_SLUG: Record<Category, string> = {
  playground: 'playgrounds',
  park: 'parks',
  library: 'libraries',
  museum: 'museums',
  aquarium: 'zoos-aquariums',
  beach: 'beaches',
  waterplay: 'splash-pads',
  hiking: 'hiking-trails',
  campground: 'camping',
  // Never a page of its own — zoo folds into aquarium's display everywhere
  // (CATEGORY_FOLD below); aquarium's `zoos-aquariums` slug already carries
  // the search intent. Present only because the Record must be exhaustive.
  zoo: 'zoos',
}

/**
 * Display folding (#323): categories with no legend row / filter chip / page
 * of their own. `zoo` renders under `aquarium` — the chip reads "Aquarium/Zoo"
 * and toggling it filters both DB values. The DB vocabulary stays split (a zoo
 * is not an aquarium; `indoor`, ingest legs and admin grouping differ) — only
 * the user-facing affordance is combined.
 *
 * Lives here (not `src/config/categories.ts`) because the plain-Node page
 * generator folds SEO category counts with the same map.
 */
export const CATEGORY_FOLD: Partial<Record<Category, Category>> = {
  zoo: 'aquarium',
}

/**
 * Plural, human-facing label used in page titles and headings.
 *
 * MUST match the SPA legend vocabulary (`src/config/categories.ts` labels),
 * pluralized where natural — a static page saying "Splash Pads" while the map
 * legend says "Water Play" reads as two different products. Slugs above are
 * intentionally different: they're search terms, these are our names.
 */
export const CATEGORY_PLURAL: Record<Category, string> = {
  playground: 'Playgrounds',
  park: 'Parks',
  library: 'Libraries',
  museum: 'Museums',
  aquarium: 'Aquariums/Zoos',
  beach: 'Beaches',
  waterplay: 'Water Play',
  hiking: 'Hiking',
  campground: 'Campgrounds',
  // Unreachable on pages (folded into aquarium, see CATEGORY_FOLD) — here for
  // Record exhaustiveness only.
  zoo: 'Zoos',
}

/**
 * Per-category map-pin colour (hex). Single source of truth shared by the SPA
 * legend/markers (`src/config/categories.ts` spreads these) and the static
 * `/cities` card pins (`renderMapCard`). Kept here in `shared/` so the plain-Node
 * page generator and the SPA read the exact same values — a card dot and a map
 * marker for the same category must never drift apart.
 */
export const CATEGORY_COLOR: Record<Category, string> = {
  playground: '#f59e0b',
  museum: '#8b5cf6',
  library: '#3b82f6',
  park: '#10b981',
  aquarium: '#06b6d4',
  beach: '#84cc16',
  waterplay: '#0369a1',
  hiking: '#65a30d',
  campground: '#a16207',
  // Shares aquarium's teal deliberately — the legend presents one combined
  // "Aquarium/Zoo" entry with one dot, so the pins must read as one category.
  zoo: '#06b6d4',
}

const BY_SLUG = new Map<string, Category>(
  (Object.entries(CATEGORY_SLUG) as [Category, string][]).map(([cat, slug]) => [slug, cat]),
)

export function categoryForSlug(slug: string): Category | undefined {
  return BY_SLUG.get(slug)
}

/**
 * Slugify a name for `/place/{slug}` URLs.
 *
 * Strips diacritics so "Peña Adobe Park" becomes `pena-adobe-park` rather than
 * dropping the character and colliding with a different park.
 */
export function slugify(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
