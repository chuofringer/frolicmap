/**
 * Pure helpers for the one-off funradar → frolicmap importer
 * (`worker/scripts/import-funradar.mjs`).
 *
 * The owner's older funradar D1 database holds place rows from several kinds of
 * source. Only rows that came from the four open datasets frolicmap already
 * ships (OSM, IMLS, ParkServe, NPS) may be carried over: scraped, ics-*,
 * bibliocommons, manual and LLM-derived rows carry licences or terms that do
 * not allow redistribution here. That allowlist lives in `normalizeFunradarRow`
 * and is the licence boundary; the tests pin it.
 *
 * No I/O in this module.
 */

import {
  IMPORT_COLUMNS, D1_MAX_STATEMENT_BYTES, esc, num, rowValues,
} from './seedSql.mjs'

/** Open-data sources whose rows may be imported. */
export const FUNRADAR_SOURCE_TYPES = ['osm', 'imls', 'parkserve', 'nps']

/** Mirrors the CHECK constraints in worker/migrations/0001_init.sql. */
export const ALLOWED_CATEGORIES = [
  'playground', 'park', 'library', 'museum', 'aquarium', 'zoo', 'beach',
  'waterplay', 'hiking', 'campground',
]
const ALLOWED_CONFIDENCE = ['high', 'medium', 'low']
const ALLOWED_COST = ['free', 'paid']

/** Columns frolicmap's items table has beyond the shared IMPORT_COLUMNS. */
export const EXTRA_COLUMNS = ['name_zh', 'photo_attribution', 'has_playground']
export const FUNRADAR_COLUMNS = [...IMPORT_COLUMNS, ...EXTRA_COLUMNS]

/**
 * Accept the JSON wrangler writes (`[{ results: [...], success, meta }]`), a
 * bare array of rows, or a single `{ results: [...] }` object.
 */
export function loadRows(json) {
  if (Array.isArray(json)) {
    const looksLikeEnvelope = json.length > 0 && json.every(
      (e) => e && typeof e === 'object' && Array.isArray(e.results),
    )
    return looksLikeEnvelope ? json.flatMap((e) => e.results) : json
  }
  if (json && typeof json === 'object' && Array.isArray(json.results)) return json.results
  throw new Error('unrecognised JSON: expected a wrangler envelope or an array of rows')
}

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const int = (v) => {
  const n = finite(v)
  return n === null ? null : Math.trunc(n)
}

const bit = (v) => {
  if (v === 1 || v === true || v === '1' || v === 'true') return 1
  if (v === 0 || v === false || v === '0' || v === 'false') return 0
  return null
}

function parseAttributes(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    if (v.trim() === '') return null
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  return typeof v === 'object' ? v : null
}

function inBbox(b, lat, lng) {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east
}

/**
 * Map one funradar row to a frolicmap items row, or say why it was skipped.
 *
 * @param row     a row object as exported from funradar's `items` table
 * @param options `bbox` ({south,west,north,east}) skips rows outside it;
 *                `allowedCategories` / `allowedSourceTypes` override the defaults;
 *                `now` (ISO string) is the fallback timestamp (tests).
 * @returns `{ row }` or `{ skip: reason }`
 */
export function normalizeFunradarRow(row, {
  allowedCategories = ALLOWED_CATEGORIES,
  allowedSourceTypes = FUNRADAR_SOURCE_TYPES,
  bbox = null,
  now = new Date().toISOString(),
} = {}) {
  if (!row || typeof row !== 'object') return { skip: 'type' }

  // Licence boundary first, so a skipped row is always reported for its real reason.
  if (row.type !== 'place') return { skip: 'type' }
  if (row.status !== 'approved') return { skip: 'status' }
  if (!allowedSourceTypes.includes(row.source_type)) return { skip: 'source_type' }
  if (!allowedCategories.includes(row.category)) return { skip: 'category' }

  const { lat, lng } = row
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { skip: 'coords' }
  }
  if (bbox && !inBbox(bbox, lat, lng)) return { skip: 'bbox' }

  // NOT NULL columns in 0001_init.sql.
  const id = str(row.id)
  const name = str(row.name)
  const sourceUrl = str(row.source_url)
  const region = str(row.region)
  if (!id) return { skip: 'id' }
  if (!name) return { skip: 'name' }
  if (!sourceUrl) return { skip: 'source_url' }
  if (!region) return { skip: 'region' }

  const date = now.slice(0, 10)
  return {
    row: {
      id,
      type: 'place',
      name,
      name_zh: str(row.name_zh),
      description: str(row.description),
      category: row.category,
      lat,
      lng,
      address: str(row.address),
      age_min: int(row.age_min),
      age_max: int(row.age_max),
      cost: ALLOWED_COST.includes(row.cost) ? row.cost : null,
      price_usd: finite(row.price_usd),
      indoor: bit(row.indoor),
      opening_hours: str(row.opening_hours),
      photo_url: str(row.photo_url),
      photo_attribution: str(row.photo_attribution),
      website: str(row.website),
      source_url: sourceUrl,
      source_type: row.source_type,
      confidence: ALLOWED_CONFIDENCE.includes(row.confidence) ? row.confidence : 'medium',
      status: 'approved',
      last_verified: str(row.last_verified) ?? date,
      created_at: str(row.created_at) ?? now,
      updated_at: str(row.updated_at) ?? now,
      region,
      city: str(row.city),
      attributes: parseAttributes(row.attributes),
      slug: str(row.slug),
      has_playground: bit(row.has_playground),
    },
  }
}

/** seedSql's 27 values plus name_zh, photo_attribution, has_playground, in FUNRADAR_COLUMNS order. */
export function funradarRowValues(r) {
  return [rowValues(r), esc(r.name_zh), esc(r.photo_attribution), num(r.has_playground)].join(',')
}

/**
 * Chunked INSERT…ON CONFLICT statements for FUNRADAR_COLUMNS, each under
 * `maxBytes`. seedSql's `buildImportSql` fixes its VALUES tuple to the 27
 * shared columns, so the three extra columns need this small local twin.
 */
export function buildFunradarSql(rows, { headerLines = [], setClause, maxBytes = 80_000 } = {}) {
  const byteLen = (s) => Buffer.byteLength(s, 'utf8')
  const prefix = `INSERT INTO items (${FUNRADAR_COLUMNS.join(',')}) VALUES\n`
  const suffix = `\nON CONFLICT(id) DO UPDATE SET ${setClause};`
  const overhead = byteLen(prefix) + byteLen(suffix)

  const out = [...headerLines, '']
  let batch = []
  let batchBytes = overhead
  const flush = () => {
    if (!batch.length) return
    out.push(prefix + batch.join(',\n') + suffix, '')
    batch = []
    batchBytes = overhead
  }
  for (const r of rows) {
    const line = `  (${funradarRowValues(r)})`
    const lineBytes = byteLen(line) + 2
    if (batch.length && batchBytes + lineBytes > maxBytes) flush()
    batch.push(line)
    batchBytes += lineBytes
  }
  flush()
  return out.join('\n')
}

export { D1_MAX_STATEMENT_BYTES }
