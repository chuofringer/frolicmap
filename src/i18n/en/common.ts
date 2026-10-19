/**
 * Generic, reusable UI words. Shared across every surface — if a string is
 * specific to one panel, it belongs in that panel's namespace instead, so this
 * file doesn't turn into a dumping ground where nothing can safely change.
 */
export const common = {
  clear: 'Clear',
  loading: 'Loading…',
  free: 'Free',
  // Distance-origin caption (DistanceOriginNote) — shown above any list of
  // distance-labelled cards, so "3.2 mi" always has a stated starting point.
  distanceFromYou: 'Distances from your location',
  distanceFromMapCenter: 'Distances from the map center — tap “Near me” to measure from your location',
} as const
