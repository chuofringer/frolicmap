/**
 * ParkServe (Trust for Public Land) mapping logic — issue #354, plan §2.1 row 4.
 *
 * Pure: no filesystem, no network, no `shared/*` imports. The metro lookup is
 * injected, same pattern as `lib/imls.mjs`.
 *
 * Field names are read from the live ArcGIS FeatureServer's own schema
 * endpoint, not guessed:
 *   https://services9.arcgis.com/90v9hhDSTUTen7c9/arcgis/rest/services/Parks_Project_web/FeatureServer/0?f=json
 *
 * Note the truncated names — the service ships 10-character shapefile-era
 * field names (`Park_Acces`, `Park_Statu`, `Park_Addre`, `Park_Count`), not
 * the spelled-out forms the documentation prose uses.
 */

export const PS_FIELDS = {
  id: 'ParkID',
  name: 'Park_Name',
  designation: 'Park_Desig',
  owner: 'Park_Owner',
  access: 'Park_Acces',
  status: 'Park_Statu',
  acres: 'Park_Size_',
  address: 'Park_Addre',
  city: 'Park_Place',
  county: 'Park_Count',
  zip: 'Park_Zip',
}

/** The subset of fields worth requesting — keeps the response small. */
export const PS_OUT_FIELDS = Object.values(PS_FIELDS).join(',')

/**
 * "Open Access" — the only access value that means a family can walk in.
 *
 * From the ParkServe documentation: *"Access is set to '3 – Open Access'"* for
 * parks in the public inventory, and rows with *"'Access' field values other
 * than 3 … only remain in the database"* for legacy reasons. Austin bears this
 * out: 1,047 of 1,064 parks are access=3.
 */
export const PS_OPEN_ACCESS = 3

/** Statuses that mean the park is visitable. `Closed` is excluded. */
export const PS_VISITABLE_STATUS = new Set(['Open', 'OpenFee'])

/**
 * The ArcGIS `where` clause. Filtering server-side rather than client-side
 * matters at national scale: it's the difference between paging through every
 * park in America and paging through the visitable ones.
 */
export const PS_WHERE = `${PS_FIELDS.access}=${PS_OPEN_ACCESS} AND ${PS_FIELDS.status} IN ('Open','OpenFee')`

/**
 * ParkServe ids are free-text and appear in our primary key, so normalise
 * them to the same shape as the OSM/IMLS ids: lowercase, alphanumerics and
 * dashes only.
 */
export function parkserveId(rawId) {
  const slug = String(rawId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `parkserve-${slug}` : null
}

function clean(v) {
  if (v == null) return null
  // Collapse embedded newlines/tabs: ParkServe ships names like
  // "Sullivan Oval Park And Playground\n\nPark", which break SQL comments,
  // page titles and JSON-LD downstream.
  const s = String(v).replace(/\s+/g, ' ').trim()
  // The service uses a single space for "no value" in several columns
  // (Park_Desig, Park_Owner both show ' ' in the Austin sample).
  return s && s !== ' ' ? s : null
}

function titleCase(s) {
  if (!s || s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase())
}

/**
 * Build the `attributes` JSON for a park.
 *
 * Plan §2.1 row 4 scopes ParkServe to "centroids + amenity flags only — no
 * polygons". These are the flags the parks layer actually carries. The
 * official playground/trail layers live in the ZIP download rather than this
 * feature service, so a `playground` flag can be grafted on later without
 * touching row identity — that's why this is a JSON blob and not columns.
 */
function buildAttributes(a) {
  const acres = Number(a[PS_FIELDS.acres])
  const attrs = {}
  if (Number.isFinite(acres) && acres > 0) attrs.acres = Math.round(acres * 100) / 100
  const desig = clean(a[PS_FIELDS.designation])
  if (desig) attrs.designation = desig
  const owner = clean(a[PS_FIELDS.owner])
  if (owner && owner !== 'UNKNOWN') attrs.owner = owner
  return Object.keys(attrs).length ? attrs : null
}

/**
 * Map one ArcGIS feature to an Item, or `{ skipped }` with the reason.
 *
 * `feature` is the raw `{attributes, centroid}` shape the REST API returns
 * with `returnCentroid=true&returnGeometry=false`.
 */
export function parkserveFeatureToItem(feature, metroFor, { status, confidence }) {
  const a = feature?.attributes ?? {}
  const name = titleCase(clean(a[PS_FIELDS.name]))
  if (!name) return { skipped: 'no name' }

  const id = parkserveId(a[PS_FIELDS.id])
  if (!id) return { skipped: 'no ParkID' }

  // Server-side `where` should have handled these, but a caller can override
  // the clause — re-checking here keeps the mapping honest on its own terms.
  if (Number(a[PS_FIELDS.access]) !== PS_OPEN_ACCESS) return { skipped: `access ${a[PS_FIELDS.access]}` }
  const psStatus = clean(a[PS_FIELDS.status])
  if (!PS_VISITABLE_STATUS.has(psStatus)) return { skipped: `status ${psStatus ?? '(blank)'}` }

  const c = feature?.centroid
  const lat = Number(c?.y)
  const lng = Number(c?.x)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return { skipped: 'no centroid' }
  }
  // Web Mercator leaks through when the caller forgets `outSR=4326`. Latitude
  // can't exceed 90, so this catches it loudly instead of writing millions of
  // metres into a lat column.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { skipped: 'centroid not in WGS84 (missing outSR=4326?)' }
  }

  const metro = metroFor(lat, lng)
  if (!metro) return { skipped: 'outside every metro bbox' }

  const city = titleCase(clean(a[PS_FIELDS.city]))
  const addressParts = [clean(a[PS_FIELDS.address]), city, clean(a[PS_FIELDS.zip])].filter(Boolean)
  const now = new Date().toISOString()

  return {
    row: {
      id,
      type: 'place',
      name,
      description: null,
      category: 'park',
      lat,
      lng,
      address: addressParts.length ? addressParts.join(', ') : null,
      age_min: null,
      age_max: null,
      // OpenFee is ParkServe's "open to the public, entry fee applies".
      cost: psStatus === 'OpenFee' ? 'paid' : 'free',
      price_usd: null,
      indoor: 0,
      opening_hours: null,
      photo_url: null,
      website: null,
      source_url: 'https://www.tpl.org/parkserve',
      source_type: 'parkserve',
      confidence,
      status,
      last_verified: now,
      created_at: now,
      updated_at: now,
      region: metro.id,
      city,
      attributes: buildAttributes(a),
      slug: null,
    },
  }
}
