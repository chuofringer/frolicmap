# Basemaps

frolicmap uses **free and open providers only, with no API keys**. The five
basemap ids and their menu labels (`light`, `dark`, `street`, `liberty`,
`satellite`) are defined in `src/config/mapStyle.ts`; labels live in
`src/i18n/{en,zh}/map.ts` under `map.basemaps.*`.

| id | Provider | Style / tile URL | Key? | Attribution | Licence | Self-host option |
| --- | --- | --- | --- | --- | --- | --- |
| `light` | OpenFreeMap (Positron) | `https://tiles.openfreemap.org/styles/positron` | No | © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap (carried by the style) | Data ODbL 1.0; OpenMapTiles schema/styles BSD-3 / CC-BY 4.0 | Yes, OpenFreeMap |
| `dark` | OpenFreeMap (Dark) | `https://tiles.openfreemap.org/styles/dark` | No | as above | as above | Yes, OpenFreeMap |
| `street` | OpenFreeMap (Bright) | `https://tiles.openfreemap.org/styles/bright` | No | as above | as above | Yes, OpenFreeMap |
| `liberty` | OpenFreeMap (Liberty, 3D buildings) | `https://tiles.openfreemap.org/styles/liberty` | No | as above | as above | Yes, OpenFreeMap |
| `satellite` | USGS The National Map, imagery | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` (raster, 256 px, maxzoom 16) | No | `Imagery: USGS The National Map, public domain` | US public domain | n/a (US government service) |

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

## Verification note

The style URLs and the USGS tile template were taken from the GeoLibre
reference and the project owner's brief; the sandbox that produced this change
had no route to `tiles.openfreemap.org` or `basemap.nationalmap.gov`, so they
were not fetched live. Check each basemap in the browser once before relying on
it.
