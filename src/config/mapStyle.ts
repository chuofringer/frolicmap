import { i18next } from '@/i18n'
import type { StyleSpecification } from 'maplibre-gl'

export type BasemapId = 'light' | 'dark' | 'street' | 'liberty' | 'satellite'

export interface BasemapConfig {
  id: BasemapId
  style: string | StyleSpecification
  theme: 'light' | 'dark'
  /** Supports tilt → 3D building extrusion */
  supports3D?: boolean
}

/**
 * Free and open providers only, no API keys: OpenFreeMap (OpenMapTiles schema,
 * data © OpenStreetMap contributors) for the four vector styles and USGS The
 * National Map (US public domain) for imagery. Never add a keyed provider.
 * Details, licences and self-host options: docs/basemaps.md.
 */
export const DEFAULT_BASEMAP_ID: BasemapId = 'light'

/** USGS The National Map imagery, raster XYZ in {z}/{y}/{x} order. */
export const USGS_IMAGERY_TILES =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'

export const BASEMAPS: BasemapConfig[] = [
  {
    id: 'light',
    theme: 'light',
    style: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'dark',
    theme: 'dark',
    style: 'https://tiles.openfreemap.org/styles/dark',
  },
  {
    id: 'street',
    theme: 'light',
    style: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'liberty',
    theme: 'light',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    supports3D: true,
  },
  {
    id: 'satellite',
    theme: 'dark',
    style: {
      version: 8,
      sources: {
        usgs: {
          type: 'raster',
          tiles: [USGS_IMAGERY_TILES],
          tileSize: 256,
          maxzoom: 16,
          attribution:
            'Imagery: <a href="https://www.usgs.gov/" target="_blank" rel="noopener noreferrer">USGS The National Map</a>, public domain',
        },
      },
      layers: [
        { id: 'usgs-imagery', type: 'raster', source: 'usgs', minzoom: 0, maxzoom: 22 },
      ],
    } satisfies StyleSpecification,
  },
]

const byId = new Map<string, BasemapConfig>(BASEMAPS.map((b) => [b.id, b]))

export function isBasemapId(value: unknown): value is BasemapId {
  return typeof value === 'string' && byId.has(value)
}

/**
 * Resolve any stored/untrusted id to a configured basemap. An unknown or retired
 * id (e.g. an old value in localStorage) falls back to the default with a single
 * console.warn per distinct bad id; it never throws, so the map never renders blank.
 */
const warned = new Set<string>()
export function resolveBasemapId(id: unknown): BasemapId {
  if (isBasemapId(id)) return id
  const key = String(id)
  if (!warned.has(key)) {
    warned.add(key)
    console.warn(`Unknown basemap "${key}"; falling back to "${DEFAULT_BASEMAP_ID}".`)
  }
  return DEFAULT_BASEMAP_ID
}

function configFor(id: unknown): BasemapConfig {
  return byId.get(resolveBasemapId(id))!
}

export function getBasemapStyle(id: BasemapId | string): string | StyleSpecification {
  return configFor(id).style
}
export function basemapSupports3D(id: BasemapId | string): boolean {
  return configFor(id).supports3D ?? false
}
export function getBasemapTheme(id: BasemapId | string): 'light' | 'dark' {
  return configFor(id).theme
}

/**
 * The basemap's display name in the active locale.
 *
 * Not a `label` field on the config above: these are copy, and a Chinese menu
 * heading over five English options is exactly the silent-English-inside-a-
 * Chinese-UI failure the locale type guard exists to prevent. Dropping the
 * field makes the compiler find every render site.
 *
 * "Liberty" stays untranslated in every locale — it is the style's brand name.
 */
export function basemapLabel(id: BasemapId): string {
  return i18next.t(`map.basemaps.${id}`)
}
