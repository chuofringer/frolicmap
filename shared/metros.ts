
/**
 * Metro registry — the single source of truth for geographic scope.
 *
 * Consumed by: the worker (region filter, region-scoped cache purge), the
 * frontend (per-metro viewport + initial view), the import scripts (metro
 * assignment + per-metro Overpass bbox), and — once #356 lands — the static
 * page generator (which pages to emit).
 *
 * Adding a metro is meant to be ONE entry here plus a data pass. Nothing
 * downstream should hardcode a bbox or a slug again; the two pre-national
 * Bay Area copies (`worker/src/utils/bbox.ts`, `src/config/constants.ts`)
 * now re-export from this file rather than carrying their own numbers.
 */

export interface Bbox {
  south: number
  west: number
  north: number
  east: number
}

/** MapLibre `maxBounds` shape: [[west, south], [east, north]]. */
export type ViewportBounds = [[number, number], [number, number]]

export interface InitialView {
  longitude: number
  latitude: number
  zoom: number
}

export interface Metro {
  /**
   * Registry key AND the value written to `items.region`. Stable forever —
   * renaming one orphans rows. `bay` is the one id that differs from its
   * URL slug (see `slug`).
   */
  id: string
  /**
   * URL slug for the metro's page (`/cities/{slug}` — the prerendered map
   * page, #387). Identical to `id` for every metro except `bay` → `bay-area`:
   * the legacy `region='bay'` default is baked into migration 0016, while
   * `bay-area` is the term people search. Validated against RESERVED_SLUGS by
   * the metros test.
   */
  slug: string
  /** Display name, e.g. "Dallas–Fort Worth". */
  label: string
  /**
   * Optional shorter display name for width-constrained chrome (the metro
   * picker trigger, which is exactly the brand box's width). Set ONLY where the
   * full `label` is too long to sit in that box — most metros omit it and fall
   * back to `label`.
   */
  shortLabel?: string
  /** USPS state code of the primary city (metros spanning states use it for display only). */
  state: string
  /**
   * Ingestion bounds. Rows outside every metro's contentBbox are deferred,
   * not ingested (plan §1.1). Hand-set to cover the built-up metro area —
   * approximate by construction and tunable per metro; the #357 QA harness
   * validates coordinate sanity against these bounds before a metro
   * publishes, which is where a too-tight or too-loose box surfaces.
   */
  contentBbox: Bbox
  /** Map `maxBounds` — the pannable area. Padded beyond contentBbox so edge content isn't against the wall. */
  viewportBounds: ViewportBounds
  /** Where the map opens for this metro. */
  initialView: InitialView
  /**
   * Whether the metro's `/cities/{slug}` page (and its card on `/cities`) is
   * live. Flipped by the #357 `promote-metro` command after the QA harness
   * passes — never by hand in a data PR.
   */
  published: boolean
  /**
   * Part of the September 12-metro launch wave (plan §4). Purely
   * informational — `published` is what gates behavior.
   */
  wave: boolean
  /**
   * IANA timezone of the metro (e.g. 'America/New_York'). Event times are
   * VENUE-local everywhere in the product: the frontend formats and
   * time-window-filters each item in its metro's zone (not the viewer's
   * browser zone), the merge scripts normalize LLM-emitted timestamps to
   * this zone's offset, and the verify script audits stored offsets against
   * it. Five zones cover all 50 metros; sub-zones with identical modern
   * rules (America/Detroit, America/Indiana/Indianapolis, …) deliberately
   * use their parent so the registry stays scannable.
   */
  timezone: string
  /**
   * One hand-written paragraph about what families find in this metro, used
   * as the lede and meta description on the `/cities/{slug}` map page.
   *
   * Hand-written on purpose: per-city blurbs are what keep 180 structurally
   * identical pages out of thin-content territory; a generated "Find N places in
   * {city}" reads as boilerplate to a person and to a crawler alike.
   *
   * Deliberately free of counts, venue names, hours and superlatives: those
   * go stale, and a wrong specific in a meta description is worse than no
   * specific. Counts come from the data at render time.
   *
   * Required, not optional. Every metro has one — a metro without would
   * silently ship generated filler, and the type is the only thing that
   * reliably prevents that.
   */
  blurb: string
}

/**
 * Top-level paths a metro slug must never collide with — a metro named
 * `terms` would shadow the legal page at the edge, where a static file always
 * beats the SPA catch-all (plan §3.2). Enforced by a unit test so a bad slug
 * fails CI rather than production. Filenames in `public/` are checked by the
 * same test, read from disk so the list can't drift.
 */
export const RESERVED_SLUGS = [
  'api',
  // `/cities` is the metro namespace root (2026-07-19). A metro slugged
  // `cities` would shadow its own index page.
  'cities',
  'map',
  'place',
  'sitemaps',
  'terms',
  'privacy',
  'assets',
] as const

