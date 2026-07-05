/** Wraps a longitude into [-180, 180). */
export function normLon(lon: number): number {
  return (((lon + 180) % 360) + 360) % 360 - 180
}

/**
 * Splits a lon/lat polyline at the anti-meridian into segments that each stay within [-180, 180],
 * inserting a boundary vertex (at ±180) where the path crosses. Input longitudes may be unwrapped
 * (outside ±180, as stored) or raw — they're normalized first.
 *
 * Why: deck.gl's PathLayer repeats across world copies, but HeatmapLayer aggregates in a single
 * world, so a track with out-of-range longitudes drops out of the heatmap depending on where the
 * map is centered. Keeping every vertex in range — with the two sides as separate segments that
 * meet at the seam (+180 ≡ -180) — makes both layers render consistently across world copies.
 */
export function splitAntimeridian(coords: readonly (readonly [number, number])[]): [number, number][][] {
  const segments: [number, number][][] = []
  let cur: [number, number][] = []

  for (let i = 0; i < coords.length; i++) {
    const lat = coords[i][1]
    const lon = normLon(coords[i][0])
    if (cur.length === 0) {
      cur.push([lon, lat])
      continue
    }
    const [plon, plat] = cur[cur.length - 1]
    if (Math.abs(lon - plon) > 180) {
      // Crossed the anti-meridian. Bring `lon` adjacent to `plon` to interpolate the seam latitude.
      const exit = plon < 0 ? -180 : 180
      const entry = -exit
      const lonAdj = lon + (plon < 0 ? -360 : 360)
      const t = (exit - plon) / (lonAdj - plon)
      const seamLat = plat + (lat - plat) * t
      cur.push([exit, seamLat])
      segments.push(cur)
      cur = [
        [entry, seamLat],
        [lon, lat],
      ]
    } else {
      cur.push([lon, lat])
    }
  }
  if (cur.length) segments.push(cur)
  return segments
}
