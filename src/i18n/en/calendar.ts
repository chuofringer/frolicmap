/**
 * Calendar view (PR #511, from #517): CalendarPanel + MonthGrid — the month
 * grid with per-day counts, the day list behind each cell, the sign-in gate
 * card, and the ViewToggle's third segment label (kept here with the rest of
 * the calendar copy; the Map/List labels stay in `bar`).
 *
 * Owned by one workstream — keep additions inside this file so parallel work
 * never collides. Values are the exact English text that was previously
 * hardcoded in the components listed above.
 */
export const calendar = {
  calendar: 'Calendar',
  eventsCalendar: 'Events calendar',
  activityCount_one: '{{count}} activity',
  activityCount_other: '{{count}} activities',
  today: 'Today',
  tomorrow: 'Tomorrow',
  allDay: 'All day',
  nextTwoMonths: 'Next 2 months',
  ongoing: 'Ongoing',
  showFewer: 'Show fewer',
  moreOngoing: '+{{count}} more ongoing',
  empty: 'No dated activities match your filters in the coming weeks.',
  emptyMonth: 'No activities this month match your filters.',
  emptyDay: 'Nothing on this day matches your filters.',
  cappedEntries: 'Showing the first {{count}} activities — filter to narrow this day',
  tapADay: 'Tap a day to see what’s on',
  backToCalendar: 'Back to calendar',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  dragDownToMap: 'Drag down to return to map',
  gateAriaLabel: 'Sign in to see the events calendar',
  gateTitle: 'Sign in with Google to see the events calendar',
  gateBody: 'Every kids event near you, laid out on a calendar — tap any day to see what’s on. Signing in is free and takes one tap — it keeps the hand-curated list for real parents, not bots and scrapers.',
} as const
