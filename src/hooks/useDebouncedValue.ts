import { useEffect, useState } from 'react'

/**
 * Returns `value` after it has been stable for `delayMs`. Each change
 * restarts the timer, so rapid updates (keystrokes) collapse to the final
 * value.
 *
 * Added for the SearchBar → Nominatim path: the OSM Nominatim usage policy
 * caps clients at 1 request/second and prohibits autocomplete-style
 * per-keystroke traffic — violators get IP-blocked, which would silently
 * kill address search for everyone. Debouncing the query string means the
 * geocode fetch fires only once typing settles.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
