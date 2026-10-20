/**
 * Map chrome: MapControls, BasemapButton, IconBar, Brand, NetworkErrorBanner, NearbyBox.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const map = {
  // Brand
  brandName: 'frolicmap',
  brandSuffix: '.app',
  // Developer credit under the brand. The developer name itself is a proper
  // noun and stays Latin script in every locale (see zh/map.ts).
  developedBy: 'Developed by',
  developerName: 'vibemapper',

  // MapControls
  resetBearingAriaLabel: 'Reset bearing',
  resetNorthTitle: 'Reset north',
  zoomInLabel: 'Zoom in',
  zoomOutLabel: 'Zoom out',
  toggle3DAriaLabel: 'Toggle 3D view',
  toggle3DTitleSupported: '3D view (buildings)',
  toggle3DTitleUnsupported: 'Tilt view',
  threeDLabel: '3D',

  // BasemapButton (desktop)
  changeBasemapLabel: 'Change basemap',
  basemapHeading: 'Basemap',

  // IconBar (mobile ⋯ expander — reuses toggle3D* / threeDLabel above)
  mapStyleLabel: 'Map style',
  moreOptionsAriaLabel: 'More options',

  // NetworkErrorBanner
  networkErrorDismissAriaLabel: 'Dismiss',
  networkErrorHeading: "Map data didn't load",
  networkErrorCatalogBody: "The map loaded but the activity list didn't, so no pins are showing. This is usually a temporary rate limit on a shared network.",
  networkErrorCatalogHint: 'Wait a minute and reload. If it keeps happening on office or school wifi, try a phone hotspot.',
  networkErrorConfigBody: 'The backend is still being set up. Please try again in a few minutes.',
  networkErrorReachPrefix: "Your browser couldn't reach",
  networkErrorReachSuffix: '. Corporate firewalls (Zscaler, Netskope, etc.) often block this.',
  networkErrorAllowlistPrefix: 'Try a different network (phone hotspot usually works), or ask IT to allowlist',
  networkErrorAllowlistAnd: 'and',
  networkErrorAllowlistSuffix: '.',

  basemaps: {
    light: 'Light',
    dark: 'Dark',
    street: 'Street',
    // "Liberty" is the style's brand name — untranslated in every locale.
    liberty: 'Liberty (3D)',
    satellite: 'Satellite',
  },
  // Read by `loadLocale` in src/i18n/index.ts, not by a component.
  documentTitle: 'Things to Do With Kids Near You | frolicmap',
} as const
