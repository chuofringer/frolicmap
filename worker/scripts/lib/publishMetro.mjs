/**
 * Source rewriting for promote-metro — extracted so it can be unit-tested.
 *
 * The in-script version had a proven HIGH bug (deep review): its "trailing
 * opts object" regex matched the LAST `{...}` before the closing paren, which
 * on a metro line with no opts is the contentBbox — so promoting any of the
 * 37 fast-follow metros injected `published: true` INSIDE the bbox literal.
 * `metro()`'s opts stayed undefined, the metro remained unpublished, and the
 * re-import verify step aborted telling the operator to revert. Wave metros
 * masked the bug because they all carry `{ wave: true }`.
 *
 * The fix distinguishes the two shapes by counting object literals on the
 * line: two `{...}` groups mean bbox+opts (patch the second), one means
 * bbox only (append a fresh opts object).
 */

/**
 * Flip a metro's entry to `published: true` in the metros.ts source text.
 * Returns the updated source, the source unchanged when already published,
 * or null when the entry can't be found/rewritten (caller reports it).
 */
export function publishInSource(source, metroId) {
  const lineRe = new RegExp(`^(\\s*metro\\('${metroId}',.*)$`, 'm')
  const m = lineRe.exec(source)
  if (!m) return null
  const line = m[1]
  if (/published:\s*true/.test(line)) return source

  const objects = line.match(/\{[^{}]*\}/g) ?? []
  let updated
  if (objects.length >= 2) {
    // bbox + opts: patch the final object (the opts), anchored to line end so
    // the bbox — which is never last — can't match.
    updated = line.replace(/\{([^{}]*)\}(\s*\),?\s*)$/, (_all, inner, tail) => {
      const body = inner.trim().replace(/,$/, '')
      return `{ ${body}, published: true }${tail}`
    })
  } else if (objects.length === 1) {
    // bbox only: append a new opts argument.
    updated = line.replace(/\)(,?\s*)$/, ', { published: true })$1')
  } else {
    return null
  }
  if (updated === line) return null
  return source.replace(line, updated)
}
