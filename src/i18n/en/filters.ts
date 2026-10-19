/**
 * Filter surfaces: FiltersDrawer, FreeToggle, CategoryChips, FiltersButton.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const filters = {
  // Interpolated by useCategoryChipState's comingSoonLabel — the shared
  // coming-soon aria-label consumed by the bar chip row, CategoryChips, and
  // the legend. Keep {{category}} / {{metro}} in sync with that call site.
  comingSoon: '{{category}} — coming soon in {{metro}}. Get notified.',
  soon: 'soon',
  freeOnly: 'Free only',
  indoorAndOutdoor: 'Indoor & outdoor',
  indoorOnly: 'Indoor only',
  outdoorOnly: 'Outdoor only',
  inSeasonNow: 'In season now',
  openNow: 'Open now',
  today: 'Today',
  thisWeekend: 'This weekend',
  next2Weeks: 'Next 2 weeks',
  minimumAge: 'Minimum age',
  maximumAge: 'Maximum age',
  ageTo: 'to',
  drawerTitle: 'Filters',
  reset: 'Reset',
  closeFilters: 'Close filters',
  sectionCategory: 'Category',
  sectionUpick: 'U-Pick',
  sectionWhen: 'When',
  sectionCost: 'Cost & setting',
  sectionAges: 'Ages',
  showMoreFilters: 'Show more filters',
  settingsTitle: 'Filters & settings',
  settingsAriaLabel: 'Filters and settings',
} as const