/**
 * Pad a content bbox into pannable viewport bounds. Half a degree is roughly
 * 55 km north-south — enough that pins near the ingestion edge aren't pressed
 * against the map wall, without letting the user pan into an empty neighbor
 * metro. Bay Area overrides this with its pre-national hand-tuned values.
 */
function paddedViewport(b: Bbox, pad = 0.5): ViewportBounds {
  return [
    [b.west - pad, b.south - pad],
    [b.east + pad, b.north + pad],
  ]
}

/** Center of a content bbox — the default map open position. */
function centerView(b: Bbox, zoom = 10): InitialView {
  return {
    longitude: Number(((b.west + b.east) / 2).toFixed(4)),
    latitude: Number(((b.south + b.north) / 2).toFixed(4)),
    zoom,
  }
}

/**
 * Hand-written metro blurbs, keyed by metro id.
 *
 * Kept as a map rather than inline in each `metro()` call so the registry
 * lines stay scannable one-liners and the prose stays readable and editable
 * in one place. See `Metro['blurb']` for the editorial rules.
 *
 * The Bay Area's lives on its own literal entry below, since that metro
 * doesn't go through the `metro()` helper.
 */
const METRO_BLURBS: Record<string, string> = {
  'new-york':
    "New York packs an extraordinary density of family options into walkable distance: "
      + "playgrounds tucked into nearly every neighbourhood, museums with dedicated children's "
      + "wings, and a library system running storytimes across all five boroughs — plus ocean "
      + "beaches and big waterfront parks a subway ride away.",
  'los-angeles':
    "Los Angeles gives families beaches, canyon trails and open-air museums in the same "
      + "week, on weather that makes outdoor plans reliable most of the year. Neighbourhood "
      + "parks and library branches stretch from the coast through the valleys, and the "
      + "mountains behind the city put real hiking within a short drive.",
  chicago:
    "Chicago's lakefront gives families miles of beaches, parks and paths, and the city's "
      + "museum campus is one of the best concentrations of kid-focused exhibits anywhere. Away "
      + "from the water, neighbourhood parks and a deep library system spread options across the "
      + "city and well into the suburbs.",
  dallas:
    "Dallas–Fort Worth spreads family activities across two downtowns and the suburbs "
      + "between them: large municipal park systems, a broad network of library branches, and "
      + "museums and zoos that anchor weekend plans. Spring and autumn are the easiest months to "
      + "be outside.",
  houston:
    "Houston's family scene runs on big green space and big indoor space in equal measure — "
      + "sprawling parks and bayou trails for the mild months, and a well-known museum district "
      + "plus a wide library system for the summer heat.",
  washington:
    "Washington gives families an unusual advantage: many of the region's best museums and "
      + "green spaces are free to walk into. Add neighbourhood playgrounds, riverside trails and "
      + "a library system spanning the District and its Maryland and Virginia suburbs.",
  atlanta:
    "Atlanta pairs a growing network of parks and trails with major indoor attractions, so "
      + "there's an option whether it's a mild spring day or a humid August afternoon. Library "
      + "branches and playgrounds spread through the city and out across the northern suburbs.",
  philadelphia:
    "Philadelphia has some of the largest urban green space in the country, and the city's "
      + "museums and science centres are long-standing family fixtures. Playgrounds are woven "
      + "through the row-house neighbourhoods, with a library system reaching into the "
      + "surrounding counties.",
  boston:
    "Boston is compact enough that families can string together a park, a museum and a "
      + "library branch in a single afternoon. The harbour and river give the city beaches and "
      + "waterfront paths, and the surrounding towns add their own parks within a short drive.",
  miami:
    "Miami's outdoor season runs all winter, when beaches, waterfront parks and open-air "
      + "attractions are at their best. Museums and library branches carry the load through the "
      + "hottest and wettest months, and the parks system reaches from the coast well inland.",
  phoenix:
    "Phoenix families plan around the sun: desert parks and mountain preserves are at their "
      + "best from autumn through spring, while museums, libraries and indoor play carry the "
      + "summer. Park systems and library branches spread options across a wide, low-slung "
      + "valley.",
  seattle:
    "Seattle wraps families in green — waterfront parks, forested trails and beaches on both "
      + "the sound and the lakes, often inside the city limits. A strong library system and a "
      + "cluster of kid-focused museums make the long grey stretch of the year considerably "
      + "easier.",
  riverside:
    "The Inland Empire trades coastal fog for sunshine and space, with big regional parks, "
      + "mountain trails within reach and room for the kind of sprawling playgrounds that "
      + "coastal cities can't fit. Libraries and museums anchor the hotter months across "
      + "Riverside and San Bernardino counties.",
  detroit:
    "Metro Detroit's family map runs from riverfront parks downtown out to the lakes and "
      + "metroparks ringing the suburbs. A strong county park system and a wide network of "
      + "library branches carry families through both the warm months and the long Michigan "
      + "winter.",
  minneapolis:
    "The Twin Cities are built around water — a chain of lakes, the Mississippi and hundreds "
      + "of neighbourhood parks that make outdoor time the default from spring through autumn. "
      + "Well-funded libraries and children's museums make the deep winter genuinely workable.",
  'san-diego':
    "San Diego's weather removes the seasons from family planning: beaches, canyons and "
      + "open-air attractions work nearly year-round. Neighbourhood parks and library branches "
      + "spread from the coast inland, with big regional parks and a famous zoo anchoring "
      + "weekends.",
  tampa:
    "Tampa Bay gives families warm water on both sides of the bay, with beaches, waterfront "
      + "parks and open-air attractions at their best through the mild winter. Museums and "
      + "libraries carry the humid summer stretch across Hillsborough and Pinellas.",
  denver:
    "Denver families get the plains and the mountains in the same weekend — city parks and "
      + "playgrounds close in, foothills trails a short drive west. Sunny winters keep parks "
      + "usable more of the year than the snow totals suggest, and museums anchor the cold "
      + "snaps.",
  baltimore:
    "Baltimore packs harbour attractions, neighbourhood parks and a deep library system into "
      + "a compact, walkable city. The Chesapeake shoreline and the surrounding county parks "
      + "widen the map, and the science and children's museums are long-standing family anchors.",
  'st-louis':
    "St. Louis is unusually generous with free family attractions — several of the region's "
      + "biggest draws cost nothing to enter. A large city park, riverfront green space and a "
      + "wide county library system round out the map on both sides of the Mississippi.",
  orlando:
    "Beyond the theme parks, Orlando has a genuine everyday family map: lakeside parks, "
      + "springs and nature trails, plus a strong library system and science museums. The mild "
      + "winter is peak outdoor season; summer afternoons belong indoors.",
  charlotte:
    "Charlotte's greenway network keeps growing, connecting neighbourhood parks and "
      + "playgrounds across a fast-expanding metro. Museums and a well-used library system cover "
      + "the humid summer, and the mild shoulder seasons stretch outdoor time long.",
  'san-antonio':
    "San Antonio combines riverside walkways, big municipal parks and a compact museum "
      + "district with some of the longest warm seasons in the country. Library branches and "
      + "indoor attractions carry families through the peak summer heat.",
  portland:
    "Portland is a park city — forested trails inside the city limits, neighbourhood "
      + "playgrounds everywhere, and rivers running through the middle of it. A strong library "
      + "system and children's museums make the long rainy season much easier to plan around.",
  sacramento:
    "Sacramento sits where two rivers meet, giving families riverside parks and bike trails "
      + "alongside a walkable old town. Hot, dry summers push afternoons indoors to libraries "
      + "and museums, while spring and autumn are excellent outdoors.",
  pittsburgh:
    "Pittsburgh's hills and three rivers give the city dramatic parks and riverfront trails, "
      + "and its museum system includes several built specifically for kids. A wide library "
      + "network and a deep bench of neighbourhood playgrounds carry the winter.",
  austin:
    "Austin's greenbelt, swimming holes and lakeside parks make outdoor family time the "
      + "default for most of the year. A well-used library system and a growing museum scene "
      + "handle the peak summer heat, when mornings and evenings are the outdoor windows.",
  'las-vegas':
    "Away from the Strip, Las Vegas is a valley of neighbourhood parks, water play areas and "
      + "red-rock trails just outside town. The cool months are prime outdoor season; libraries, "
      + "museums and indoor play carry families through the desert summer.",
  cincinnati:
    "Cincinnati's river setting gives families hillside parks and riverfront green space, "
      + "and the region punches above its size on kid-focused museums and its zoo. A broad "
      + "library system covers both the winter and the humid summer stretch.",
  'kansas-city':
    "Kansas City spreads generous parkland and boulevards across two states, with a strong "
      + "museum scene and a well-funded library system. Spring and autumn are excellent "
      + "outdoors; the humid summer and cold winter both push families indoors.",
  columbus:
    "Columbus pairs a large metro park system with riverfront green space downtown and a "
      + "science centre and zoo that anchor weekends. Library branches spread widely across a "
      + "growing, family-heavy metro.",
  indianapolis:
    "Indianapolis has one of the country's biggest children's museums and a canal-and-trail "
      + "network that makes the city centre genuinely walkable with kids. County parks and a "
      + "wide library system fill in the rest of the map.",
  cleveland:
    "Cleveland's lakefront beaches and an extensive metroparks system ring the city with "
      + "green space, while the museum district and a strong library network carry the long "
      + "winter. Spring through autumn is the outdoor stretch.",
  nashville:
    "Nashville's greenways and river parks have expanded fast alongside the city, and "
      + "neighbourhood playgrounds reach well into the surrounding counties. Museums and "
      + "libraries cover the humid summer and the short winter.",
  'virginia-beach':
    "The Hampton Roads region gives families miles of Atlantic and bay shoreline, with "
      + "boardwalk parks, aquariums and waterfront trails. Mild shoulder seasons stretch beach "
      + "time, and museums and libraries fill the hottest and coldest weeks.",
  providence:
    "Providence is small enough to cross with kids in an afternoon, with riverfront parks, a "
      + "well-known children's museum and Narragansett Bay beaches close by. A dense library "
      + "network covers the New England winter.",
  jacksonville:
    "Jacksonville has more city parkland than almost any US city, plus Atlantic beaches and "
      + "river marshes on the same map. The mild winter is peak outdoor season; libraries and "
      + "museums cover the hot, wet summer.",
  milwaukee:
    "Milwaukee's lakefront gives families beaches and long shoreline parks, backed by a "
      + "county park system that reaches every neighbourhood. Museums and a strong library "
      + "network make the Wisconsin winter workable.",
  'oklahoma-city':
    "Oklahoma City has rebuilt its centre around a river and a large downtown park, adding "
      + "to a wide network of neighbourhood playgrounds. Museums and libraries carry the hot "
      + "summer and the occasional hard winter week.",
  raleigh:
    "The Triangle pairs greenway trails linking Raleigh, Durham and Chapel Hill with a "
      + "museum scene that leans heavily on science and nature — much of it free. A strong "
      + "library system covers the humid summer stretch.",
  memphis:
    "Memphis centres on the Mississippi, with riverfront parks, a large city park and a zoo "
      + "that anchors family weekends. Libraries and museums carry the long hot summer; spring "
      + "and autumn are the outdoor seasons.",
  richmond:
    "Richmond's river runs right through the city, giving families rapids-side parks and "
      + "trails unusual for a metro this size. Museums — several free — and a wide library "
      + "system round out the map across the surrounding counties.",
  louisville:
    "Louisville's park system was designed as a connected network and still works that way, "
      + "linking neighbourhood playgrounds to large woodland parks. A strong library system and "
      + "a science centre cover the humid summer and cold snaps.",
  'new-orleans':
    "New Orleans gives families a large city park, riverfront green space and museums built "
      + "around the Mississippi and the wetlands beyond it. The mild winter is prime outdoor "
      + "season; the humid summer belongs to libraries and indoor attractions.",
  'salt-lake-city':
    "Salt Lake City puts canyon trails minutes from downtown, with neighbourhood parks and "
      + "water play areas filling the valley floor. Museums and a strong library system cover the "
      + "winter, though the mountains are the point for many families.",
  buffalo:
    "Buffalo's park system was laid out as a connected chain and still anchors family life, "
      + "alongside Lake Erie beaches and the Niagara River. A deep library network and indoor "
      + "attractions carry the famously long winter.",
  birmingham:
    "Birmingham sits at the end of the Appalachians, giving families wooded ridge trails and "
      + "a large nature preserve alongside city parks. Museums and a wide library system cover "
      + "the humid summer stretch.",
  tucson:
    "Tucson is desert-first: saguaro parks, mountain trails and open-air museums that are at "
      + "their best from autumn through spring. Libraries and indoor attractions carry the "
      + "intense summer, when early mornings are the outdoor window.",
  albuquerque:
    "Albuquerque sits between the Rio Grande and the Sandia mountains, giving families "
      + "riverside trails and high-desert hikes on the same map. High elevation keeps summers "
      + "more workable than the latitude suggests, and museums and libraries cover the extremes.",
}

