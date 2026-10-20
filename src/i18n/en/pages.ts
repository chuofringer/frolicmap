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
    cityTitle: 'Things to Do With Kids in {{city}} | frolicmap',
    cityHeading: 'Kids activities in {{city}}',
    cityDescription: 'Kids activities in {{city}}: {{categories}}.',
    legend: 'playgrounds, parks, libraries, museums, aquariums and zoos, beaches, water play, hiking and campgrounds',
    cityLegendHeading: '{{categories}} in {{city}}',
    breadcrumbHome: 'Home',
    cityKeywords: 'kids activities {{city}}, things to do with kids {{city}}, family activities {{city}}',
    cityImageAlt: '{{city}} kids activities map on frolicmap.app — {{categories}}.',
    loadingMap: 'Loading the interactive map…',
    nearbyHeading: 'Nearby cities',
    browseAll: 'Browse all cities →',
    indexTitle: 'Kids Activities by City | frolicmap',
    indexDescription: 'Interactive maps of {{categories}} — free, no account needed.',
    indexLegendHeading: 'Maps of {{categories}}',
    indexHeading: 'Kids activities by city',
    indexLede: 'Interactive maps of {{categories}} — built for parents deciding what to do this weekend.',
    indexTotal: '{{count}} places across {{metros}} cities.',
    placesApprox: '{{count}}+ places',
    mapAriaLabel: 'Map of {{city}}',
    footer: 'a map of kids activities.',
    privacyLink: 'Privacy',
    termsLink: 'Terms',
    contactLink: 'Contact',
    openSource: "Code is open source (MIT); place data is redistributed under each source's licence.",
    separator: ', ',
    lastSeparator: ' & ',
  },
} as const
