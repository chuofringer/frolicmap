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
  // #647: the one summary card standing in for every locked event row.
  lockedEventsSummary: '{{count}} events nearby — sign in to see this weekend',
  // #655: signed-in event recommendations on the map and in list view.
  picks: {
    title: 'Top picks',
    subtitle: 'Timed, one-off events for weekends and holidays · ignores your filters',
    open: 'Top picks',
    panelTitle: 'Top picks',
    panelSubtitle: 'Events worth planning around · ignores your filters',
    close: 'Close top picks',
    free: 'Free',
    empty: 'No standout one-off events this weekend yet — check back soon.',
    windowThisWeekend: 'This weekend',
    windowNextWeekend: 'Next weekend',
    windowNextTwo: 'Next 2 weekends',
    windowCustom: 'Custom',
    windowFrom: 'From',
    windowThrough: 'Through',
    windowApply: 'Apply',
    windowInvalidOrder: 'Choose an end date on or after the start.',
    windowInvalidLength: 'Custom ranges can be at most 14 days.',
    windowAlreadyOver: 'That range has already ended.',
    windowMalformed: 'Enter a valid start and end date.',
    emptyThisWeekend: 'No standout one-off events this weekend yet — check back soon.',
    emptyNextWeekend: 'No standout one-off events next weekend yet — check back soon.',
    emptyNextTwo: 'No standout one-off events across the next two weekends yet.',
    emptyContiguous: 'No standout one-off events in that span yet.',
  },
} as const
