/**
 * FAQ overlay: FAQOverlay questions and answers.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 *
 * Every answer here renders in every published metro, so none of them may
 * state a Bay-Area-only fact. Two rules that fall out of that:
 *
 *  - `a0` interpolates `{{metro}}` (fed `metro.shortLabel` → "SF Bay Area"),
 *    and the metro name sits in an ARTICLE-FREE position: "the {{metro}}"
 *    rendered "across the Seattle" on every national metro.
 *  - Sourcing, cadence and coverage claims (`a2`, `a3`) are written to be
 *    true in the thinnest metro as well as the best-covered one — the FAQ
 *    component has no per-metro branching, and adding one would put a
 *    coverage matrix in the copy layer.
 */
export const faq = {
  dialogAriaLabel: 'Help and FAQ',
  heading: 'Help & FAQ',
  closeAriaLabel: 'Close FAQ',
  items: {
    q0: 'What is frolicmap?',
    a0: 'A clean map of kid-friendly places for families — currently showing {{metro}}. Playgrounds, parks, libraries, museums, aquariums/zoos, beaches, water play, hiking trails and campgrounds, all in one place.',
    q1: 'Is frolicmap free?',
    a1: 'Yes. frolicmap is free, ad-free, and needs no account.',
    q2: 'Where does the data come from?',
    a2: 'Places come from OpenStreetMap, the Institute of Museum and Library Services (libraries and museums), the National Park Service, and the Trust for Public Land’s ParkServe park data. Photos, where shown, come from Wikimedia Commons and carry their own attribution. Basemaps and address search are provided by standard open mapping services.',
    q3: 'How current is the information?',
    a3: 'Places are refreshed from their sources every few months. Each item links to its original source so you can confirm hours and price before heading out.',
    q4: 'How do filters work?',
    a4: 'Tap All filters to open the filter drawer. You can filter by category (multi-select chips), indoor vs outdoor, age range (0–18), and free-only. Active filters shrink the set of pins on the map.',
    q5: 'How do I find places near me?',
    a5: 'Tap "Near me" in the search bar. Your browser asks permission for geolocation, then the map zooms to your location and shows only places within a 10-mile radius (roughly a 15-minute drive in typical city traffic). Tap "Near me" again to clear it.',
    q6: 'Can I switch between map styles or see 3D buildings?',
    a6: 'Yes — tap the layers icon (top right) to switch between Light, Dark, Street, Liberty (3D), and Satellite. Tap the "3D" button to tilt the camera; with Liberty you\'ll see extruded 3D buildings at higher zoom.',
    q7: 'How accurate are the map pins?',
    a7: "Most pins land within ~50m of the actual entrance, but some can be off by a block or two — especially for venues with multiple buildings, side entrances, or addresses that geocoding services don't pin precisely (small lanes, rural roads, large parks). Always cross-check with the address shown in the details before driving over. The address is the source of truth; the pin is a visual approximation. If a pin is clearly wrong, tap Report.",
    q8: 'Something is wrong with a place — how do I report it?',
    a8: "Tap the pin to open its details, then Report an issue. We'll review and update or remove it.",
    q9: 'What is frolicmap built with?',
    a9: 'A modern web stack: a React + TypeScript single-page app with an interactive vector map, a lightweight edge API, a managed SQL database, and standard open mapping services for basemaps and geocoding.',
    q10: 'Privacy',
    a10: 'frolicmap has no accounts, no newsletter and no ads. It stores only your display preferences (such as map style and language) in your browser. Geolocation ("Near me") runs entirely in your browser — your coordinates never leave your device. Basemap tiles and address search go through their respective providers under their own privacy policies. We may use Cloudflare’s privacy-first Web Analytics (no cookies, no cross-site tracking, no personal profiles); no other analytics service is in use. See the Privacy page for details.',
  },
  contactHeading: 'Contact & Feedback',
  contactPrompt: 'Have a question, a place to add, or a correction? Email',
  contactEmail: 'frolicmap.official@gmail.com',
  copyEmailTitle: 'Copy email to clipboard',
  emailCopied: 'Copied!',
  termsLink: 'Terms',
  privacyLink: 'Privacy',
  dotSeparator: '·',
  copyright: '© frolicmap',
  infoOnly: 'Informational only.',
} as const
