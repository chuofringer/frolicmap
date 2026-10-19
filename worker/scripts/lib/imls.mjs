/**
 * IMLS importers — shared mapping logic (issue #353, plan §2.1 rows 2–3).
 *
 * Pure: no filesystem, no network, no `shared/*` imports. The metro lookup is
 * injected so this module can be unit-tested in the Worker test pool and
 * reused by the two `.mjs` seed scripts without either taking on the other's
 * module-resolution constraints.
 *
 * Column names below are transcribed from the official IMLS record layouts,
 * not guessed:
 *   - Libraries: "Public Libraries Survey Fiscal Year 2023: Data File
 *     Documentation", Appendix B — Record Layout for Public Library Outlet
 *     Data File, FY 2023 (`PLS_FY23_Outlet_pud23i`, 17,586 records, 37 fields).
 *   - Museums: "Museum Data Files, August 2018", Appendix B — Data Elements.
 *
 * Note the two files spell longitude differently — PLS truncates to
 * `LONGITUD` (12 chars), MDF uses the full `LONGITUDE`. Reading one layout and
 * assuming the other would silently drop every coordinate.
 */

import { buildImportSql } from './seedSql.mjs'


// ── Libraries: PLS FY2023 outlet file ────────────────────────────────────

export const PLS_COLUMNS = {
  fscskey: 'FSCSKEY',
  seq: 'FSCS_SEQ',
  name: 'LIBNAME',
  address: 'ADDRESS',
  city: 'CITY',
  state: 'STABR',
  zip: 'ZIP',
  phone: 'PHONE',
  outletType: 'C_OUT_TY',
  lat: 'LATITUDE',
  lng: 'LONGITUD',
}

/**
 * Outlet types worth a map pin.
 *
 * CE = Central Library, BR = Branch Library — both are buildings a parent can
 * drive to. BS (Bookmobile) and BM (Books-by-Mail Only) are deliberately
 * excluded: a bookmobile's coordinate is its garage, and books-by-mail has no
 * visitable location at all. Mapping either would put a pin where no family
 * can show up.
 */
export const PLS_VISITABLE_OUTLET_TYPES = new Set(['CE', 'BR'])

// ── Museums: MDF 2018 ────────────────────────────────────────────────────

export const MDF_COLUMNS = {
  id: 'MID',
  // The published 2018 CSVs are inconsistent WITHIN the same release:
  // File1/File3 head this column 'DISCIPL', File2 heads it 'DISCIPLINE'.
  // Verified against the real 2018_csv_museum_data_files.zip, 2026-07-19.
  // An array means "any of these headers satisfies the column".
  discipline: ['DISCIPL', 'DISCIPLINE'],
  name: 'COMMONNAME',
  legalName: 'LEGALNAME',
  street: 'PHSTREET',
  city: 'PHCITY',
  state: 'PHSTATE',
  zip: 'PHZIP',
  phone: 'PHONE',
  website: 'WEBURL',
  lat: 'LATITUDE',
  lng: 'LONGITUDE',
}

/**
 * Child-relevant museum disciplines → our category vocabulary (plan §2.1.3).
 *
 * Included:
 *   CMU children's museums, SCI science/technology/planetariums,
 *   NAT natural history/natural science  → `museum`
 *   ZAW zoos, aquariums, wildlife        → `aquarium` (our combined zoo/aquarium bucket)
 *   BOT arboretums, botanical gardens,
 *       nature centers                   → `park` (outdoor destination, not an indoor exhibit hall)
 *
 * Excluded by design: ART (art museums), HST (history museums), GMU
 * (uncategorized/general), HSC (historical societies / historic
 * preservation). These are the plan's "child-relevant disciplines" filter —
 * they're not kid destinations by default, and including ~20K of them would
 * bury the ones that are.
 */
export const MDF_CATEGORY_BY_DISCIPLINE = {
  CMU: 'museum',
  SCI: 'museum',
  NAT: 'museum',
  ZAW: 'aquarium',
  BOT: 'park',
}

// ── Shared helpers ───────────────────────────────────────────────────────

