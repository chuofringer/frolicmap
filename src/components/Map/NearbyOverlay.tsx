import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { useFiltersStore } from '@/stores/useFiltersStore'

// Approximate circle polygon from center + radius in miles
function circlePolygon(lng: number, lat: number, radiusMiles: number, steps = 64): [number, number][] {
  const radiusKm = radiusMiles * 1.609344
  const coords: [number, number][] = []
  const kmPerDegLat = 110.574
  const kmPerDegLng = 111.320 * Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI
    const dx = (radiusKm * Math.cos(theta)) / kmPerDegLng
    const dy = (radiusKm * Math.sin(theta)) / kmPerDegLat
    coords.push([lng + dx, lat + dy])
  }
  return coords
}

export function NearbyOverlay() {
  const nearbyCenter = useFiltersStore((s) => s.nearbyCenter)
  const radiusMiles = useFiltersStore((s) => s.nearbyRadiusMiles)

  const data = useMemo(() => {
    if (!nearbyCenter) return null
    const [lng, lat] = nearbyCenter
    return {
      center: { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [lng, lat] } },
      circle: {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(lng, lat, radiusMiles)] },
      },
    }
  }, [nearbyCenter, radiusMiles])

  if (!data) return null

  return (
    <>
      {/* Radius circle — subtle blue fill + ring */}
      <Source id="nearby-circle" type="geojson" data={data.circle}>
        <Layer
          id="nearby-circle-fill"
          type="fill"
          paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.08 }}
        />
        <Layer
          id="nearby-circle-line"
          type="line"
          paint={{ 'line-color': '#3b82f6', 'line-width': 1.5, 'line-opacity': 0.5 }}
        />
      </Source>
      {/* Glowing blue dot at user location */}
      <Source id="nearby-center" type="geojson" data={data.center}>
        <Layer
          id="nearby-center-halo"
          type="circle"
          paint={{
            'circle-radius': 18,
            'circle-color': '#3b82f6',
            'circle-opacity': 0.2,
          }}
        />
        <Layer
          id="nearby-center-dot"
          type="circle"
          paint={{
            'circle-radius': 7,
            'circle-color': '#3b82f6',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          }}
        />
      </Source>
    </>
  )
}
