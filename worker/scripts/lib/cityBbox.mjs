// City bbox validator — guards against the failure mode where the LLM
// emits a real-looking street address but lat/lng pinned miles away.
// User spotted "Family Fun Days - Summer Kickoff" pinned in the Bay
// despite address "Los Altos Community Center, 97 Hillview Ave"; broader
// audit found 5 rows with this same class of bug that survived the
// city-centroid blocklist + address-digit guard from PR #124 because
// none were at known centroids and all had real addresses with digits.
//
// Strategy: extract the city name from the address (last "City, CA"
// segment), look up that city's bbox, and skip if lat/lng falls outside.
// Bboxes are intentionally generous (~2km buffer in each direction) so
// edge venues like Marine Mammal Center (right at Sausalito's coastal
// edge) don't false-positive. Unknown cities pass through (no validation
// signal — fall back to other guards).
//
// This catches "lat is wildly off" without needing an external geocoder.
// Doesn't catch: same-city events that point at the wrong building, or
// cities not yet in the table. Both are tolerable v1 limitations.

// Bay Area city bboxes. Buffered ~0.02° (2km) in each direction beyond
// the actual city limits to avoid false positives on edge venues.
export const CITY_BBOXES = {
  'San Francisco': { south: 37.69, west: -122.54, north: 37.84, east: -122.34 },
  'Oakland': { south: 37.69, west: -122.34, north: 37.87, east: -122.10 },
  'Berkeley': { south: 37.83, west: -122.34, north: 37.93, east: -122.20 },
  'Alameda': { south: 37.71, west: -122.33, north: 37.79, east: -122.21 },
  'San Jose': { south: 37.18, west: -122.07, north: 37.47, east: -121.72 },
  'San José': { south: 37.18, west: -122.07, north: 37.47, east: -121.72 },
  'Palo Alto': { south: 37.34, west: -122.20, north: 37.47, east: -122.08 },
  'East Palo Alto': { south: 37.45, west: -122.16, north: 37.49, east: -122.11 },
  'Mountain View': { south: 37.34, west: -122.13, north: 37.45, east: -122.00 },
  'Sunnyvale': { south: 37.31, west: -122.08, north: 37.43, east: -121.94 },
  // Los Altos south buffered to 37.31 (was 37.33) so Rancho San Antonio
  // open space (37.32, just south of city limits) doesn't false-positive.
  'Los Altos': { south: 37.31, west: -122.18, north: 37.41, east: -122.05 },
  'Los Altos Hills': { south: 37.33, west: -122.20, north: 37.41, east: -122.11 },
  'Cupertino': { south: 37.29, west: -122.09, north: 37.36, east: -121.97 },
  'Santa Clara': { south: 37.31, west: -122.01, north: 37.41, east: -121.89 },
  'Fremont': { south: 37.45, west: -122.07, north: 37.62, east: -121.84 },
  'Hayward': { south: 37.58, west: -122.15, north: 37.69, east: -121.91 },
  'Pleasanton': { south: 37.61, west: -121.95, north: 37.72, east: -121.79 },
  'Livermore': { south: 37.64, west: -121.83, north: 37.76, east: -121.63 },
  'Dublin': { south: 37.68, west: -122.01, north: 37.75, east: -121.82 },
  'San Ramon': { south: 37.71, west: -122.00, north: 37.81, east: -121.91 },
  'Danville': { south: 37.79, west: -122.02, north: 37.86, east: -121.93 },
  'Alamo': { south: 37.83, west: -122.05, north: 37.87, east: -121.98 },
  'San Mateo': { south: 37.50, west: -122.41, north: 37.59, east: -122.25 },
  'Belmont': { south: 37.49, west: -122.34, north: 37.55, east: -122.25 },
  'Redwood City': { south: 37.44, west: -122.33, north: 37.55, east: -122.16 },
  'Burlingame': { south: 37.54, west: -122.44, north: 37.62, east: -122.31 },
  'San Carlos': { south: 37.45, west: -122.32, north: 37.54, east: -122.21 },
  'Foster City': { south: 37.53, west: -122.32, north: 37.59, east: -122.22 },
  'Millbrae': { south: 37.57, west: -122.44, north: 37.62, east: -122.34 },
  'South San Francisco': { south: 37.61, west: -122.51, north: 37.70, east: -122.37 },
  'Pacifica': { south: 37.58, west: -122.53, north: 37.67, east: -122.43 },
  'Daly City': { south: 37.65, west: -122.51, north: 37.71, east: -122.41 },
  'Half Moon Bay': { south: 37.43, west: -122.48, north: 37.50, east: -122.39 },
  // Brentwood south buffered to 37.88 (was 37.90) so Marsh Creek Rd farm
  // venues (Farmer's Daughter Produce, 23151 Marsh Creek Rd — Census pins
  // 37.896) clear the southern edge (2026-W32).
  'Brentwood': { south: 37.88, west: -121.76, north: 37.98, east: -121.66 },
  'Antioch': { south: 37.95, west: -121.88, north: 38.03, east: -121.76 },
  'Concord': { south: 37.92, west: -122.09, north: 38.03, east: -121.93 },
  'Walnut Creek': { south: 37.86, west: -122.12, north: 37.97, east: -122.00 },
  'Lafayette': { south: 37.85, west: -122.18, north: 37.93, east: -122.07 },
  'Orinda': { south: 37.85, west: -122.23, north: 37.93, east: -122.14 },
  'Moraga': { south: 37.81, west: -122.18, north: 37.88, east: -122.08 },
  'Castro Valley': { south: 37.67, west: -122.12, north: 37.74, east: -122.02 },
  'San Leandro': { south: 37.69, west: -122.20, north: 37.74, east: -122.10 },
  'San Lorenzo': { south: 37.66, west: -122.16, north: 37.71, east: -122.10 },
  'Albany': { south: 37.86, west: -122.34, north: 37.91, east: -122.25 },
  'El Cerrito': { south: 37.90, west: -122.34, north: 37.94, east: -122.25 },
  'Richmond': { south: 37.90, west: -122.43, north: 37.98, east: -122.28 },
  'Vallejo': { south: 38.05, west: -122.29, north: 38.14, east: -122.14 },
  'Napa': { south: 38.25, west: -122.34, north: 38.34, east: -122.22 },
  'Sonoma': { south: 38.25, west: -122.52, north: 38.34, east: -122.40 },
  'Petaluma': { south: 38.20, west: -122.71, north: 38.30, east: -122.56 },
  // west extends past the Charles M. Schulz–Sonoma County Airport area (Pacific Coast Air Museum, 2230 Becker Blvd ≈ -122.801)
  'Santa Rosa': { south: 38.39, west: -122.83, north: 38.55, east: -122.60 },
  'Sebastopol': { south: 38.38, west: -122.86, north: 38.44, east: -122.77 },
  'San Rafael': { south: 37.95, west: -122.57, north: 38.03, east: -122.46 },
  'Mill Valley': { south: 37.87, west: -122.57, north: 37.95, east: -122.49 },
  // Sausalito buffered extra-generously to include Marine Mammal Center
  // at the Headlands' coastal edge (37.83, -122.535 — right at the bbox
  // border without the buffer).
  'Sausalito': { south: 37.81, west: -122.55, north: 37.88, east: -122.45 },
  'Tiburon': { south: 37.85, west: -122.49, north: 37.91, east: -122.41 },
  'Larkspur': { south: 37.92, west: -122.57, north: 37.98, east: -122.49 },
  'Corte Madera': { south: 37.90, west: -122.57, north: 37.95, east: -122.49 },
  // Novato south buffered to 38.03 (was 38.06) so the Hamilton Field
  // district (Hamilton pool 203 El Bonito Rd — Census pins 38.052) clears
  // the southern edge (2026-W32).
  'Novato': { south: 38.03, west: -122.64, north: 38.19, east: -122.49 },
  'Marin City': { south: 37.85, west: -122.53, north: 37.89, east: -122.47 },
  'Fairfax': { south: 37.96, west: -122.64, north: 38.01, east: -122.56 },
  'San Anselmo': { south: 37.93, west: -122.61, north: 38.00, east: -122.53 },
  'Belvedere': { south: 37.86, west: -122.49, north: 37.89, east: -122.45 },
  'Kentfield': { south: 37.94, west: -122.59, north: 37.97, east: -122.54 },
  'Greenbrae': { south: 37.94, west: -122.55, north: 37.96, east: -122.51 },
  'Muir Beach': { south: 37.85, west: -122.61, north: 37.88, east: -122.55 },
  'Stinson Beach': { south: 37.86, west: -122.66, north: 37.92, east: -122.59 },
  'Bolinas': { south: 37.88, west: -122.74, north: 37.94, east: -122.65 },
  'Inverness': { south: 38.05, west: -122.93, north: 38.18, east: -122.79 },
  'Point Reyes': { south: 38.04, west: -122.93, north: 38.17, east: -122.79 },
  'Santa Cruz': { south: 36.93, west: -122.12, north: 37.06, east: -121.94 },
  // Watsonville east buffered to -121.69 (was -121.72) so Santa Cruz
  // County Fairgrounds (-121.706 East Lake Ave) doesn't false-positive
  // at the eastern edge of the city limits. North buffered to 36.96
  // (was 36.95) so the same fairgrounds / Agricultural History Project
  // (2601 East Lake Ave, geocodes to 36.9511) clears the northern edge.
  'Watsonville': { south: 36.88, west: -121.81, north: 36.96, east: -121.69 },
  'Capitola': { south: 36.95, west: -121.99, north: 37.00, east: -121.93 },
  'Aptos': { south: 36.95, west: -121.96, north: 37.02, east: -121.86 },
  // Felton south buffered to 37.03 (was 37.04) so Roaring Camp Railroads
  // (37.040 Graham Hill Rd) doesn't false-positive at the southern edge.
  'Felton': { south: 37.03, west: -122.10, north: 37.10, east: -122.04 },
  'Ben Lomond': { south: 37.07, west: -122.11, north: 37.12, east: -122.04 },
  'Boulder Creek': { south: 37.10, west: -122.16, north: 37.16, east: -122.10 },
  'Gilroy': { south: 36.94, west: -121.64, north: 37.04, east: -121.49 }, // west widened for Gilroy Gardens / Hecker Pass (2026-W31)
  'Morgan Hill': { south: 37.06, west: -121.74, north: 37.18, east: -121.59 },
  'Saratoga': { south: 37.23, west: -122.07, north: 37.30, east: -121.97 },
  'Los Gatos': { south: 37.18, west: -122.00, north: 37.29, east: -121.92 },
  'Campbell': { south: 37.25, west: -121.99, north: 37.31, east: -121.91 },
  'Milpitas': { south: 37.40, west: -121.95, north: 37.50, east: -121.83 },
  'San Bruno': { south: 37.59, west: -122.49, north: 37.66, east: -122.39 },
  'Brisbane': { south: 37.66, west: -122.43, north: 37.70, east: -122.39 },
  'Pinole': { south: 37.99, west: -122.32, north: 38.04, east: -122.24 },
  'Hercules': { south: 37.99, west: -122.32, north: 38.04, east: -122.24 },
  // Martinez south buffered to 37.99 (was 38.00) so John Muir NHS
  // (37.998 Alhambra Ave) doesn't false-positive at the southern edge.
  'Martinez': { south: 37.99, west: -122.18, north: 38.06, east: -122.10 },
  'Pittsburg': { south: 38.00, west: -121.92, north: 38.07, east: -121.81 },
  'Discovery Bay': { south: 37.88, west: -121.62, north: 37.92, east: -121.55 },
  'San Pablo': { south: 37.95, west: -122.37, north: 37.99, east: -122.31 },
  'Stanford': { south: 37.40, west: -122.20, north: 37.45, east: -122.13 },
  'Menlo Park': { south: 37.42, west: -122.22, north: 37.50, east: -122.13 },
  'Pleasant Hill': { south: 37.93, west: -122.10, north: 38.00, east: -122.04 },
  'Atherton': { south: 37.44, west: -122.22, north: 37.48, east: -122.16 },
  'Portola Valley': { south: 37.36, west: -122.27, north: 37.41, east: -122.19 },
  // South widened 37.40 → 37.37 for the Skyline Blvd / Sky Londa corridor
  // (Kings Mountain Art Fair, 13889 Skyline Blvd — Nominatim-verified
  // 37.388, 2026-W32); west+north widened for Filoli estate (2026-W31).
  // West edge covers the Skyline Blvd corridor (Kings Mountain), which carries
  // Woodside mailing addresses despite sitting outside the town core.
  'Woodside': { south: 37.37, west: -122.34, north: 37.48, east: -122.21 },
  'Emeryville': { south: 37.82, west: -122.31, north: 37.85, east: -122.26 },
  'Piedmont': { south: 37.81, west: -122.25, north: 37.84, east: -122.20 },
  // south widened 2026-08-25: Colusa Circle (Kensington Farmers' Market) sits at
  // 37.89995 — the commercial strip straddles the El Cerrito line just below 37.90.
  'Kensington': { south: 37.895, west: -122.30, north: 37.92, east: -122.26 },
  'Rodeo': { south: 38.00, west: -122.28, north: 38.05, east: -122.23 },
  'Crockett': { south: 38.04, west: -122.24, north: 38.07, east: -122.19 },
  'Rohnert Park': { south: 38.31, west: -122.74, north: 38.37, east: -122.66 },
  'Cotati': { south: 38.31, west: -122.74, north: 38.34, east: -122.69 },
  'Healdsburg': { south: 38.59, west: -122.92, north: 38.65, east: -122.84 },
  // Point Reyes Station is the same peninsula community as 'Point Reyes'
  // above, just addressed with its full town name (2026-W18/W32/W33
  // extract rows use "Point Reyes Station, CA"). Reuses that bbox — both
  // real rows (A Day on the Ranch 38.1018,-122.7906; Drakes Beach
  // 38.068,-122.807, placeroot-verified town centroid 38.069,-122.807,
  // Marin County) already sit inside it (#192).
  'Point Reyes Station': { south: 38.04, west: -122.93, north: 38.17, east: -122.79 },
  // San Geronimo (issue #192 said "in table as key but verify" — it was
  // NOT present on main; adding now). Real rows: "Rainbow Playgroup",
  // 6350 Sir Francis Drake Blvd, San Geronimo, CA — 2026-W17.json
  // (38.0191,-122.6775) and 2026-W23.json (38.0046,-122.6871).
  // placeroot geocode centroid 38.0133,-122.6639 (Marin County); resolved
  // venue "San Geronimo Valley Community Center" at 38.0164,-122.6747.
  'San Geronimo': { south: 37.99, west: -122.72, north: 38.04, east: -122.64 },
  // Glen Ellen (Sonoma sub-town, issue #192's "several Sonoma sub-towns").
  // 11 real rows across weeks for Sonoma Botanical Garden, 12841 Hwy 12,
  // Glen Ellen, CA — lat 38.354-38.385, lng -122.547 to -122.510 (extract
  // geocoding noise across weeks). placeroot geocode centroid
  // 38.363987,-122.524353 (Sonoma County); resolved venue "Sonoma
  // Botanical Garden" at 38.375248,-122.511871, confirming the spread is
  // real geocode jitter, not a bad row.
  'Glen Ellen': { south: 38.33, west: -122.57, north: 38.40, east: -122.49 },
  // Davis (UC Davis) — outside the core Bay Area but a real recurring row:
  // "Black Family Day 2026 Fair at UC Davis Quad", 225 E Quad Ave, Davis,
  // CA — 2026-W18.json (38.5382,-121.7497) and 2026-W20.json
  // (38.5395,-121.7497). placeroot geocode centroid 38.543552,-121.739006
  // (Yolo County); resolved venue "UC Davis Craft Center" at
  // 38.538399,-121.753166, confirming the campus-west address is genuine.
  'Davis': { south: 38.51, west: -121.79, north: 38.58, east: -121.70 },
  // "Downtown Petaluma, CA 94952" (2026-W18.json, Petaluma Butter & Eggs
  // Parade) has no further ", Petaluma," suffix, so extractCityFromAddress
  // returns the literal "Downtown Petaluma" rather than stripping the
  // direction word (that stripping only applies with a leading comma,
  // e.g. ", downtown Petaluma, CA"). Alias it to the same bbox as
  // 'Petaluma' rather than changing the parsing regex.
  'Downtown Petaluma': { south: 38.20, west: -122.71, north: 38.30, east: -122.56 },
}

