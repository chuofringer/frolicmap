// Address normalization (issue #307). A pure string transform that collapses
// street-address variants pointing at the same physical location, so rows for
// the same venue can be recognised as sharing an address.
//
// Examples that should normalize to the same string:
//   "2000 Bunker Rd, Sausalito, CA 94965"
//   "2000 Bunker Road, Sausalito, CA"
//   "2000 Bunker Rd. Sausalito CA 94965"
// → "2000 bunker rd"
//   "2625 Homestead Road, Santa Clara, CA 95051"
//   "2625 Homestead Rd Suite A"                      (no city on this row)
// → both key on "2625 homestead rd" — city/state/zip/suite all excluded
//   from the key, see the module doc below for why.
//
// Returns null for venue-name-only addresses ("Slide Ranch, Muir Beach, CA")
// which don't have a stable normalization key — those are best matched via
// the dedupCluster name+coord logic instead.
//
// --- issue #307: libpostal trade-off ---
// The issue proposed adopting libpostal (openvenues/libpostal + node-postal)
// for this. Rejected: libpostal is a C library with a ~2GB trained-model
// data file loaded via native Node bindings (node-postal ships a .node
// addon). Two disqualifiers for this codebase:
//   1. The scripts this feeds run both locally AND in GitHub Actions
//      (see .github/workflows) — a native addon would
//      need `apt-get install libpostal` (or a prebuilt binary matching the
//      runner's glibc/arch) before every run, or a Docker image, adding a
//      real ongoing maintenance cost for build-time tooling only.
//   2. Even restricted to operator-only scripts (the issue's own fallback
//      scope), a 2GB model download is a heavy, slow-to-provision
//      dependency for what is a short pure-string transform.
// Chose (a): the pure-JS npm package `parse-address` (github.com/
// hassansin/parse-address, port of Perl's Geo::StreetAddress::US). Verified
// before adopting:
//   - genuinely pure JS: one dependency (`xregexp`, also pure JS — its own
//     only dependency is `@babel/runtime-corejs3`); no native bindings, no
//     WASM, no model files.
//   - small: ~74 KB unpacked.
//   - solves exactly the two false-negative classes issue #307 cites: it
//     strips secondary-unit designators (Suite/Apt/Unit/#) into their own
//     field instead of leaving them in the street line, and it normalizes
//     directional prefixes/suffixes (N/North, NE, etc.) and the full USPS
//     street-suffix table (Rd/Road, Ave/Avenue, Blvd/Boulevard, ...) — far
//     more complete than the hand-rolled STREET_TYPE_ABBREV table this
//     module used before.
//   - one known gap: it does not handle a venue-name segment prefixed
//     before the numbered street address ("Classic Bowling Center, 900
//     King Drive, Daly City, CA" — it mis-parses "Classic Bowling" as the
//     street and "Center" as a suffix type). This module's existing
//     venue-prefix-stripping pass (find the first comma segment that
//     starts with a digit) already handles that case and runs before the
//     string reaches the parser, so the gap is fully covered.
//
// This is a build-time/operator-tooling module only (never imported by
// worker/src — the Worker runtime never sees `parse-address` or its
// dependency tree), so the native-vs-Workers constraint that rules out
// libpostal doesn't apply the other way: a small pure-JS npm dep here is
// fine, it's just that a *native* one isn't.
import parser from 'parse-address'

export function normalizeAddress(addr) {
  if (typeof addr !== 'string' || !addr.trim()) return null

  // Find the first comma-separated segment that starts with a street
  // number. Drop any venue-name prefix in front of it — parse-address
  // doesn't handle that case (see trade-off note above). Examples:
  //   "Classic Bowling Center, 900 King Drive, Daly City, CA"
  //     → "900 King Drive, Daly City, CA"
  //   "Eucalyptus Grove, Stanford University, Stanford, CA"
  //     → no street-number segment, left as-is; parser will fail to find
  //       a `number` and we return null below.
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean)
  const startIdx = parts.findIndex((p) => /^\s*\d/.test(p))
  const forParsing = startIdx === -1 ? addr : parts.slice(startIdx).join(', ')

  let parsed
  try {
    parsed = parser.parseLocation(forParsing)
  } catch {
    return null
  }
  // No street number or no street name → not a reliably-normalizable
  // street address (venue-name-only rows land here, e.g. "Slide Ranch").
  if (!parsed || !parsed.number || !parsed.street) return null

  // Key = number + directional prefix + street name + suffix type +
  // directional suffix ONLY. Deliberately excludes city/state/zip and
  // secondary unit (suite/apt number). Two issue #307 motivating examples
  // are exactly why city is left out: "2625 Homestead Road, Santa Clara,
  // CA 95051" vs "2625 Homestead Rd Suite A" (the second has no city at
  // all) must key the same, or the street-number+name+type match — by far
  // the strongest signal for "same physical address" — gets thrown away
  // whenever one source omits city/state/zip. The residual risk (two
  // distinct streets, different cities, coincidentally sharing a house
  // number + name + type) is bounded by every consumer of this key being a
  // human-reviewed audit report, never an auto-apply: a false collision
  // just surfaces as an obviously-wrong outlier coord in the report.
  const keyParts = [
    parsed.number,
    parsed.prefix,
    parsed.street,
    parsed.type,
    parsed.suffix,
  ].filter(Boolean)

  const key = keyParts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return key || null
}
