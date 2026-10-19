/**
 * City picker: MetroPicker, including per-metro display names.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 *
 * `names` mirrors `shared/metros.ts::Metro.label` for every currently
 * PUBLISHED metro (the only ones `MetroPicker` ever renders) — it exists so
 * the type system forces a matching Chinese name in `zh/metro.ts` for each
 * entry. `MetroPicker` looks values up via `t('metro.names.<id>', {
 * defaultValue: m.label })`, so an id missing from this map (any metro
 * published after this file was last updated) falls back to the plain
 * English label rather than a compile error or a blank string — do not edit
 * `shared/metros.ts` to keep this in sync; extend both `en/metro.ts` and
 * `zh/metro.ts` together next time a metro is promoted.
 */
export const metro = {
  currentCityAriaLabel: 'Current city: {{label}}. Choose a different city.',
  chooseYourCity: 'Choose your city',
  closePickerAriaLabel: 'Close city picker',
  locating: 'Locating…',
  useMyLocation: 'Use my location',
  geoNotAvailable: 'Location isn’t available in this browser.',
  geoNoMatch: 'We couldn’t match your location to a city we cover yet. Pick a city below, or browse them all.',
  geoPermissionDenied: 'Location permission was denied. Pick a city below instead.',
  geoGenericError: 'We couldn’t get your location. Pick a city below instead.',
  current: 'Current',
  browseAllCities: 'Browse all cities →',
  names: {
    bay: 'San Francisco Bay Area',
    'new-york': 'New York City',
    'los-angeles': 'Los Angeles',
    chicago: 'Chicago',
    dallas: 'Dallas–Fort Worth',
    houston: 'Houston',
    washington: 'Washington, D.C.',
    atlanta: 'Atlanta',
    philadelphia: 'Philadelphia',
    boston: 'Boston',
    miami: 'Miami',
    phoenix: 'Phoenix',
    seattle: 'Seattle',
    orlando: 'Orlando',
    austin: 'Austin',
  },
} as const
