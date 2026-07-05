import type { TrackFeature } from '../types/track'
import { splitAntimeridian } from '../lib/antimeridian'

export interface HeatPoint {
  position: [number, number]
  weight: number
}

/** Geodesic spacing between resampled points along a track, in kilometers. Independent of
 * zoom — the HeatmapLayer's screen-space `radiusPixels` is what makes the rendered density
 * shrink/grow with zoom, so this only needs to be dense enough for a smooth heatmap. Kept a
 * touch coarse because hundreds of tracks can be active at once. */
const SAMPLE_INTERVAL_KM = 3

const EARTH_RADIUS_KM = 6371

function haversineKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Emits roughly-uniformly spaced sample points along one in-range polyline segment. */
function sampleSegment(seg: readonly [number, number][], out: HeatPoint[]): void {
  if (seg.length === 0) return
  out.push({ position: [seg[0][0], seg[0][1]], weight: 1 })

  let sinceLastSample = 0
  for (let i = 1; i < seg.length; i++) {
    const [aLon, aLat] = seg[i - 1]
    const [bLon, bLat] = seg[i]
    const segKm = haversineKm(aLon, aLat, bLon, bLat)
    if (segKm === 0) continue

    let posKm = 0
    while (sinceLastSample + (segKm - posKm) >= SAMPLE_INTERVAL_KM) {
      posKm += SAMPLE_INTERVAL_KM - sinceLastSample
      const f = posKm / segKm
      out.push({ position: [aLon + (bLon - aLon) * f, aLat + (bLat - aLat) * f], weight: 1 })
      sinceLastSample = 0
    }
    sinceLastSample += segKm - posKm
  }
}

/**
 * Resamples each track to roughly-uniform geodesic spacing so the heatmap reflects spatial
 * density (how many flights pass through an area), not raw GPS-point density which clusters
 * near airports. Single-pass over the vertices — cheap enough to run across hundreds of tracks.
 *
 * Anti-meridian-crossing tracks are split into in-range segments first, so every sample stays
 * within [-180, 180] and the HeatmapLayer renders consistently regardless of map center.
 *
 * When `upToTime` (epoch ms) is given, each track is truncated there so the heatmap builds up
 * progressively during playback.
 */
export function buildHeatmapPoints(trackList: TrackFeature[], upToTime: number | null): HeatPoint[] {
  const points: HeatPoint[] = []

  for (const track of trackList) {
    const { coordinates } = track.geometry
    const { times } = track.properties

    let end = coordinates.length
    if (upToTime != null) {
      const cutoff = times.findIndex((t) => new Date(t).getTime() > upToTime)
      end = cutoff === -1 ? coordinates.length : cutoff
    }
    if (end < 1) continue

    const truncated = coordinates.slice(0, end).map(([lon, lat]): [number, number] => [lon, lat])
    for (const segment of splitAntimeridian(truncated)) {
      sampleSegment(segment, points)
    }
  }

  return points
}
