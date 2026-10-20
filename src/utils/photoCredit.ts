import { isAllowedPhotoUrl } from '@shared/photoHost'

export interface PhotoCredit {
  /** Human-readable credit, e.g. "Jane Doe / Wikimedia Commons (CC BY-SA 4.0)". */
  text: string
  /** Commons file-page URL; only ever a host allowed by `shared/photoHost.ts`. */
  sourceUrl?: string
  /** Licence deed URL (https, on a known licence host). */
  licenceUrl?: string
}

const SEPARATOR = ' | '

// Hosts Commons' `LicenseUrl` points at in practice. An https URL anywhere else
// is dropped rather than rendered as a link, so a hand-edited attribution
// cannot smuggle an arbitrary outbound link into the panel.
const LICENCE_HOSTS = ['creativecommons.org', 'www.gnu.org', 'artlibre.org']

function isLicenceUrl(url: string): boolean {
  return LICENCE_HOSTS.includes(new URL(url).hostname.toLowerCase())
}

/** A trimmed value as an `https://` URL string, or null. */
function httpsUrl(value: string): string | null {
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** True when the segment is shaped like a URL at all (so it never leaks into the visible text). */
function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(value) || /^(javascript|data):/i.test(value)
}

/**
 * Parse `photo_attribution`. Understands both the old plain form
 * ("Artist / Wikimedia Commons (CC BY-SA 4.0)") and the suffixed form
 * ("<text> | <file page URL> | <licence URL>", written by
 * `worker/scripts/lib/backfillPhotos.mjs`; either URL may be absent).
 *
 * Trailing ` | `-separated URL segments are peeled off from the end; a URL on
 * an allowed photo host is the source, an https URL on a known licence host is
 * the licence, and anything unusable (http, malformed, unknown host, a second of the same kind) is
 * dropped, never shown. Remaining segments, including an artist name that
 * itself contains " | ", stay in `text`.
 */
export function parsePhotoCredit(attribution: string): PhotoCredit {
  const parts = (attribution ?? '').split(SEPARATOR)
  let sourceUrl: string | undefined
  let licenceUrl: string | undefined
  while (parts.length > 1 && looksLikeUrl(parts[parts.length - 1].trim())) {
    const candidate = httpsUrl(parts.pop()!.trim())
    if (!candidate) continue
    if (isAllowedPhotoUrl(candidate)) sourceUrl ??= candidate
    else if (isLicenceUrl(candidate)) licenceUrl ??= candidate
  }
  const out: PhotoCredit = { text: parts.join(SEPARATOR).trim() }
  if (sourceUrl) out.sourceUrl = sourceUrl
  if (licenceUrl) out.licenceUrl = licenceUrl
  return out
}

/**
 * Split a credit into the text before the trailing "(LICENCE)" group, the
 * licence name, and what follows it, so the name can be linked. `licence` is
 * null when the text has no trailing parenthetical.
 */
export function splitLicence(text: string): { before: string; licence: string | null } {
  const m = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/s)
  return m ? { before: m[1], licence: m[2] } : { before: text, licence: null }
}