/**
 * IANA timezone per metro id. Kept as a map (like METRO_BLURBS) so the
 * registry lines below stay one-liners. `requireTimezone` makes a missing
 * entry fail at module load rather than shipping viewer-zone fallback
 * rendering for a whole metro.
 */
const METRO_TIMEZONES: Record<string, string> = {
  // Pacific
  'bay': 'America/Los_Angeles',
  'los-angeles': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'riverside': 'America/Los_Angeles',
  'san-diego': 'America/Los_Angeles',
  'sacramento': 'America/Los_Angeles',
  'portland': 'America/Los_Angeles',
  'las-vegas': 'America/Los_Angeles',
  // Arizona (no DST)
  'phoenix': 'America/Phoenix',
  'tucson': 'America/Phoenix',
  // Mountain
  'denver': 'America/Denver',
  'salt-lake-city': 'America/Denver',
  'albuquerque': 'America/Denver',
  // Central
  'chicago': 'America/Chicago',
  'dallas': 'America/Chicago',
  'houston': 'America/Chicago',
  'minneapolis': 'America/Chicago',
  'san-antonio': 'America/Chicago',
  'austin': 'America/Chicago',
  'kansas-city': 'America/Chicago',
  'oklahoma-city': 'America/Chicago',
  'milwaukee': 'America/Chicago',
  'memphis': 'America/Chicago',
  'nashville': 'America/Chicago',
  'new-orleans': 'America/Chicago',
  'st-louis': 'America/Chicago',
  'birmingham': 'America/Chicago',
  // Eastern
  'new-york': 'America/New_York',
  'washington': 'America/New_York',
  'atlanta': 'America/New_York',
  'philadelphia': 'America/New_York',
  'boston': 'America/New_York',
  'miami': 'America/New_York',
  'detroit': 'America/New_York',
  'baltimore': 'America/New_York',
  'tampa': 'America/New_York',
  'orlando': 'America/New_York',
  'charlotte': 'America/New_York',
  'pittsburgh': 'America/New_York',
  'cincinnati': 'America/New_York',
  'columbus': 'America/New_York',
  'cleveland': 'America/New_York',
  'indianapolis': 'America/New_York',
  'virginia-beach': 'America/New_York',
  'providence': 'America/New_York',
  'jacksonville': 'America/New_York',
  'raleigh': 'America/New_York',
  'richmond': 'America/New_York',
  'louisville': 'America/New_York',
  'buffalo': 'America/New_York',
}

