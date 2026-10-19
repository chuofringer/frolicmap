/**
 * Detail surfaces: DetailPanel, BottomSheet, StackedFeatureList, SiblingDatesStrip, UpickSeasonStrip, ReportModal, NearbyBox, useDetailData.
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
  when: 'WHEN',
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
  // FTC affiliate disclosure (#254) — shown only when the open item's
  // Website/Source link was rewritten to an affiliate-tagged URL.
  affiliateDisclosure:
    'Some links are affiliate links — funradar may earn a small commission, at no extra cost to you.',
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
  upcomingDates: 'Upcoming dates',
  moreDates: '+{{count}} more',
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
  upick: {
    open: 'Open',
    openToday: 'Open today',
    closedForSeason: 'Closed for season',
    opensDate: 'Opens {{date}}',
    // "{{band}}" carries its own trailing hyphen in English ('early-', 'mid-',
    // 'late-') so it butts straight against {{month}} with no separator —
    // matches the original `${dayBand(...)}${fmtMonth(...)}` concatenation.
    opensTypical: 'Opens ~{{band}}{{month}} (typical)',
    season: 'Season: {{start}} – {{end}}, {{year}}',
    dayBandEarly: 'early-',
    dayBandMid: 'mid-',
    dayBandLate: 'late-',
    soonSuffix: ' · soon',
    laterSuffix: ' · later',
  },
} as const
