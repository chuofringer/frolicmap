// Photo-URL host allow-list (issue #299 follow-up, PR #666 review).
//
// `shared/types.ts::Item.photo_attribution` documents the invariant this
// file enforces: "Only ever set alongside a photo_url sourced from OSM's
// `image`/`wikimedia_commons` tags or the Wikimedia Commons API — both
// carry an attribution requirement." The ingest path
// (`shared/osm.ts::resolvePhotoCandidateFromTags`) and the offline backfill
// (`worker/scripts/lib/backfillPhotos.mjs`) both already only ever produce a
// Wikimedia Commons URL (`resolveCommonsTitle`'s "LICENSE SCOPE" comment).
//
// The admin editor's `photo_url` field is the one place a human can type or
// paste ANYTHING, and until this file existed the server side only checked
// the scheme (`https://`) — accepting a curator paste of any https host.
// That is a real problem, not a hypothetical one: an `<img src>` pointed at
// an arbitrary third-party host leaks every public viewer's IP + user-agent
// to that host on every page load (tracking), can be swapped out from under
// us by that host at any time, and sidesteps the license/attribution
// guarantee the rest of this pipeline exists to uphold. This is the ONE
// predicate for "is this URL safe to store and render publicly" — used by
// both the worker's `PUT /api/admin/items/:id` (the actual gate) and the
// admin UI's client-side mirror (`src/admin/ItemEditor.tsx`, so a curator
// sees the problem before submitting rather than after a 400).
export const ALLOWED_PHOTO_HOSTS: readonly string[] = ['upload.wikimedia.org', 'commons.wikimedia.org']

/** Case-insensitive exact match against the allow-list (no subdomain wildcarding). */
export function isAllowedPhotoHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_PHOTO_HOSTS.includes(h)
}

/**
 * True only for an `https://` URL whose host is on the allow-list. Anything
 * else — plain `http://`, `javascript:`/`data:`, a well-formed https URL on
 * an untrusted host, or a string that isn't a URL at all — is false.
 */
export function isAllowedPhotoUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && isAllowedPhotoHost(parsed.hostname)
}
