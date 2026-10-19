/**
 * The legend vocabulary — the one list of words this product uses for what a
 * pin is. Hardcoded and verbatim, identical for every city, never derived from
 * the data and never abbreviated into an "& More".
 *
 * Translations of these labels inherit that rule exactly: one hardcoded list
 * per locale, same entries, same order (`CATEGORY_ORDER`).
 *
 * `zoo` never renders as a legend row of its own — it folds into the
 * aquarium chip, whose label is the combined "Aquarium/Zoo" (#323). Its own
 * label here serves the admin surfaces (PendingQueue groups by real DB
 * category).
 *
 * Category **slugs** are NOT translated — they are `?cat=` deep-link keys and
 * search terms, and they stay English in every locale.
 *
 * Keys are exhaustive over `Category` — see the `AssertEqual` guard in
 * `src/config/categories.ts`, which this file is checked against.
 */
export const categories = {
  playground: 'Playground',
  museum: 'Museum',
  library: 'Library',
  park: 'Park',
  aquarium: 'Aquarium/Zoo',
  zoo: 'Zoo',
  beach: 'Beach',
  waterplay: 'Water Play',
  hiking: 'Hiking',
  campground: 'Campground',
  event: 'Event',
  upick: 'U-Pick Farm',
  birthday_party: 'Birthday Party',
  restaurant: 'Restaurant',
} as const
