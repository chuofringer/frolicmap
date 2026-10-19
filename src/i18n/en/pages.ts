/**
 * Standalone routes: the chrome (headings, nav, "last updated") around the
 * legal pages, plus the /cities index. The legal PROSE itself is deliberately
 * not translated — English stays the binding version. (The SignupPage slice
 * left with the page itself, 2026-08-09 — the newsletter surface is now the
 * opt-in checkbox on the sign-in gates.)
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides.
 */
export const pages = {
  backToMap: '← Back to map',
  legal: {
    termsTitle: 'Terms of Service',
    privacyTitle: 'Privacy Policy',
    lastUpdated: 'Last updated: {{date}}',
    termsLink: 'Terms',
    privacyLink: 'Privacy',
    copyright: '© {{year}} funradar.app',
  },
  /** /unsubscribe (#535) — the newsletter's own off-ramp, linked from every
   *  digest footer as `?email={{EMAIL}}`. The success copy is deliberately
   *  hedged ("if that address was subscribed"): the endpoint answers the same
   *  200 for a subscribed, unknown, or already-unsubscribed address so it
   *  can't be used to test who is on the list, and the page must not claim
   *  more than the server actually confirmed. */
  unsubscribe: {
    heading: 'Unsubscribe from the newsletter',
    lede: 'Enter the address you signed up with and we’ll take it off the list — you won’t receive the weekly roundup when it launches.',
    emailLabel: 'Your email',
    emailPlaceholder: 'you@example.com',
    submit: 'Unsubscribe',
    submitting: 'Unsubscribing…',
    doneHeading: 'Done.',
    doneBody: 'If that address was subscribed, it’s now unsubscribed.',
    backToTheMap: '← Back to the map',
    genericError: 'That didn’t work. Please try again.',
    connecting: 'Connecting…',
    unavailable: 'Unsubscribing is temporarily unavailable. Email frolicmap.official@gmail.com and we’ll take you off the list.',
  },
  cities: {
    backToMap: '← Back to the map',
    heading: 'Kids activities by city',
    lede: 'Interactive maps of playgrounds, parks, libraries, museums, aquariums/zoos, beaches, water play, hiking, campgrounds, U-Pick farms and events — free, no signup.',
    moreComing: 'More cities coming soon.',
  },
  /**
   * Copy for the prerendered `/zh/cities` + `/zh/cities/{slug}` pages (#693).
   * Consumed by `worker/scripts/build-seo-pages.mjs` (it loads the ZH slice
   * only; these English values exist so `Translation['pages']` forces a
   * Chinese string for every key). `{{x}}` placeholders are filled by the
   * generator. The English pages keep their own copy in the generator.
   */
  citySeo: {
    home: 'funradar',
    cities: 'Cities',
    cityTitle: '{{city}} Kids Activities Map — {{categories}}',
    cityHeading: 'Kids activities in {{city}}',
    cityDescription: 'An interactive map of kid-friendly places across {{city}} — {{categories}}. Free, no signup.',
    cityKeywords: 'kids activities {{city}}, things to do with kids {{city}}, family activities {{city}}',
    cityImageAlt: '{{city}} kids activities map on funradar.app — {{categories}}.',
    loadingMap: 'Loading the interactive map…',
    browseCity: 'Browse {{city}}',
    comingSoonHeading: 'Coming soon to {{city}}',
    comingSoonTag: '(coming soon)',
    nearbyHeading: 'Nearby cities',
    browseAll: 'Browse all cities →',
    indexTitle: 'Kids Activities by City — {{categories}}',
    indexDescription: 'Interactive maps of {{categories}} — free, no signup.',
    indexHeading: 'Kids activities by city',
    indexLede: 'Interactive maps of {{categories}} — built for parents deciding what to do this weekend.',
    indexTotal: '{{count}} places across {{metros}} cities.',
    placesApprox: '{{count}}+ places',
    mapAriaLabel: 'Map of {{city}}',
    footer: 'a map of kids activities.',
    separator: ', ',
    lastSeparator: ' & ',
  },
} as const