function requireTimezone(id: string): string {
  const tz = METRO_TIMEZONES[id]
  if (!tz) throw new Error(`shared/metros.ts: no timezone for metro '${id}' — every metro needs one`)
  return tz
}

/** Shorthand for the 49 metros that take derived viewport + center view. */
function metro(
  id: string,
  label: string,
  state: string,
  contentBbox: Bbox,
  opts: { wave?: boolean; zoom?: number; published?: boolean } = {},
): Metro {
  return {
    id,
    slug: id,
    label,
    state,
    contentBbox,
    viewportBounds: paddedViewport(contentBbox),
    initialView: centerView(contentBbox, opts.zoom ?? 10),
    // Defaults to unpublished. `promote-metro` (#357) flips this by adding
    // `published: true` to a metro's opts once the QA harness passes — which
    // is why it's an option here rather than a hardcoded false.
    published: opts.published ?? false,
    wave: opts.wave ?? false,
    timezone: requireTimezone(id),
    blurb: requireBlurb(id),
  }
}

/**
 * Blurbs are required, so a missing one fails the build rather than shipping
 * a page that quietly falls back to boilerplate.
 */
function requireBlurb(id: string): string {
  const b = METRO_BLURBS[id]
  if (!b) throw new Error(`shared/metros.ts: no blurb for metro '${id}' — every metro needs one`)
  return b
}

