/**
 * FAQ overlay: FAQOverlay questions and answers, plus the language switcher row.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 *
 * Every answer here renders in all 15 published metros, so none of them may
 * state a Bay-Area-only fact (issue #420). Two rules that fall out of that:
 *
 *  - `a0` interpolates `{{metro}}` (fed `metro.shortLabel` → "SF Bay Area"),
 *    and the metro name sits in an ARTICLE-FREE position: "the {{metro}}"
 *    rendered "across the Seattle" on every national metro.
 *  - Sourcing, cadence and coverage claims (`a2`, `a3`, `a5`, `a11`) are
 *    written to be true in the thinnest metro as well as the Bay Area —
 *    the FAQ component has no per-metro branching, and adding one would put
 *    a coverage matrix in the copy layer.
 */
export const faq = {
  dialogAriaLabel: 'Help and FAQ',
  heading: 'Help & FAQ',
  closeAriaLabel: 'Close FAQ',
  items: {
    q0: 'What is funradar.app?',
    a0: 'A clean map of kids-friendly places and events for families — currently showing {{metro}}. Playgrounds, parks, libraries, museums, aquariums/zoos, beaches, and weekend events, all in one place.',
    q1: 'Is funradar free?',
    a1: 'funradar is free and ad-free. If it saves your weekend now and then, you can support it at buymeacoffee.com/funradar.app ☕',
    q2: 'Where does the data come from?',
    a2: 'Places come from a mix of open map data, national library and museum directories, national and local park-agency listings, and public city and county open-data portals. In cities where events are live, they come from library and venue calendar feeds plus listings we hand-check from local family-activity sites; elsewhere the events layer shows as coming soon. Basemaps and address search are provided by standard open mapping services.',
    q3: 'How current is the information?',
    a3: 'Where events are live they refresh weekly; places refresh every few months. Each item shows a "Last verified" date in its detail panel — and a link to the original source so you can confirm hours and price before heading out.',
    q4: 'How do filters work?',
    a4: 'Tap the gear icon (top right) to open the filter drawer. You can filter by category (multi-select chips), time window (Today / This weekend / Next 2 weeks — leave none selected to see everything), indoor vs outdoor, age range (0–18), and free-only. Active filters shrink the set of pins on the map.',
    q5: 'How do I find activities near me?',
    a5: 'Tap "Nearby activities" in the bottom-left. Your browser asks permission for geolocation, then the map zooms to your location and shows a 10-mile radius circle (roughly a 15-minute drive in typical city traffic). Pins outside the circle are hidden until you tap "Clear".',
    q6: 'Can I switch between map styles or see 3D buildings?',
    a6: 'Yes — tap the layers icon (top right) to switch between Light, Dark, Street, Liberty (3D), and Satellite. Tap the "3D" button to tilt the camera; with Liberty you\'ll see extruded 3D buildings at higher zoom.',
    q7: 'How accurate are the map pins?',
    a7: "Most pins land within ~50m of the actual entrance, but some can be off by a block or two — especially for venues with multiple buildings, side entrances, or addresses that geocoding services don't pin precisely (small lanes, rural roads, large parks). Always cross-check with the address shown in the popup before driving over. The address is the source of truth; the pin is a visual approximation. If a pin is clearly wrong, tap Report.",
    q8: 'Something is wrong with a pin — how do I report it?',
    a8: "Tap the pin to open the popup, then Report. We'll review and update or remove it.",
    q9: 'Is AI used anywhere on funradar?',
    a9: "Yes — only for one job: extracting structured details (name, date, location, age range) from messy event web pages using a large language model. The model is instructed to never invent facts and to return null when it's unsure. Every AI-extracted item lands in a human review queue before going live; nothing is auto-published. AI is never used to generate descriptions or fake events.",
    q10: 'What is funradar built with?',
    a10: 'A modern web stack: a React + TypeScript single-page app with an interactive vector map, a lightweight edge API, a managed SQL database, and standard open mapping services for basemaps and geocoding.',
    q11: 'Privacy',
    a11: 'funradar.app does not track you. Browsing the map needs no account — signing in with Google is optional — it unlocks the curated events list, creates an account you can delete at any time, and (only if you tick the box) signs you up for the coming-soon weekly email. Geolocation ("Activities near me") runs entirely in your browser — your coordinates never leave your device. Basemap tiles, address search, and city open-data fetches go through their respective providers under their own privacy policies. We use Cloudflare’s privacy-first Web Analytics (no cookies, no cross-site tracking, no personal profiles); no other analytics service is in use.',
    // #254 affiliate disclosure (FTC 16 CFR Part 255). Written to stay true
    // whether or not any partner id is configured server-side ("may be") —
    // the copy layer can't see the worker's env, and a false "are" would be
    // worse than a cautious "may be".
    q12: 'Does funradar make money?',
    a12: 'funradar is free to use and ad-free. Some outbound links — for example ticket links to partner sites like EventBrite or GetYourGuide — may be affiliate links, meaning funradar can earn a small commission on purchases made through them, at no extra cost to you. Affiliate partnerships never affect what appears on the map or how it is ranked. You can also support funradar directly at buymeacoffee.com/funradar.app.',
  },
  /** Account block (#535) — renders at the bottom of the overlay for signed-in
   *  visitors only. The FAQ is the one place a signed-in parent can reliably
   *  find, so it carries sign-out and the self-serve deletion the privacy
   *  policy's §12 right needs. The confirm step is inline copy, not a browser
   *  `confirm()` dialog. */
  accountHeading: 'Account',
  signedInAs: 'Signed in as {{email}}',
  signOut: 'Sign out',
  deleteAccount: 'Delete account',
  deleteConfirmPrompt: 'This deletes your account and any newsletter subscription. Delete?',
  deleteConfirmYes: 'Delete',
  deleteCancel: 'Cancel',
  deleting: 'Deleting…',
  deleteError: 'That didn’t work. Please try again, or email frolicmap.official@gmail.com.',
  contactHeading: 'Contact & Feedback',
  contactPrompt: 'Have a question, a venue to add, or a correction? Email',
  contactEmail: 'frolicmap.official@gmail.com',
  copyEmailTitle: 'Copy email to clipboard',
  emailCopied: 'Copied!',
  termsLink: 'Terms',
  privacyLink: 'Privacy',
  dotSeparator: '·',
  copyright: '© funradar.app',
  infoOnly: 'Informational only.',
  /** Language switcher row (#208 task 3) — literal words, never translated further. */
} as const
