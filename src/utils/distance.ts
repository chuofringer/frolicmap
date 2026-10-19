export function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const [lng1, lat1] = a; const [lng2, lat2] = b
  const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
