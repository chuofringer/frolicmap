# Basemaps

frolicmap uses **free and open providers only, with no API keys**. The five
basemap ids and their menu labels (`light`, `dark`, `street`, `liberty`,
`satellite`) are defined in `src/config/mapStyle.ts`; labels live in
`src/i18n/{en,zh}/map.ts` under `map.basemaps.*`.

| id | Provider | Style / tile URL | Key? | Attribution | Licence | Self-host option |
| --- | --- | --- | --- | --- | --- | --- |
| `light` | OpenFreeMap (Positron) | `https://tiles.openfreemap.org/styles/positron` | No | © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap (carried by the style) | Data ODbL 1.0; OpenMapTiles schema/styles BSD-3 / CC-BY 4.0 | Yes, OpenFreeMap |
| `dark` | OpenFreeMap (Fiord) | `https://tiles.openfreemap.org/styles/fiord` | No | as above | as above | Yes, OpenFreeMap |
| `street` | OpenFreeMap (Bright) | `https://tiles.openfreemap.org/styles/bright` | No | as above | as above | Yes, OpenFreeMap |
| `liberty` | OpenFreeMap (Liberty, 3D buildings) | `https://tiles.openfreemap.org/styles/liberty` | No | as above | as above | Yes, OpenFreeMap |
| `satellite` | USGS The National Map, imagery, with OpenFreeMap labels and major roads on top (hybrid) | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` (raster, 256 px, maxzoom 16) plus `https://tiles.openfreemap.org/planet` (vector overlay) | No | `Imagery: USGS The National Map, public domain`, plus the OpenFreeMap / OpenMapTiles / OpenStreetMap credit | US public domain; overlay data ODbL 1.0, OpenMapTiles BSD-3 / CC-BY 4.0 | Overlay: yes, OpenFreeMap; imagery: n/a (US government service) |

`dark` uses OpenFreeMap's **Fiord** style (slate blue-grey land and water), not
the stock `dark` style, whose near-black land and water disappear under the
pins. The id and theme stay `dark` so stored preferences keep working.

## Satellite hybrid

`satellite` stacks, bottom to top: the `background` layer (deep-water blue `#1b3a5c`
for areas USGS does not cover), the `usgs-imagery` raster, then the overlay in
`src/config/satelliteOverlay.ts`: a flat water mask (OpenFreeMap `water`
polygons and `waterway` lines in the same blue, because the USGS ocean imagery
is striped and patchy, so land keeps imagery while sea, bays and lakes are flat),
major road lines (motorway, trunk, primary,
secondary, tertiary, with casings), road names and shields, and place and water
name labels. The overlay layers were copied once from OpenFreeMap's `positron`
style with their paint overridden for legibility on imagery (white text, dark
halo; translucent white roads over dark casings). At runtime the only extra
dependency is the `openmaptiles` vector source (`/planet`) plus the style's
`glyphs` and `sprite` URLs, all on `tiles.openfreemap.org`, which is already in
`BASEMAP_CDN_HOSTS`. To refresh the overlay, re-copy the layers from the current
positron style.

The app adds its own "© OpenStreetMap contributors" credit (linked to the OSM
copyright page) through the `AttributionControl` in
`src/components/Map/FunMap.tsx`; MapLibre merges it with each style's source
attribution, so the OpenFreeMap and USGS credits are never suppressed.

## Unknown or retired ids

`getBasemapStyle`, `getBasemapTheme` and `basemapSupports3D` accept any string.
An unknown id (for example an old value left in `localStorage` under
`frolicmap.basemap`) resolves to `light` with one `console.warn`; it never
throws and the map never renders blank. The map store validates the stored id
through the same resolver.

## Why not CARTO, Esri or EOX

- **CARTO.** The keyless raster endpoints now watermark unkeyed use, and the
  free tier is non-commercial.
- **Esri World Imagery.** Production use requires an ArcGIS developer account
  and key, which this project deliberately does not have.
- **EOX Sentinel-2 cloudless.** Its recent mosaics (2018 to 2024) are
  CC BY-NC-SA 4.0, so they were not used; a non-commercial clause does not fit
  an MIT-licensed codebase.

Never add a keyed provider.

## Self-hosting OpenFreeMap

OpenFreeMap is open source and can be self-hosted (planet tiles plus the
styles); see <https://github.com/hyperknot/openfreemap>. To switch, change the
four `https://tiles.openfreemap.org/styles/*` URLs in `src/config/mapStyle.ts`
and the host in `BASEMAP_CDN_HOSTS` in `src/pwa/cachingStrategy.ts`.