/**
 * The Bay Area entry is hand-written rather than passed through `metro()`
 * because its three geometry values must stay byte-identical to the
 * pre-national constants they replace (`src/config/constants.ts`,
 * `worker/src/utils/bbox.ts`). #351 ships "zero visible change" — a derived
 * viewport here would silently move the production map.
 *
 * `contentBbox` history: `north` 38.00 → 38.60 (2026-04-20) for Sonoma
 * County; `west` -122.55 → -122.85 (2026-04-21) to reach Santa Rosa,
 * Petaluma and Windsor.
 */
const BAY_AREA: Metro = {
  id: 'bay',
  slug: 'bay-area',
  label: 'San Francisco Bay Area',
  shortLabel: 'SF Bay Area',
  state: 'CA',
  contentBbox: { south: 36.89, west: -122.85, north: 38.6, east: -121.57 },
  viewportBounds: [
    [-123.5, 36.5],
    [-121.0, 38.6],
  ],
  initialView: { longitude: -122.33, latitude: 37.55, zoom: 10 },
  published: true,
  wave: false,
  timezone: 'America/Los_Angeles',
  blurb:
    'From foggy coastal beaches to redwood trails and the bay shoreline, the Bay Area packs a '
    + 'remarkable range of family outings into a short drive. Big science and art museums sit '
    + 'alongside neighbourhood playgrounds, regional parks and library branches running weekly '
    + 'storytimes — and in summer, water play areas open across the East Bay and '
    + 'Peninsula.',
}

/**
 * 50 metros: the Bay Area showcase + the 12-metro September wave + 37
 * fast-follow metros (plan §5, batches through October). Ordered roughly by
 * population so the wave metros sit at the top where they're edited most.
 *
 * Metro slug = primary-city name, never a CBSA code or a hyphenated pair
 * (`dallas`, not `dfw` or `dallas-fort-worth`) — the primary city carries the
 * search volume, and one metro means one hub. Fort Worth, Plano and Arlington
 * are suburb pages under `/dallas`, not sibling front doors (plan §3.2).
 */
