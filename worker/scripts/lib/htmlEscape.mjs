// The one HTML escaper for the Node-side generators.
//
// Three byte-identical private copies had accumulated (seoPages.mjs,
// prerenderShell.mjs, digest.mjs) — all three emit HTML built from D1
// strings, and all three need exactly this. A fourth copy is the failure
// mode worth preventing: the copies drift, one of them loses `'` or `"`,
// and the generator that lost it starts emitting attribute-breaking output
// from LLM-extracted third-party text.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 *
 * Escapes all five of `& < > " '`. Both quote forms matter: these generators
 * interpolate into single- and double-quoted attributes alike, and the source
 * strings are LLM-extracted from third-party pages, so an apostrophe is
 * routine and an injected tag is possible.
 *
 * `null` / `undefined` render as the empty string, which is what every call
 * site wants for an absent optional field.
 */
export function escapeHtml(value) {
  if (value == null) return ''
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}
