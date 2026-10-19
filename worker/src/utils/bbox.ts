import { DEFAULT_REGION, getMetro, inMetroBbox, overpassBboxFor, type Metro } from '@shared/metros'

/**
 * Bay Area geographic helpers.
 *
 * The numbers used to live here (and in a second copy at
 * `src/config/constants.ts`). Both collapsed into `shared/metros.ts` with
 * #351 — one registry, 50 metros, no hand-synced duplicates. This module
 * stays as the Bay-Area-shaped façade its existing callers expect
 * (`ingest/osm.ts`, the structured-feed ingesters); national callers take a
 * `Metro` and use the registry helpers directly.
 */

function bayArea(): Metro {
  const m = getMetro(DEFAULT_REGION)
  // Unreachable in practice — the registry always carries the Bay Area, and
  // the metros test asserts it. Throwing beats a non-null assertion because
  // a registry edit that dropped `bay` would otherwise surface as a
  // confusing undefined-property crash deep inside an ingest run.
  if (!m) throw new Error(`metro registry is missing the default region '${DEFAULT_REGION}'`)
  return m
}

export const CONTENT_BBOX = bayArea().contentBbox

/** Overpass `(south,west,north,east)` string for the Bay Area. */
export function overpassBbox(): string {
  return overpassBboxFor(bayArea())
}

/** Whether a coordinate falls inside the Bay Area ingestion bounds. */
export function inContentBbox(lat: number, lng: number): boolean {
  return inMetroBbox(bayArea(), lat, lng)
}