export const METROS: readonly Metro[] = [
  BAY_AREA,

  // ── September wave (12) ────────────────────────────────────────────────
  metro('new-york', 'New York City', 'NY', { south: 40.44, west: -74.35, north: 41.1, east: -73.42 }, {
    wave: true, zoom: 11, published: true,
  }),
  metro('los-angeles', 'Los Angeles', 'CA', { south: 33.6, west: -118.85, north: 34.4, east: -117.6 }, {
    wave: true, published: true,
  }),
  metro('chicago', 'Chicago', 'IL', { south: 41.4, west: -88.4, north: 42.35, east: -87.5 }, {
    wave: true, published: true,
  }),
  metro('dallas', 'Dallas–Fort Worth', 'TX', { south: 32.5, west: -97.6, north: 33.3, east: -96.4 }, {
    wave: true, published: true,
  }),
  metro('houston', 'Houston', 'TX', { south: 29.4, west: -95.9, north: 30.2, east: -94.9 }, {
    wave: true, published: true,
  }),
  metro('washington', 'Washington, D.C.', 'DC', { south: 38.6, west: -77.6, north: 39.2, east: -76.8 }, {
    wave: true, published: true,
  }),
  metro('atlanta', 'Atlanta', 'GA', { south: 33.4, west: -84.75, north: 34.15, east: -84.0 }, {
    wave: true, published: true,
  }),
  metro('philadelphia', 'Philadelphia', 'PA', { south: 39.75, west: -75.55, north: 40.3, east: -74.85 }, {
    wave: true, published: true,
  }),
  metro('boston', 'Boston', 'MA', { south: 42.15, west: -71.4, north: 42.65, east: -70.85 }, {
    wave: true, published: true,
  }),
  metro('miami', 'Miami', 'FL', { south: 25.5, west: -80.5, north: 26.4, east: -80.05 }, {
    wave: true, published: true,
  }),
  metro('phoenix', 'Phoenix', 'AZ', { south: 33.2, west: -112.4, north: 33.8, east: -111.6 }, {
    wave: true, published: true,
  }),
  // Widened 2026-07-21 from the launch box (s 47.25 / w -122.5 / n 47.85 /
  // e -122.05, ~2,245 km²) to the real family-activity metro (~6,700 km²):
  // the old box excluded Everett (47.98) and all of Tacoma/Puyallup (< 47.25),
  // silently bbox-rejecting Imagine Children's Museum and the Tacoma museum
  // cluster. Now
  // spans Everett/Monroe (N), Tacoma/Puyallup (S), Carnation/Fall City (E),
  // Bainbridge/Bremerton (W). Bay comparison: 21,325 km².
  metro('seattle', 'Seattle', 'WA', { south: 47.05, west: -122.65, north: 48.05, east: -121.85 }, {
    wave: true, published: true,
  }),

  // ── Fast-follow metros (37) ────────────────────────────────────────────
  metro('riverside', 'Riverside–San Bernardino', 'CA', { south: 33.7, west: -117.7, north: 34.25, east: -116.9 }),
  metro('detroit', 'Detroit', 'MI', { south: 42.0, west: -83.5, north: 42.75, east: -82.85 }),
  metro('minneapolis', 'Minneapolis–St. Paul', 'MN', { south: 44.7, west: -93.6, north: 45.2, east: -92.85 }),
  metro('san-diego', 'San Diego', 'CA', { south: 32.53, west: -117.3, north: 33.35, east: -116.85 }),
  metro('tampa', 'Tampa Bay', 'FL', { south: 27.6, west: -82.75, north: 28.2, east: -82.2 }),
  metro('denver', 'Denver', 'CO', { south: 39.5, west: -105.25, north: 40.0, east: -104.6 }),
  metro('baltimore', 'Baltimore', 'MD', { south: 39.1, west: -76.85, north: 39.5, east: -76.35 }),
  metro('st-louis', 'St. Louis', 'MO', { south: 38.4, west: -90.6, north: 38.95, east: -90.0 }),
  // Note Orlando's bbox north edge (28.75) excludes Sanford (~28.80, third city of the Orlando–Kissimmee–Sanford
  // MSA) — same widen-later candidate class as Seattle's #459.
  metro('orlando', 'Orlando', 'FL', { south: 28.2, west: -81.7, north: 28.75, east: -81.1 }, {
    // Published 2026-07-25 (#502). Static-places bootstrap ran the same day
    // (OSM + IMLS + dedup + waterplay naming — 1,088 approved
    // rows) and qa-metro PASSED, so the full category set is live.
    published: true,
  }),
  metro('charlotte', 'Charlotte', 'NC', { south: 35.0, west: -81.1, north: 35.5, east: -80.6 }),
  metro('san-antonio', 'San Antonio', 'TX', { south: 29.2, west: -98.8, north: 29.7, east: -98.2 }),
  metro('portland', 'Portland', 'OR', { south: 45.3, west: -123.0, north: 45.75, east: -122.35 }),
  metro('sacramento', 'Sacramento', 'CA', { south: 38.3, west: -121.7, north: 38.8, east: -121.0 }),
  metro('pittsburgh', 'Pittsburgh', 'PA', { south: 40.25, west: -80.3, north: 40.7, east: -79.75 }),
  metro('austin', 'Austin', 'TX', { south: 30.05, west: -98.05, north: 30.6, east: -97.5 }, {
    // Published 2026-07-25 (#498). Same-day static-places bootstrap (1,563
    // approved rows incl. the missing waterplay leg) passed qa-metro — full
    // category set live, same rationale as Orlando above.
    published: true,
  }),
  metro('las-vegas', 'Las Vegas', 'NV', { south: 35.95, west: -115.4, north: 36.35, east: -114.9 }),
  metro('cincinnati', 'Cincinnati', 'OH', { south: 38.95, west: -84.75, north: 39.35, east: -84.2 }),
  metro('kansas-city', 'Kansas City', 'MO', { south: 38.85, west: -94.85, north: 39.35, east: -94.35 }),
  metro('columbus', 'Columbus', 'OH', { south: 39.8, west: -83.25, north: 40.2, east: -82.7 }),
  metro('indianapolis', 'Indianapolis', 'IN', { south: 39.6, west: -86.4, north: 40.0, east: -85.9 }),
  metro('cleveland', 'Cleveland', 'OH', { south: 41.3, west: -82.0, north: 41.65, east: -81.4 }),
  metro('nashville', 'Nashville', 'TN', { south: 35.95, west: -87.05, north: 36.4, east: -86.5 }),
  metro('virginia-beach', 'Virginia Beach–Norfolk', 'VA', { south: 36.65, west: -76.5, north: 37.05, east: -75.95 }),
  metro('providence', 'Providence', 'RI', { south: 41.65, west: -71.6, north: 42.0, east: -71.2 }),
  metro('jacksonville', 'Jacksonville', 'FL', { south: 30.1, west: -82.0, north: 30.55, east: -81.35 }),
  metro('milwaukee', 'Milwaukee', 'WI', { south: 42.85, west: -88.15, north: 43.25, east: -87.8 }),
  metro('oklahoma-city', 'Oklahoma City', 'OK', { south: 35.3, west: -97.75, north: 35.7, east: -97.25 }),
  metro('raleigh', 'Raleigh–Durham', 'NC', { south: 35.7, west: -79.05, north: 36.1, east: -78.5 }),
  metro('memphis', 'Memphis', 'TN', { south: 34.95, west: -90.2, north: 35.3, east: -89.7 }),
  metro('richmond', 'Richmond', 'VA', { south: 37.35, west: -77.65, north: 37.75, east: -77.25 }),
  metro('louisville', 'Louisville', 'KY', { south: 38.1, west: -85.9, north: 38.4, east: -85.5 }),
  metro('new-orleans', 'New Orleans', 'LA', { south: 29.85, west: -90.2, north: 30.15, east: -89.75 }),
  metro('salt-lake-city', 'Salt Lake City', 'UT', { south: 40.5, west: -112.15, north: 40.9, east: -111.75 }),
  metro('buffalo', 'Buffalo', 'NY', { south: 42.75, west: -79.0, north: 43.1, east: -78.6 }),
  metro('birmingham', 'Birmingham', 'AL', { south: 33.3, west: -87.0, north: 33.7, east: -86.55 }),
  metro('tucson', 'Tucson', 'AZ', { south: 32.05, west: -111.15, north: 32.45, east: -110.7 }),
  metro('albuquerque', 'Albuquerque', 'NM', { south: 34.95, west: -106.8, north: 35.25, east: -106.45 }),
]

