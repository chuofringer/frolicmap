/**
 * Detail surfaces: DetailPanel, BottomSheet, StackedFeatureList, ReportModal, useDetailData.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 */
export const detail = {
  close: 'Close',
  backToList: 'Back to list ({{count}} items)',
  free: 'Free',
  outdoor: 'Outdoor',
  indoor: 'Indoor',
  ages: 'Ages {{min}}–{{max}}',
  hours: 'HOURS',
  goodToKnow: 'Good to know',
  detailsUnavailable: 'Details unavailable right now — try reopening.',
  detailsLoadFailed: 'Couldn’t load details.',
  tryAgain: 'Try again',
  googleMaps: 'Google Maps',
  appleMaps: 'Apple Maps',
  website: 'Website',
  share: 'Share',
  copied: 'Copied ✓',
  source: 'Source:',
  // `{{attribution}}` is the artist/license string the backfill script
  // stores verbatim in `photo_attribution` (e.g. "Jane Doe / Wikimedia
  // Commons (CC BY-SA 4.0)") — not itself translated, since it names a
  // real person and a standard license code either way.
  photoAttribution: 'Photo: {{attribution}}',
  verified: 'Verified {{date}}',
  reportAnIssue: 'Report an issue',
  openUntilChip: 'Open · until {{time}}',
  // Distance always names its origin — see formatDistanceMi. The old
  // origin-less '{{value}} mi' was ambiguous between the device location and
  // the map center, which are different trips.
  distanceMiFromYou: '{{value}} mi from you',
  // #645: shown in the HOURS box when a place has no opening_hours on file —
  // an explicit "unknown" beats a silently missing section.
  hoursUnknown: 'Hours unknown — check the website',
  dragToResize: 'Drag to resize',
  itemsHere: '{{count}} items here',
  goodToKnowFacts: {
    restrooms: 'Restrooms nearby',
    strollerFriendly: 'Stroller friendly',
    picnicTables: 'Picnic tables',
    shade: 'Shade',
  },
  report: {
    title: 'Report a problem',
    thanks: "Thanks — we'll review it.",
    reasonClosed: 'Closed / no longer here',
    reasonWrongInfo: 'Wrong info (hours, address, etc.)',
    reasonNotKidFriendly: 'Not actually kid-friendly',
    reasonOther: 'Other',
    detailsPlaceholder: 'Details (optional)',
    cancel: 'Cancel',
    send: 'Send',
  },
} as const
