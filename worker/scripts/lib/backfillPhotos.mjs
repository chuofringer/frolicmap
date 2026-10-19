/**
 * Pure helpers for the photo backfill (issue #299).
 *
 * Split out of `worker/scripts/backfill-photos.mjs` so the parsing/SQL logic
 * is unit-testable without touching the network, D1, or Overpass — same
 * split as `backfillAddresses.mjs`.
 *
 * LICENSE SCOPE (deliberately narrow — see the entry-point file header for
 * the full rationale): a candidate photo is only ever accepted from
 *
 *   1. an OSM `wikimedia_commons=File:*` tag, or
 *   2. an OSM `image=*` tag whose value resolves to a Wikimedia Commons file
 *      (either a `commons.wikimedia.org/wiki/File:*` page or a raw
 *      `upload.wikimedia.org/.../<filename>` URL) —
 *
 * every other `image=*` value (an arbitrary external host, a Flickr page, a
 * Commons `Category:` with no single representative file) is a SKIP, never a
 * best-effort guess. Attribution always comes from the Commons API's
 * `extmetadata`, never invented.
 */

import { esc } from './seedSql.mjs'

/**
 * Parse `osm-{type}-{id}` (the id shape `shared/osm.ts::overpassElementToItem`
 * assigns) back into its Overpass element reference. Returns null for any
 * other id shape (non-OSM source rows never match this pattern).
 */
export function parseOsmItemId(id) {
  const m = typeof id === 'string' ? id.match(/^osm-(node|way|relation)-(\d+)$/) : null
  if (!m) return null
  return { type: m[1], id: Number(m[2]) }
}

/**
 * Group parsed OSM element refs by type and build one Overpass QL query that
 * re-fetches their tags by id — the only way to get `image`/`wikimedia_commons`
 * back, since the ingested `items` row never stored the raw OSM tag bag.
 * Returns null for an empty input (nothing to query).
 */
export function buildOverpassTagsQuery(elements, timeoutSec = 180) {
  if (!elements.length) return null
  const byType = { node: [], way: [], relation: [] }
  for (const el of elements) byType[el.type]?.push(el.id)
  const clauses = Object.entries(byType)
    .filter(([, ids]) => ids.length > 0)
    .map(([type, ids]) => `  ${type}(id:${ids.join(',')});`)
  return `[out:json][timeout:${timeoutSec}];\n(\n${clauses.join('\n')}\n);\nout tags;`
}

const COMMONS_FILE_PAGE_RE = /^https?:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i
// e.g. https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Photo.jpg
const COMMONS_UPLOAD_RE = /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)$/i

/**
 * Decide whether an element's OSM tags name a Commons file, and which one.
 *
 * Returns `{ title, tagUsed }` (title is a `File:...` Commons page title) on
 * a usable candidate, `{ skip: reason }` when a tag exists but isn't
 * resolvable to one specific file (a `Category:` value, a non-Commons image
 * host), or `null` when neither tag is present at all.
 */
export function resolveCommonsTitle(tags) {
  if (!tags || typeof tags !== 'object') return null

  const wc = typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons.trim() : ''
  if (wc) {
    if (wc.startsWith('File:')) return { title: wc, tagUsed: 'wikimedia_commons' }
    if (wc.startsWith('Category:')) {
      return { skip: `wikimedia_commons is a Category ("${wc}"), not a File — ambiguous which photo, skipping` }
    }
    return { skip: `wikimedia_commons value "${wc}" is neither File: nor Category: — skipping` }
  }

  const image = typeof tags.image === 'string' ? tags.image.trim() : ''
  if (image) {
    const pageMatch = image.match(COMMONS_FILE_PAGE_RE)
    if (pageMatch) return { title: decodeURIComponent(pageMatch[1]), tagUsed: 'image' }
    const uploadMatch = image.match(COMMONS_UPLOAD_RE)
    if (uploadMatch) return { title: `File:${decodeURIComponent(uploadMatch[1])}`, tagUsed: 'image' }
    return { skip: `image tag "${image}" is not a Wikimedia Commons URL — not a license-safe source, skipping` }
  }

  return null
}

