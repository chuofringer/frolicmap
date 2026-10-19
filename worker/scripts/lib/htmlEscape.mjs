// The one HTML escaper for the Node-side generators.
//
// Private copies had accumulated (seoPages.mjs, prerenderShell.mjs, ...) —
// every generator emits HTML built from D1 strings, and all need exactly
// this. A further copy is the failure mode worth preventing: the copies
// drift, one of them loses `'` or `"`, and the generator that lost it starts
// emitting attribute-breaking output from third-party text.

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
