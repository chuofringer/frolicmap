export type ItemType = 'place'

// Single runtime source of truth for the category vocabulary; the
// `Category` type is derived from it. Runtime consumers (validators, tests)
// import THIS array instead of keeping hand-copied mirrors, which eliminates
// a drift class where a new category lands in the D1 CHECK but a hand-kept
// copy keeps rejecting it. The D1 CHECK list in worker/migrations/0001_init.sql
// must still match (the migration test inserts every value).
export const ALL_CATEGORIES = [
  'playground',
  'museum',
  'library',
  'park',
  'aquarium',
  'beach',
  'hiking',
  'campground',
  'waterplay',
  'zoo',
] as const

export type Category = (typeof ALL_CATEGORIES)[number]

// The D1 CHECK constraint (worker/migrations/0001_init.sql) allows exactly
// these values. 'imls', 'parkserve' and 'nps' are the national structured
// importers (trusted sources that auto-approve at Tier C), 'osm' is the
// Overpass ingest, and 'manual' is a curator addition.
export type SourceType = 'osm' | 'imls' | 'parkserve' | 'nps' | 'manual'

/**
 * Source types trusted enough to land `status='approved'` without curator
 * review (plan §1.6) — the deliberate exception to the "all ingestion lands
 * pending" rule. Authoritative government/NGO datasets only: LLM-extracted
 * and curated rows still land pending.
 */
export const TRUSTED_SOURCE_TYPES = [
  'osm',
  'imls',
  'parkserve',
  'nps',
] as const satisfies readonly SourceType[]

export function isTrustedSourceType(t: SourceType): boolean {
  return (TRUSTED_SOURCE_TYPES as readonly SourceType[]).includes(t)
}

export type Confidence = 'high' | 'medium' | 'low'

export type ItemStatus = 'pending' | 'approved' | 'rejected' | 'archived'

export interface Item {
  id: string
  type: ItemType
  name: string
  description: string | null
  category: Category
  lat: number
  lng: number
  address: string | null
  age_min: number | null
  age_max: number | null
  cost: 'free' | 'paid' | null
  price_usd: number | null
  indoor: 0 | 1 | null
  opening_hours: string | null
  photo_url: string | null
  // Human-readable attribution line for `photo_url` (migration 0001), e.g.
  // "Photo: Jane Doe / Wikimedia Commons (CC BY-SA 4.0)". Only ever set
  // alongside a `photo_url` sourced from OSM's `image`/`wikimedia_commons`
  // tags or the Wikimedia Commons API — both carry an attribution
  // requirement. Null whenever photo_url is null; the detail UI renders the
  // attribution line only when this is non-empty.
  photo_attribution: string | null
  website: string | null
  source_url: string
  source_type: SourceType
  confidence: Confidence
  status: ItemStatus
  last_verified: string              // ISO8601
  created_at: string
  updated_at: string
  // National expansion columns. Rows written without a region take
  // region='bay' from the column default and null for the rest.
  region: string                     // metro id from shared/metros.ts
  city: string | null                // suburb/city name for suburb pages + display
  attributes: Record<string, unknown> | null  // JSON: fenced, shaded, restrooms, splashpad…
  slug: string | null                // stable /place/{slug} URL, assigned at merge time
  // On-site playground flag for `category='park'` rows (#220). Real fix for
  // "parks have playgrounds but aren't separately findable via the
  // playground filter" — most neighborhood parks with a playground are never
  // OSM-tagged `leisure=playground` themselves. Set by the OSM ingester from
  // a park feature's `playground=yes` tag, overridable with a hand-written
  // UPDATE. Always null for non-park categories.
  has_playground: 0 | 1 | null
  // Simplified-Chinese title (#692). Null on most of the
  // catalog, and null is a first-class state: `displayTitle` falls back to
  // the English `name` rather than showing a half-translated card.
  //
  // Titles only — `description` and `address` are deliberately NOT
  // translated, so there is no `description_zh` sibling to keep in step.
  name_zh: string | null
}

// Redacted shape returned by the public `/api/items.json` list endpoint.
// Keeps everything the frontend needs for pin rendering + client-side
// filtering (category, indoor, cost, age). Moves the curated
// fields (description, address, source_url, price_usd, opening_hours,
// photo_url, website, source_type, confidence, last_verified, created_at,
// updated_at) to the per-item detail endpoint at `/api/items/:id`.
//
// See docs/data-protection-plan.md → Phase 1.
export type ListItem = Pick<
  Item,
  | 'id'
  | 'type'
  | 'name'
  | 'category'
  | 'lat'
  | 'lng'
  | 'age_min'
  | 'age_max'
  | 'cost'
  | 'indoor'
  | 'status'
  // City/suburb label. Not a curated field being leaked back into the list
  // payload — it's the one piece of "where is this?" a distance number can't
  // answer ("3.2 mi" from an unknown origin is not a location), so the list
  // and calendar cards carry it. `null` when neither the row's `city` column
  // nor its address yields one; the cards just omit the segment then.
  | 'city'
  | 'has_playground'
  // Chinese title (#692). Not a curated field leaking back into the list
  // payload — it's the same public `name` in another language, and every
  // card, calendar row, picks entry and search suggestion is rendered from
  // THIS payload, so a translation absent here can't reach the screen at all.
  | 'name_zh'
>

export const LIST_ITEM_FIELDS = [
  'id',
  'type',
  'name',
  'category',
  'lat',
  'lng',
  'age_min',
  'age_max',
  'cost',
  'indoor',
  'status',
  'city',
  'has_playground',
  'name_zh',
] as const satisfies readonly (keyof ListItem)[]

// Compile-time assertion that LIST_ITEM_FIELDS contains EVERY key of
// ListItem. If a future engineer adds a field to ListItem's Pick union but
// forgets to append it to LIST_ITEM_FIELDS (silent runtime `undefined` in
// the worker's redaction projection), the assignment below fails to
// type-check: `AssertEqual<X, Y>` is `true` only when X and Y are mutually
// assignable. No runtime cost; line exists purely to make tsc reject the
// drift.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _listItemFieldsExhaustive: AssertEqual<(typeof LIST_ITEM_FIELDS)[number], keyof ListItem> = true
void _listItemFieldsExhaustive

export interface Filters {
  categories: Set<Category>          // empty set = show all
  indoorOnly: boolean
  outdoorOnly: boolean
  ageMin: number                     // 0
  ageMax: number                     // 18
  freeOnly: boolean
  nearbyCenter: [number, number] | null   // [lng, lat] — when set, only items within nearbyRadiusMiles show
  nearbyRadiusMiles: number                 // default 10 (≈ 15-min drive)
}

export const DEFAULT_FILTERS: Filters = {
  categories: new Set(),
  indoorOnly: false,
  outdoorOnly: false,
  ageMin: 0,
  ageMax: 18,
  freeOnly: false,
  nearbyCenter: null,
  nearbyRadiusMiles: 10,
}