/** Commons API URL for one file's imageinfo (url + extmetadata). */
export function commonsImageInfoUrl(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    format: 'json',
    formatversion: '2',
  })
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`
}

/** Strip HTML tags and collapse whitespace — Commons' `Artist` field is a raw HTML fragment. */
export function stripHtml(html) {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse a Commons API `query.pages[0]` response into `{ url, attribution }`,
 * or null when the page is missing/a redlink or carries no usable imageinfo.
 *
 * `attribution` is always built from `extmetadata` — never fabricated when a
 * field is absent, the string just omits that part. Deliberately has no
 * "Photo:" label baked in: that's a translatable UI string the frontend
 * supplies (`detail.photoAttribution` in en/zh), while the artist name and
 * license code here are proper nouns / standard codes that don't get
 * translated either way.
 */
export function parseCommonsPage(page) {
  if (!page || page.missing || !Array.isArray(page.imageinfo) || !page.imageinfo[0]) return null
  const info = page.imageinfo[0]
  if (!info.url) return null

  const meta = info.extmetadata || {}
  const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : ''
  const license = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : ''

  let attribution
  if (artist && license) attribution = `${artist} / Wikimedia Commons (${license})`
  else if (artist) attribution = `${artist} / Wikimedia Commons`
  else if (license) attribution = `Wikimedia Commons (${license})`
  else attribution = 'Wikimedia Commons'

  return { url: info.url, attribution }
}

/**
 * One idempotent UPDATE for a single row's photo. Guarded on
 * `photo_url IS NULL` so applying a batch can never clobber a photo set in
 * the meantime (by a later run, or a curator) and a re-apply is a no-op.
 * Only `photo_url`, `photo_attribution`, and `updated_at` are ever written.
 */
export function buildPhotoUpdateStatement(id, photoUrl, attribution, updatedAtIso) {
  return (
    `UPDATE items SET photo_url=${esc(photoUrl)}, photo_attribution=${esc(attribution)}, ` +
    `updated_at=${esc(updatedAtIso)} WHERE id=${esc(id)} AND photo_url IS NULL;`
  )
}

/** True for a `Content-Type` header value that names an image (verification gate). */
export function isImageContentType(contentType) {
  return typeof contentType === 'string' && /^image\//i.test(contentType.trim())
}

/**
 * Guard against ever emitting a write for a row this job shouldn't touch:
 * every row must be `source_type='osm'` with a `photo_url` already null.
 * Mirrors `assertInputRows` in `backfillAddresses.mjs`.
 */
export function assertInputRows(rows) {
  if (!Array.isArray(rows)) throw new Error('input must be an array of rows')
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error(`invalid row: ${JSON.stringify(row)}`)
    if (row.id === undefined || row.id === null || row.id === '') {
      throw new Error(`row missing id: ${JSON.stringify(row)}`)
    }
    if (row.source_type !== 'osm') {
      throw new Error(`row ${row.id} has source_type '${row.source_type}' — this job is OSM-tag-only`)
    }
    if (row.photo_url != null && row.photo_url !== '') {
      throw new Error(`row ${row.id} already has a photo_url — refusing to overwrite`)
    }
  }
  return rows
}

/**
 * Parse `items.attributes` looking for the `photo_candidate` the ingest path
 * (`shared/osm.ts::resolvePhotoCandidateFromTags`) may have stashed there.
 * When present, the row already carries a resolved Commons title — this
 * script can skip re-querying Overpass for it entirely and go straight to
 * the Commons lookup/verification step, same as a candidate resolved from a
 * freshly-fetched Overpass tag.
 *
 * `attributesJson` may be the raw TEXT column value (a JSON string), an
 * already-parsed object (the D1 JSON export shape can go either way), or
 * absent. Never throws — a malformed or unrelated `attributes` blob (other
 * importers write other keys there) is just "no candidate", not an error.
 */
export function parseAttributesPhotoCandidate(attributesJson) {
  if (attributesJson == null || attributesJson === '') return null
  let obj
  if (typeof attributesJson === 'string') {
    try { obj = JSON.parse(attributesJson) } catch { return null }
  } else if (typeof attributesJson === 'object') {
    obj = attributesJson
  } else {
    return null
  }
  const cand = obj?.photo_candidate
  if (!cand || cand.kind !== 'commons' || typeof cand.title !== 'string' || !cand.title.startsWith('File:')) {
    return null
  }
  return { title: cand.title, tagUsed: 'attributes' }
}

/** Split an array into fixed-size chunks (last chunk may be shorter). */
export function chunk(arr, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`)
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