/**
 * Verify every required column is present, and throw with the ACTUAL header
 * list when one isn't.
 *
 * IMLS renames columns between survey years (and the museum file is a
 * different vintage entirely). Without this check a renamed column would read
 * as `undefined` for all 17K rows and the importer would cheerfully emit
 * 17,586 rows of NULL — the failure mode this whole guard exists to prevent.
 */
export function assertColumns(headers, columnMap, fileLabel) {
  const present = new Set(headers)
  // An array value is an any-of alias list (IMLS headers drift even between
  // files of one release); a plain string must match exactly.
  const missing = Object.values(columnMap)
    .filter((c) => (Array.isArray(c) ? !c.some((alt) => present.has(alt)) : !present.has(c)))
    .map((c) => (Array.isArray(c) ? c.join('|') : c))
  if (missing.length) {
    throw new Error(
      `${fileLabel}: missing expected column(s): ${missing.join(', ')}\n` +
      `Columns actually present (${headers.length}): ${headers.join(', ')}\n` +
      `IMLS renames fields between survey years — check the record layout for the year you downloaded.`,
    )
  }
}

/**
 * IMLS uses negative sentinels (-1 missing, -3 temporarily closed, -4 not
 * applicable) in numeric fields. A raw parse would treat "-3" as a real
 * phone number or a coordinate in the Atlantic.
 */
export function cleanSentinel(value) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || s === 'M') return null
  if (/^-[134]$/.test(s)) return null
  return s
}

export function parseCoord(value) {
  const s = cleanSentinel(value)
  if (s === null) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n === 0) return null
  return n
}

function titleCase(s) {
  // IMLS ships institution names in ALL CAPS in some vintages. Rendering
  // "DALLAS PUBLIC LIBRARY" on a map card shouts; title-casing reads as a
  // name. Left alone when the source already has mixed case.
  if (!s || s !== s.toUpperCase()) return s
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    // Keep short joining words lowercase except at the start.
    .replace(/\b(Of|The|And|At|For|In|On)\b/g, (m, _w, off) => (off === 0 ? m : m.toLowerCase()))
}

/**
 * Join address parts, title-casing the city component.
 *
 * IMLS ships the city in ALL CAPS in the address fields. The popup renders
 * `address`, so leaving it raw gives '800 Guadalupe St, AUSTIN, TX' — a line
 * that half-shouts next to the title-cased `city` column.
 */
function joinAddress(parts, cityIndex = -1) {
  const out = parts
    .map((p, i) => {
      const v = cleanSentinel(p)
      return v && i === cityIndex ? titleCase(v) : v
    })
    .filter(Boolean)
  return out.length ? out.join(', ') : null
}

/**
 * Turn a bare host into a URL, or drop it.
 *
 * The MDF `WEBURL` column carries junk in places — a bare `0` survives
 * `cleanSentinel` and would become `https://0`, a live-looking link on a
 * place card that goes nowhere. Requires something host-shaped (a dot with
 * characters either side) before prepending a scheme.
 */
export function normalizeWebsite(raw) {
  const s = cleanSentinel(raw)
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (!/^[^\s.]+\.[^\s.]{2,}/.test(s)) return null
  return `https://${s}`
}

