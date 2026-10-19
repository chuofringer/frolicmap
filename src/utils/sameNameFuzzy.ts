// Tokenize a name for fuzzy dedup: lowercase, strip punctuation, drop
// 4-digit years ("Santa Clara County Fair 2026" → [santa clara county
// fair]). Years drift year-over-year but refer to the same event, so
// they shouldn't break a name match.
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// True when two names plausibly refer to the same thing. Used by
// `StackedFeatureList` to collapse undated venue rows against dated
// sibling events at the same pin (e.g. "Santa Clara County Fair 2026"
// swallows "Santa Clara County Fairgrounds").
//
// Match rule:
//   • shared leading tokens (last shorter token may be a prefix of the
//     matching longer token, so "Fair" matches "Fairgrounds"), AND
//   • either ≥3 shared tokens, OR ≥2 shared tokens with ≥15 chars of
//     shared prefix.
//
// The char-length guard prevents generic 2-token prefixes like "Bay
// Area" or "San Francisco" from collapsing distinct rows that happen
// to coincide at the same lat/lng.
export function sameNameFuzzy(a: string, b: string): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  let matched = 0
  let chars = 0
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) {
      matched++
      chars += shorter[i].length
      continue
    }
    if (i === shorter.length - 1 && longer[i].startsWith(shorter[i])) {
      matched++
      chars += shorter[i].length
    }
    break
  }
  if (matched < 2) return false
  return matched >= 3 || chars >= 15
}
