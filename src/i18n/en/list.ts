/**
 * List view: ListPanel.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const list = {
  placesNearYou: '{{count}} places near you',
  sortedByDistance: 'Sorted by distance',
  dragToReturnToMap: 'Drag down to return to map',
  noMatches: 'No places match your filters.',
  // "mi" is the only translatable piece here — distances stay in miles
  // everywhere (US venues); the middle dot is a plain separator.
  categoryDistance: '{{category}} · {{distance}} mi',
  // Same line with the city/suburb the item sits in. A distance alone can't
  // say WHERE something is, and "3.2 mi" reads very differently for a town
  // you know than for one you don't — so the city leads the distance whenever
  // the row carries one.
  categoryCityDistance: '{{category}} · {{city}} · {{distance}} mi',
  paid: 'Paid',
  indoor: 'Indoor',
  outdoor: 'Outdoor',
  showingNearest: 'Showing the nearest {{cap}} of {{total}} — zoom in or filter to narrow',
} as const
