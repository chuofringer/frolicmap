/**
 * Top search/filter bar and the view toggle: SearchFilterBar, ViewToggle.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const bar = {
  searchPlaceholder: 'Search playgrounds, museums, addresses…',
  searchResults: 'Search results',
  // Scope-grouped dropdown headers (issue #212) — Activities (category/type/
  // synonym keyword matches), Places (name matches), Addresses (geocode).
  // Non-interactive labels inside the listbox; not `role="option"` so they
  // never enter the combobox's flat option list / activedescendant sequence.
  searchGroupActivities: 'Activities',
  searchGroupPlaces: 'Places',
  searchGroupAddresses: 'Addresses',
  search: 'Search',
  closeSearch: 'Close search',
  nearMe: 'Near me',
  locating: 'Locating…',
  geolocationNotSupported: 'Geolocation not supported',
  permissionDenied: 'Permission denied',
  couldNotGetLocation: 'Could not get your location',
  filters: 'Filters',
  allFilters: 'All filters',
  freeOnlyActive: 'Free only ✓',
  map: 'Map',
  list: 'List',
} as const
