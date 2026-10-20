import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { useMapStore } from '@/stores/useMapStore'

// Glowing blue dot at the most recently searched address. Mirrors the
// user-location visual from NearbyOverlay, minus the radius circle.
export function SearchMarker() {
  const searchMarker = useMapStore((s) => s.searchMarker)

  const data = useMemo(() => {
    if (!searchMarker) return null
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: searchMarker },
    }
  }, [searchMarker])

  if (!data) return null

  return (
    <Source id="search-marker" type="geojson" data={data}>
      <Layer
        id="search-marker-halo"
        type="circle"
        paint={{
          'circle-radius': 18,
          'circle-color': '#3b82f6',
          'circle-opacity': 0.2,
        }}
      />
      <Layer
        id="search-marker-dot"
        type="circle"
        paint={{
          'circle-radius': 7,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        }}
      />
    </Source>
  )
}
