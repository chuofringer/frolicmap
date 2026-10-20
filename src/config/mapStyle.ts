import { i18next } from '@/i18n'
import type { StyleSpecification } from 'maplibre-gl'
import { SATELLITE_OVERLAY_LAYERS } from './satelliteOverlay'

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
 * National Map (US public domain) for imagery, with OpenFreeMap place/road
 * labels on top (satellite hybrid). The `dark` id uses OpenFreeMap's `fiord`
 * style (the stock `dark` style is near-black and hides the pins). Never add a
 * keyed provider.
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
    style: 'https://tiles.openfreemap.org/styles/fiord',
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
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
      sources: {
        usgs: {
          type: 'raster',
          tiles: [USGS_IMAGERY_TILES],
          tileSize: 256,
          maxzoom: 16,
          attribution:
            'Imagery: <a href="https://www.usgs.gov/" target="_blank" rel="noopener noreferrer">USGS The National Map</a>, public domain',
        },
        // Vector tiles for the label/road overlay only (no basemap fills).
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
          attribution:
            '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        },
      },
      layers: [
        // USGS imagery covers US land only; tiles elsewhere (open ocean, outside the
        // US) are fully transparent. This deep-water colour makes those gaps read as
        // sea instead of a black hole. The overlay's water mask (satelliteOverlay.ts)
        // uses the same colour so masked water and empty tiles match.
        { id: 'background', type: 'background', paint: { 'background-color': '#1b3a5c' } },
        { id: 'usgs-imagery', type: 'raster', source: 'usgs', minzoom: 0, maxzoom: 22 },
        ...SATELLITE_OVERLAY_LAYERS,
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