/** Metro lookup by `items.region` value. Built once at module load. */
const BY_ID = new Map<string, Metro>(METROS.map((m) => [m.id, m]))
/** Metro lookup by URL slug. */
const BY_SLUG = new Map<string, Metro>(METROS.map((m) => [m.slug, m]))

/** The default region for every pre-national row (migration 0016's column default). */
export const DEFAULT_REGION = 'bay'

export function getMetro(id: string): Metro | undefined {
  return BY_ID.get(id)
}

export function getMetroBySlug(slug: string): Metro | undefined {
  return BY_SLUG.get(slug)
}

/**
 * Region-id guard for untrusted input (the `?region=` query param, importer
 * CLI args). Returns false for unknown ids so callers can 400 rather than
 * silently querying a region that will never match a row.
 */
export function isValidRegion(id: string): boolean {
  return BY_ID.has(id)
}

/**
 * Whether a region is live to the public API.
 *
 * Distinct from `isValidRegion`: a metro can be a real registry entry with
 * data already imported and still not be published — that's the entire state
 * `promote-metro` (#357) transitions out of. The public list endpoint gates on
 * *this*, not on mere validity, for two reasons: an unpublished metro's rows
 * shouldn't be readable before its launch moment, and a cacheable 200 for an
 * unpublished region would be un-purgeable (see `purgeItemsCache`, which only
 * knows about published metros).
 */
