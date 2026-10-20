/**
 * Filter surfaces: FiltersDrawer, FreeToggle, CategoryChips, and FiltersButton
 * (the latter lives in src/components/Bar/SearchFilterBar.tsx).
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const filters = {
  freeOnly: 'Free only',
  indoorAndOutdoor: 'Indoor & outdoor',
  indoorOnly: 'Indoor only',
  outdoorOnly: 'Outdoor only',
  minimumAge: 'Minimum age',
  maximumAge: 'Maximum age',
  ageTo: 'to',
  drawerTitle: 'Filters',
  reset: 'Reset',
  closeFilters: 'Close filters',
  sectionCategory: 'Category',
  sectionCost: 'Cost & setting',
  sectionAges: 'Ages',
  showMoreFilters: 'Show more filters',
  settingsTitle: 'Filters & settings',
  settingsAriaLabel: 'Filters and settings',
  eventsChip: 'Events',
  comingSoon: 'Coming soon',
  eventsComingSoonTitle: 'Events are coming soon — for now frolicmap maps places only.',
} as const
