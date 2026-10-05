import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { ensureCached } from './airports'
import type { FirRef } from '../src/types/track'

/**
 * FIR (Flight Information Region) boundaries from the VATSpy Data Project — a freely available,
 * community-maintained dataset of airspace boundaries with ICAO-style codes. Boundaries.geojson
 * holds the polygons; VATSpy.dat maps each boundary code to a human name.
 * https://github.com/vatsimnetwork/vatspy-data-project
 */
const BOUNDARIES_URL = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson'
const VATSPY_URL = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat'

/** How many track points to test for FIR membership (FIRs are large, so sampling is enough). */
const MAX_SAMPLES = 500

type MultiPolygon = number[][][][] // [polygon][ring][vertex][lon,lat]

interface FirIndexEntry {
  id: string
  name: string
  bbox: [number, number, number, number] // minLon, minLat, maxLon, maxLat
  polys: MultiPolygon
  labelLon: number
  labelLat: number
}

export interface FirData {
  index: FirIndexEntry[]
  /** GeoJSON (id + name + label) for the map boundary layer. */
  featureCollection: unknown
}

interface RawFeature {
  properties: { id: string; label_lon?: string; label_lat?: string }
  geometry: { type: string; coordinates: MultiPolygon }
}

/** Builds boundary-code -> name from VATSpy.dat's [FIRs] section (ICAO|NAME|PREFIX|BOUNDARY). */
function parseNames(dat: string): Map<string, string> {
  const names = new Map<string, string>()
  const primary = new Map<string, string>()
  let inFirs = false
  for (const line of dat.split(/\r?\n/)) {
    if (/^\[FIRs\]/i.test(line)) {
      inFirs = true
      continue
    }
    if (/^\[/.test(line)) inFirs = false
    if (!inFirs || !line || line[0] === ';') continue
    const [icao, name, , boundary] = line.split('|')
    const b = boundary || icao
    if (!b || !name) continue
    if (!names.has(b)) names.set(b, name)
    if (icao === b) primary.set(b, name) // the row whose own code is the boundary is the best name
  }
  for (const [b, n] of primary) names.set(b, n)
  return names
}

function bboxOf(polys: MultiPolygon): [number, number, number, number] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat]
}

export async function loadFirs(root: string): Promise<FirData | null> {
  const [geojson, dat] = await Promise.all([
    ensureCached(root, 'vatspy-boundaries.geojson', BOUNDARIES_URL),
    ensureCached(root, 'vatspy.dat', VATSPY_URL),
  ])
  if (!geojson) return null

  const parsed = JSON.parse(geojson) as { features: RawFeature[] }
  const names = dat ? parseNames(dat) : new Map<string, string>()

  const index: FirIndexEntry[] = []
  const outFeatures: unknown[] = []
  for (const f of parsed.features) {
    if (f.geometry?.type !== 'MultiPolygon') continue
    const id = f.properties.id
    const name = names.get(id) ?? id
    const polys = f.geometry.coordinates
    index.push({
      id,
      name,
      bbox: bboxOf(polys),
      polys,
      labelLon: Number(f.properties.label_lon),
      labelLat: Number(f.properties.label_lat),
    })
    outFeatures.push({
      type: 'Feature',
      properties: { id, name, labelLon: Number(f.properties.label_lon), labelLat: Number(f.properties.label_lat) },
      geometry: f.geometry,
    })
  }
  // Prefer plain 4-letter ICAO codes over hyphenated sub-sectors when a point lies in both.
  index.sort((a, b) => Number(/^[A-Z0-9]{4}$/.test(b.id)) - Number(/^[A-Z0-9]{4}$/.test(a.id)))

  return { index, featureCollection: { type: 'FeatureCollection', features: outFeatures } }
}

export function writeFirsFile(root: string, data: FirData): void {
  writeFileSync(path.join(root, 'public', 'fir-boundaries.geojson'), JSON.stringify(data.featureCollection))
}

/** Ray-casting point-in-ring test (lon/lat). */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside any hole, across any polygon of the MultiPolygon. */
function pointInMultiPolygon(lon: number, lat: number, polys: MultiPolygon): boolean {
  for (const poly of polys) {
    if (!poly.length || !pointInRing(lon, lat, poly[0])) continue
    let inHole = false
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lon, lat, poly[h])) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

function firAt(lon: number, lat: number, index: FirIndexEntry[]): FirIndexEntry | null {
  for (const fir of index) {
    const [minLon, minLat, maxLon, maxLat] = fir.bbox
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue
    if (pointInMultiPolygon(lon, lat, fir.polys)) return fir
  }
  return null
}

/** The FIRs a track passes through, in chronological order (consecutive duplicates collapsed). */
export function overflownFirs(points: { lat: number; lon: number }[], index: FirIndexEntry[]): FirRef[] {
  if (index.length === 0 || points.length === 0) return []
  const step = Math.max(1, Math.floor(points.length / MAX_SAMPLES))

  const seq: FirRef[] = []
  let last: string | null = null
  for (let i = 0; i < points.length; i += step) {
    const fir = firAt(points[i].lon, points[i].lat, index)
    if (!fir) continue // over airspace with no boundary data — don't break the run
    if (fir.id !== last) {
      seq.push({ code: fir.id, name: fir.name })
      last = fir.id
    }
  }
  return seq
}