export function isPublishedRegion(id: string): boolean {
  return BY_ID.get(id)?.published === true
}

/** Metros whose pages + map route are live. */
export function publishedMetros(): readonly Metro[] {
  return METROS.filter((m) => m.published)
}

/**
 * Region ids the public data plane may serve.
 *
 * Every public read path gates on this, not on `isValidRegion`. A metro's rows
 * land in D1 as `approved` at import time (trusted-source auto-approve, plan
 * §1.6) long before its launch, so "approved" alone is not a visibility
 * decision — `published` is. Before #371 the tile endpoint queried by bbox
 * with no region clause, which made applying a metro's data the same act as
 * publishing it and collapsed the promote-metro gate (plan §4A.5).
 */
export function publishedRegionIds(): string[] {
  return METROS.filter((m) => m.published).map((m) => m.id)
}

/** The 12 September launch metros (plan §4). */
export function waveMetros(): readonly Metro[] {
  return METROS.filter((m) => m.wave)
}

/** Whether a coordinate falls inside a metro's ingestion bounds. */
export function inMetroBbox(metro: Metro, lat: number, lng: number): boolean {
  const { south, west, north, east } = metro.contentBbox
  return lat >= south && lat <= north && lng >= west && lng <= east
}

/**
 * The metro a coordinate belongs to, or undefined when it falls outside every
 * metro (plan §1.1: those rows are deferred, not ingested).
 *
 * Bboxes are hand-set rectangles, so neighbors can overlap — Baltimore and
 * Washington share a corner. First match by registry order wins, which is
 * population order, so the larger metro claims a contested coordinate. Good
 * enough while every metro gets the identical automated baseline; when a
 * contested metro earns depth, tighten the two bboxes rather than adding
 * tie-break logic here.
 */
export function metroForCoords(lat: number, lng: number): Metro | undefined {
  return METROS.find((m) => inMetroBbox(m, lat, lng))
}

/** Great-circle distance in kilometres (haversine). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** How far outside every published bbox a visitor may be and still get the nearest metro. */
export const NEAREST_METRO_MAX_KM = 150

/**
 * The published metro for an approximate visitor location: the one whose
 * `contentBbox` contains the point (first by registry order when bboxes
 * overlap), else the published metro whose centre is nearest within
 * `NEAREST_METRO_MAX_KM`, else null. Unpublished metros are never returned
 * (their data is API-gated, #371).
 */
export function nearestPublishedMetro(lat: number, lng: number): Metro | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const published = publishedMetros()
  const inside = published.find((m) => inMetroBbox(m, lat, lng))
  if (inside) return inside
  let best: Metro | null = null
  let bestKm = NEAREST_METRO_MAX_KM
  for (const m of published) {
    const km = haversineKm(lat, lng, m.initialView.latitude, m.initialView.longitude)
    if (km <= bestKm) {
      best = m
      bestKm = km
    }
  }
  return best
}

/**
 * IANA timezone for a region id, or undefined for unknown regions. The
 * merge scripts use this to normalize LLM-emitted timestamps to the
 * metro's offset.
 */
export function timezoneForRegion(id: string): string | undefined {
  return BY_ID.get(id)?.timezone
}

/**
 * IANA timezone of the metro a coordinate falls in, or undefined outside
 * every metro. This is how the frontend resolves an item's venue zone —
 * the redacted `ListItem` payload carries no `region`, but every row has
 * lat/lng and was ingested inside its metro's contentBbox by construction.
 * Neighboring bboxes can overlap (Baltimore/Washington), but overlapping
 * neighbors share a zone, so first-match ambiguity is harmless here.
 */
export function timezoneForCoords(lat: number, lng: number): string | undefined {
  return metroForCoords(lat, lng)?.timezone
}

/** Overpass `(south,west,north,east)` bbox string for a metro (#352). */
export function overpassBboxFor(metro: Metro): string {
  const { south, west, north, east } = metro.contentBbox
  return `${south},${west},${north},${east}`
}