function formatPhone(raw) {
  const s = cleanSentinel(raw)
  if (!s) return null
  const digits = s.replace(/\D/g, '')
  if (digits.length !== 10) return null
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Build one Item-shaped row, or return a `{ skipped: reason }` marker so the
 * caller can report *why* rows were dropped rather than just how many.
 */
function buildRow(
  { id, name, category, lat, lng, address, city, phone, website, sourceUrl, description, status, confidence },
  metroFor,
) {
  if (!name) return { skipped: 'no name' }
  if (lat === null || lng === null) return { skipped: 'no coordinates' }

  const metro = metroFor(lat, lng)
  // Plan §1.1: rows outside every metro bbox are deferred, not ingested.
  // Roughly two-thirds of the national IMLS corpus is rural and lands here.
  if (!metro) return { skipped: 'outside every metro bbox' }

  const now = new Date().toISOString()
  return {
    row: {
      id,
      type: 'place',
      name,
      description: description ?? null,
      category,
      lat,
      lng,
      address,
      age_min: null,
      age_max: null,
      cost: null,
      price_usd: null,
      indoor: category === 'park' ? 0 : 1,
      opening_hours: null,
      photo_url: null,
      website: website ?? null,
      source_url: sourceUrl,
      source_type: 'imls',
      confidence,
      status,
      last_verified: now,
      created_at: now,
      updated_at: now,
      region: metro.id,
      city: city ?? null,
      attributes: phone ? { phone } : null,
      slug: null,
    },
  }
}

export function libraryRowToItem(rec, metroFor, { status, confidence }) {
  const C = PLS_COLUMNS
  const outletType = (rec[C.outletType] ?? '').trim().toUpperCase()
  if (!PLS_VISITABLE_OUTLET_TYPES.has(outletType)) {
    return { skipped: `outlet type ${outletType || '(blank)'}` }
  }
  const fscskey = (rec[C.fscskey] ?? '').trim()
  const seq = (rec[C.seq] ?? '').trim()
  if (!fscskey || !seq) return { skipped: 'no FSCSKEY/FSCS_SEQ' }

  return buildRow({
    // Stable source-native id per plan §2.2 — FSCSKEY alone is the
    // parent entity, so the outlet suffix is required for uniqueness.
    id: `imls-lib-${fscskey}-${seq}`.toLowerCase(),
    name: titleCase(cleanSentinel(rec[C.name])),
    category: 'library',
    lat: parseCoord(rec[C.lat]),
    lng: parseCoord(rec[C.lng]),
    address: joinAddress([rec[C.address], rec[C.city], rec[C.state], rec[C.zip]], 1),
    city: titleCase(cleanSentinel(rec[C.city])),
    phone: formatPhone(rec[C.phone]),
    website: null, // The PLS outlet file carries no per-outlet URL.
    sourceUrl: 'https://www.imls.gov/research-evaluation/surveys/public-libraries-survey-pls',
    status,
    confidence,
  }, metroFor)
}

export function museumRowToItem(rec, metroFor, { status, confidence, vintageNote }) {
  const C = MDF_COLUMNS
  const disciplineRaw = C.discipline.map((h) => rec[h]).find((v) => v != null) ?? ''
  const discipline = disciplineRaw.trim().toUpperCase()
  const category = MDF_CATEGORY_BY_DISCIPLINE[discipline]
  if (!category) return { skipped: `discipline ${discipline || '(blank)'}` }

  const mid = (rec[C.id] ?? '').trim()
  if (!mid) return { skipped: 'no MID' }

  const name = titleCase(cleanSentinel(rec[C.name]) ?? cleanSentinel(rec[C.legalName]))
  const website = cleanSentinel(rec[C.website])

  return buildRow({
    id: `imls-mus-${mid}`.toLowerCase(),
    name,
    category,
    lat: parseCoord(rec[C.lat]),
    lng: parseCoord(rec[C.lng]),
    address: joinAddress([rec[C.street], rec[C.city], rec[C.state], rec[C.zip]], 1),
    city: titleCase(cleanSentinel(rec[C.city])),
    phone: formatPhone(rec[C.phone]),
    website: normalizeWebsite(website),
    sourceUrl: 'https://www.imls.gov/research-evaluation/data/museum-data-files',
    // The staleness is recorded on the row itself, not just in the PR that
    // created it — whoever reads this row later needs to know the
    // record is from a retired dataset.
    description: vintageNote ?? null,
    status,
    confidence,
  }, metroFor)
}

// ── SQL emission ─────────────────────────────────────────────────────────
//
// Escaping, the column list, the UPSERT SET clause and byte-budgeted chunking
// all live in `lib/seedSql.mjs`, shared with the OSM bootstrap (#352). That
// module is where the `approved`-preservation fix lives: without it, a museum
// re-import (whose `excluded.status` is `pending`) silently demoted every row
// the curator had approved.

export function buildSeedSql(rows, headerLines) {
  return buildImportSql(rows, { headerLines })
}

/** Fold `{row}` / `{skipped}` results into rows plus a reason histogram. */
export function collect(results) {
  const rows = []
  const skipped = {}
  for (const r of results) {
    if (r.row) rows.push(r.row)
    else skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1
  }
  return { rows, skipped }
}
