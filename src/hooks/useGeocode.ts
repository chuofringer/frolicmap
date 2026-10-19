import { useQuery } from '@tanstack/react-query'
import { useMetro } from './useMetro'
import type { Metro } from '@shared/metros'

export interface GeocodeResult { lat: number; lng: number; label: string }

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  address?: { state?: string }
}

/**
 * Nominatim `viewbox` for a metro, in its `west,north,east,south` order.
 *
 * This was a hardcoded California bbox paired with an
 * `address.state === 'California'` post-filter, from when the Bay Area was the
 * only region. Twelve non-CA metros are published now, so on /cities/seattle a
 * parent typing their home address got NOTHING back — not a "no results" note
 * but an absent dropdown (SearchBar renders it only with ≥1 match), so the box
 * simply looked broken.
 *
 * The metro's own viewport bounds are the natural scope: search exists to
 * recentre the map, and a result outside those bounds can't be panned to
 * anyway. Padded slightly so an address just past the edge still resolves.
 */
export function metroViewbox(metro: Metro, padDeg = 0.15): string {
  const [[w, s], [e, n]] = metro.viewportBounds
  return `${w - padDeg},${n + padDeg},${e + padDeg},${s - padDeg}`
}

/** Is a result inside the metro's padded bounds? Replaces the state-name filter. */
export function withinMetro(metro: Metro, lat: number, lng: number, padDeg = 0.15): boolean {
  const [[w, s], [e, n]] = metro.viewportBounds
  return lat >= s - padDeg && lat <= n + padDeg && lng >= w - padDeg && lng <= e + padDeg
}

export function useGeocodeQuery(q: string) {
  const metro = useMetro()
  return useQuery({
    // Metro is part of the key: the same query string must not serve Seattle
    // results from a Bay Area cache entry.
    queryKey: ['geocode', metro.id, q],
    queryFn: async (): Promise<GeocodeResult[]> => {
      if (q.length < 3) return []
      const params = new URLSearchParams({
        format: 'json',
        limit: '8',
        viewbox: metroViewbox(metro),
        // Keep results inside the box: without this a name match anywhere on
        // earth ("Four Seasons") outranks the local street.
        bounded: '1',
        countrycodes: 'us',
        addressdetails: '1',
        q,
      })
      const url = `https://nominatim.openstreetmap.org/search?${params}`
      const res = await fetch(url, { headers: { 'accept-language': 'en' } })
      if (!res.ok) return []
      const json = await res.json() as NominatimResult[]
      return json
        .filter((r) => withinMetro(metro, Number(r.lat), Number(r.lon)))
        .slice(0, 5)
        .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name }))
    },
    enabled: q.length >= 3,
    staleTime: 5 * 60 * 1000,
  })
}
