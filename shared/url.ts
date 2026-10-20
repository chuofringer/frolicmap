/**
 * True only for a string that parses with `new URL` and whose scheme is
 * `http:` or `https:`. Everything else (`javascript:`, `data:`, `tel:`,
 * `mailto:`, bare text, empty or non-string input) is false.
 *
 * Used before storing (OSM ingest) and before rendering (`websiteFor`) any
 * third-party URL as an `<a href>`, so a hostile `website=javascript:...`
 * tag can never become a clickable script link.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const { protocol } = new URL(trimmed)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