// Extract city name from a US-style address. Looks for "..., City, CA"
// (or "California") near the end. Returns null if no city pattern found.
//
// Handles common variations:
// - Trailing 5-digit ZIP: "City, CA 94022"
// - Trailing parenthetical: "City, CA (multiple routes)"
// - Direction prefix: "downtown City, CA", "north City, CA", etc.
//   (the directional word is dropped; just the city is returned)
export function extractCityFromAddress(address) {
  if (typeof address !== 'string' || !address.trim()) return null
  let trimmed = address.trim()
  // Strip trailing parenthetical: "...CA (multiple routes)" → "...CA"
  trimmed = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim()
  // Strip optional 5-digit ZIP: "City, CA 94022" → "City, CA"
  trimmed = trimmed.replace(/\s+\d{5}(?:-\d{4})?\s*$/, '').trim()
  // A "direction word" can be part of the real city name (South San
  // Francisco, West Sacramento). If the plain "City, CA" capture is itself
  // a known city, trust it BEFORE stripping any direction prefix — the
  // 2026-W31 batch had South San Francisco rows validated against SF's
  // bbox because "South" was treated as a direction.
  const plain = trimmed.match(/,\s*([A-Z][A-Za-zé\s.]+?)\s*,\s*(?:CA|California)\s*$/)
  if (plain && CITY_BBOXES[plain[1].trim()]) return plain[1].trim()
  // Direction prefix on city (lowercase variant): "downtown Antioch, CA"
  // Match the LAST occurrence of ", direction City, CA"
  const dirM = trimmed.match(/,\s*(?:downtown|uptown|north|south|east|west|central|old|new)\s+([A-Z][A-Za-zé\s.]+?)\s*,\s*(?:CA|California)\s*$/i)
  if (dirM) return dirM[1].trim()
  // Match the LAST "City, CA" before end (handles "Hwy A, San Mateo, CA")
  if (plain) return plain[1].trim()
  // Try "City, CA" at start (short addresses like "San Francisco, CA")
  const m2 = trimmed.match(/^([A-Z][A-Za-zé\s.]+?)\s*,\s*(?:CA|California)\s*$/)
  if (m2) return m2[1].trim()
  return null
}

// Returns the bbox the row is missing if (lat, lng) falls outside the
// city's bbox; null if it's inside, or city is unknown / unparseable.
// Pass-through (returns null) on uncertainty so the validator never
// false-positives on cities we don't know about.
export function coordOutsideCityBbox(address, lat, lng) {
  // Regional parks/preserves carry the mailing city of the nearest town but
  // legitimately sit outside its limits (Del Valle "Livermore", Round Valley
  // "Brentwood", Anthony Chabot "Castro Valley" — 2026-W31 batch). Skip the
  // check rather than reject correct park coordinates.
  if (/\bregional (?:park|preserve|shoreline|wilderness|recreation area)\b/i.test(String(address))) return null
  const city = extractCityFromAddress(address)
  if (!city) return null
  const bbox = CITY_BBOXES[city]
  if (!bbox) return null
  const inside = lat >= bbox.south && lat <= bbox.north &&
                 lng >= bbox.west && lng <= bbox.east
  return inside ? null : city
}
