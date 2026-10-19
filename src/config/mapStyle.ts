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

export const BASEMAPS: BasemapConfig[] = [
  {
    id: 'light',
    theme: 'light',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    id: 'dark',
    theme: 'dark',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id: 'street',
    theme: 'light',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
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
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: 'esri-satellite', type: 'raster', source: 'esri', minzoom: 0, maxzoom: 22 },
      ],
    } satisfies StyleSpecification,
  },
]

const byId = new Map(BASEMAPS.map((b) => [b.id, b]))
export function getBasemapStyle(id: BasemapId): string | StyleSpecification {
  return byId.get(id)!.style
}
export function basemapSupports3D(id: BasemapId): boolean {
  return byId.get(id)?.supports3D ?? false
}
export function getBasemapTheme(id: BasemapId): 'light' | 'dark' {
  return byId.get(id)?.theme ?? 'light'
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
