import { useMemo } from 'react'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMapStore } from '@/stores/useMapStore'
import { useMetro } from '@/hooks/useMetro'

/**
 * The point distances are measured FROM, as `[lng, lat]`.
 *
 * Priority (per the design handoff, screens 1a/1c): the Near-me center when
 * geolocation is on, else the live map center, else the metro's initial view
 * as a last resort before the map instance mounts. Not reactive to pans — it's
 * a snapshot read at render, which is fine for the panel/list distance labels.
 *
 * **Identity-stable.** `getCenter()` allocates a fresh array every call, which
 * would defeat `ListPanel`'s `rows` memo (re-sorting the whole visible set on
 * every render) and refire effects keyed on it. We read the scalar lng/lat and
 * memoize the tuple on them, so the reference only changes when the origin
 * actually moves.
 */
export function useDistanceOrigin(): [number, number] {
  return useDistanceOriginInfo().origin
}

/**
 * Where distances are measured FROM, plus WHICH origin it is.
 *
 * Every "3.2 mi" in the product used to be unanchored — the number is
 * meaningless (and reads as wrong) if you can't tell whether it's from you or
 * from wherever the map happens to sit. `source` lets the surfaces label it:
 *
 *   'geo' — the Near-me center, i.e. the device's actual location.
 *   'map' — the live map center (or the metro's initial view before the map
 *           instance mounts, which IS the map center at that moment).
 */
export function useDistanceOriginInfo(): { origin: [number, number]; source: 'geo' | 'map' } {
  const nearby = useFiltersStore((s) => s.nearbyCenter)
  const mapInstance = useMapStore((s) => s.mapInstance)
  const metro = useMetro()

  let lng: number
  let lat: number
  if (nearby) {
    ;[lng, lat] = nearby
  } else if (mapInstance) {
    const c = mapInstance.getMap().getCenter()
    lng = c.lng
    lat = c.lat
  } else {
    lng = metro.initialView.longitude
    lat = metro.initialView.latitude
  }
  const source = nearby ? 'geo' : 'map'

  const origin = useMemo<[number, number]>(() => [lng, lat], [lng, lat])
  return useMemo(() => ({ origin, source }), [origin, source])
}
