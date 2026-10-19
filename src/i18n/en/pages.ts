/**
 * Standalone routes: the chrome (headings, nav, "last updated") around the
 * legal pages, plus the /cities index. The legal PROSE itself is deliberately
 * not translated — English stays the binding version.
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
    copyright: '© {{year}} frolicmap',
  },
  cities: {
    backToMap: '← Back to the map',
    heading: 'Kids activities by city',
    lede: 'Interactive maps of playgrounds, parks, libraries, museums, aquariums/zoos, beaches, water play, hiking and campgrounds — free, no account needed.',
  },
  /**
   * Copy for the prerendered `/zh/cities` + `/zh/cities/{slug}` pages (#693).
   * Consumed by `worker/scripts/build-seo-pages.mjs` (it loads the ZH slice
   * only; these English values exist so `Translation['pages']` forces a
   * Chinese string for every key). `{{x}}` placeholders are filled by the
   * generator. The English pages keep their own copy in the generator.
   */
  citySeo: {
    home: 'frolicmap',
    cities: 'Cities',
    cityTitle: '{{city}} Kids Activities Map — {{categories}}',
    cityHeading: 'Kids activities in {{city}}',
    cityDescription: 'An interactive map of kid-friendly places across {{city}} — {{categories}}. Free, no account needed.',
    cityKeywords: 'kids activities {{city}}, things to do with kids {{city}}, family activities {{city}}',
    cityImageAlt: '{{city}} kids activities map on frolicmap.app — {{categories}}.',
    loadingMap: 'Loading the interactive map…',
    browseCity: 'Browse {{city}}',
    nearbyHeading: 'Nearby cities',
    browseAll: 'Browse all cities →',
    indexTitle: 'Kids Activities by City — {{categories}}',
    indexDescription: 'Interactive maps of {{categories}} — free, no account needed.',
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
