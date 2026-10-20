// Name-token primitives shared by the place dedup (lib/dedupPlaces.mjs).
//
// These started life inside a date-aware duplicate-cluster heuristic; only the
// name half is relevant to static places, so only that half is kept. Places
// have no start time or recurrence rule, so matching on coordinates and
// category lives in dedupPlaces.mjs and this module just supplies the token
// set and its jaccard score.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'at', 'in', 'on', 'for',
  'with', 'to', 'by', 'from', '2025', '2026', '2027',
])

/**
 * Lowercased alphanumeric tokens of a name, minus stopwords and tokens
 * shorter than two characters. Non-strings yield an empty set.
 */
export function nameTokens(s) {
  if (typeof s !== 'string') return new Set()
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  return new Set(tokens)
}

/** Jaccard overlap of two token sets; 0 when either is empty. */
export function tokenJaccard(a, b) {
  if (!a.size || !b.size) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return intersect / (a.size + b.size - intersect)
}
