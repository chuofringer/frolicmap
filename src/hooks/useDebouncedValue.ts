import { useEffect, useState } from 'react'

/**
 * Returns `value` after it has been stable for `delayMs`. Each change
 * restarts the timer, so rapid updates (keystrokes) collapse to the final
 * value.
 *
 * Generic helper. (It once fronted the Nominatim address lookup, but the OSM
 * usage policy forbids auto-complete even when debounced, so the geocode
 * query now fires only on an explicit Enter — see `useGeocodeQuery`.)
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
