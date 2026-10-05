import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import type { IngestSummary, ManifestEntry, RunwayStatus, TrackFeature } from '../src/types/track'
import { ensureCsv, parseAirports, writeAirportsFile, type AirportInfo } from './airports'
import {
  detectArrivalRunway,
  detectDepartureRunway,
  loadRunways,
  runwayIdentsByIcao,
  type DetectPoint,
  type Runway,
} from './runways'

/** Preloaded reference data for runway detection, shared across all tracks in one ingest run. */
interface RunwayContext {
  airportLookup: Map<string, AirportInfo>
  runwaysByIcao: Map<string, Runway[]>
}

/** Per-flight manual runway overrides, persisted so they survive a full re-ingest. */
type RunwayOverrides = Record<string, { departure?: string | null; arrival?: string | null }>

function overridesPath(root: string): string {
  return path.join(root, 'data', 'runway-overrides.json')
}

function loadOverrides(root: string): RunwayOverrides {
  const p = overridesPath(root)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RunwayOverrides
  } catch {
    return {}
  }
}

/** Above this many points, a track is decimated for browser performance. */
const MAX_POINTS = 1500

/** Minimal structural view of the xmldom nodes we touch — avoids pulling in DOM lib types
 * (this module is typechecked under the Node tsconfig, which has no DOM lib). */
interface XmlNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<XmlNode>
  getElementsByTagName(tag: string): ArrayLike<XmlNode>
}

interface TimedPoint {
  coord: [number, number, number]
  time: string
  /** Ground speed (knots) and track heading (deg) from the point's description, when present. */
  spd: number | null
  hdg: number | null
}

function elementsByTag(parent: XmlNode, tag: string): XmlNode[] {
  return Array.from(parent.getElementsByTagName(tag))
}

function firstByTag(parent: XmlNode, tag: string): XmlNode | undefined {
  return parent.getElementsByTagName(tag)[0]
}

function textOf(node: XmlNode | undefined): string {
  return (node?.textContent ?? '').trim()
}

/** Text of the first *direct* child element with the given tag (so a Document's own <name>/
 * <description> isn't confused with those nested inside its Placemarks). */
function directChildText(parent: XmlNode, tag: string): string {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1 && child.nodeName === tag) return (child.textContent ?? '').trim()
  }
  return ''
}

function matchUpper(source: string, re: RegExp): string | null {
  const m = source.match(re)
  return m ? m[1].toUpperCase() : null
}

/** Sorts points chronologically and drops any with an unparseable or duplicate timestamp. */
function normalizePoints(points: TimedPoint[]): TimedPoint[] {
  const valid = points.filter((p) => p.time && !Number.isNaN(Date.parse(p.time)))
  valid.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const out: TimedPoint[] = []
  let lastTime = ''
  for (const p of valid) {
    if (p.time === lastTime) continue
    out.push(p)
    lastTime = p.time
  }
  return out
}

/**
 * Extracts the ordered, timed track points from an FR24 KML, supporting both export shapes:
 *  - Current FR24: one <Placemark> per point, each with a <TimeStamp><when> and a
 *    <Point><coordinates>lon,lat,altMeters</coordinates> (the "Route" folder). The "Trail"
 *    folder's colored LineString segments carry no timestamps and are ignored.
 *  - Older / gx flavor: a single <gx:Track> with interleaved <when> and <gx:coord> children.
 */
/** Parses the per-point "Speed: N kt" from an FR24 Point placemark description. */
function parseSpeedKt(desc: string): number | null {
  const m = desc.match(/Speed:<\/b><\/span>\s*<span>\s*([\d,]+)/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** Parses the per-point "Heading: N" from an FR24 Point placemark description. */
function parseHeadingDeg(desc: string): number | null {
  const m = desc.match(/Heading:<\/b><\/span>\s*<span>\s*([\d]+)/i)
  return m ? Number(m[1]) : null
}

function extractPoints(doc: XmlNode): TimedPoint[] {
  const gxTracks = elementsByTag(doc, 'gx:Track')
  if (gxTracks.length > 0) {
    const pts: TimedPoint[] = []
    for (const track of gxTracks) {
      const whens = elementsByTag(track, 'when')
      const coords = elementsByTag(track, 'gx:coord')
      const n = Math.min(whens.length, coords.length)
      for (let i = 0; i < n; i++) {
        const [lon, lat, alt] = textOf(coords[i]).split(/\s+/).map(Number)
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          // gx:Track has no per-point speed/heading; derived from motion during detection.
          pts.push({ coord: [lon, lat, alt || 0], time: textOf(whens[i]), spd: null, hdg: null })
        }
      }
    }
    return normalizePoints(pts)
  }

  const pts: TimedPoint[] = []
  for (const placemark of elementsByTag(doc, 'Placemark')) {
    const point = firstByTag(placemark, 'Point')
    const when = firstByTag(placemark, 'when')
    if (!point || !when) continue
    const coordsEl = firstByTag(point, 'coordinates')
    if (!coordsEl) continue
    const [lon, lat, alt] = textOf(coordsEl).split(',').map(Number)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const desc = textOf(firstByTag(placemark, 'description'))
      pts.push({
        coord: [lon, lat, alt || 0],
        time: textOf(when),
        spd: parseSpeedKt(desc),
        hdg: parseHeadingDeg(desc),
      })
    }
  }
  return normalizePoints(pts)
}

/**
 * Unwraps longitudes across the anti-meridian (180°). Trans-Pacific tracks otherwise contain a
 * ~360° jump between the two points that straddle 180° (e.g. 179 -> -179), which renderers draw as
 * a streak all the way across the map — and which the heatmap sampler interpolates straight across.
 *
 * Anchored on the first point: whenever consecutive points jump more than 180°, a cumulative
 * ±360° offset is applied to every point from there on, keeping the polyline continuous. The start
 * keeps its true longitude; the far side of a crossing may exceed ±180°, which MapLibre, deck.gl,
 * and Cesium all render seamlessly. Non-crossing tracks are left untouched (offset stays 0).
 */
function unwrapAntimeridian(points: TimedPoint[]): void {
  let offset = 0
  let prevRaw = points[0].coord[0]
  for (let i = 1; i < points.length; i++) {
    const raw = points[i].coord[0]
    const delta = raw - prevRaw
    if (delta > 180) offset -= 360
    else if (delta < -180) offset += 360
    prevRaw = raw
    points[i].coord[0] = raw + offset
  }
}

function decimate(points: TimedPoint[], maxPoints: number): TimedPoint[] {
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  const result: TimedPoint[] = []
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)])
  }
  const last = points[points.length - 1]
  if (result[result.length - 1] !== last) result.push(last)
  return result
}

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'flight'
  )
}

/** FR24's description HTML lists the aircraft as `Aircraft<span>(TYPE)</span><br><span>Full Model</span>`. */
function extractAircraftModel(desc: string): string | null {
  const full = desc.match(/Aircraft<span[^>]*>\([^)]*\)<\/span><br>\s*<span[^>]*>([^<]+)<\/span>/i)
  if (full) return full[1].trim()
  const typeOnly = desc.match(/Aircraft<span[^>]*>\(([^)]*)\)/i)
  return typeOnly ? typeOnly[1].trim() : null
}

/** The ICAO type designator in `Aircraft<span>(TYPE)</span>` — e.g. "B738". */
function extractAircraftType(desc: string): string | null {
  const m = desc.match(/Aircraft<span[^>]*>\(([^)]*)\)/i)
  return m ? m[1].trim() : null
}

/** Reads flight metadata from the Document's <name> (`FLIGHT/CALLSIGN`) and description HTML. */
function extractMeta(doc: XmlNode, fileName: string) {
  const docEl = firstByTag(doc, 'Document')
  const rawName = docEl ? directChildText(docEl, 'name') : ''
  const fallback = path.basename(fileName, path.extname(fileName))
  const callsign = (rawName.split('/')[0] || '').trim() || fallback

  const desc = docEl ? directChildText(docEl, 'description') : ''
  return {
    callsign,
    origin: matchUpper(desc, /airport\/([a-z]{3})\/departures/i),
    destination: matchUpper(desc, /airport\/([a-z]{3})\/arrivals/i),
    registration: matchUpper(desc, /\/reg\/([a-z0-9-]+)/i),
    aircraftModel: extractAircraftModel(desc),
    aircraftType: extractAircraftType(desc),
  }
}

/** Parses one KML file into a track + manifest entry, or null if it has no usable track. */
function parseFile(
  filePath: string,
  fileName: string,
  ctx?: RunwayContext,
): { manifest: ManifestEntry; track: TrackFeature } | null {
  const xml = readFileSync(filePath, 'utf-8')
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XmlNode

  const points = extractPoints(doc)
  if (points.length < 2) return null

  const meta = extractMeta(doc, fileName)

  // Runway detection runs on the original (non-unwrapped) coordinates, so positions still match
  // the airport's runway geometry even for anti-meridian-crossing flights.
  let departureRunway: string | null = null
  let departureRunwayStatus: RunwayStatus = 'unknown'
  let arrivalRunway: string | null = null
  let arrivalRunwayStatus: RunwayStatus = 'unknown'
  if (ctx) {
    const detectPts: DetectPoint[] = points.map((p) => ({
      lat: p.coord[1],
      lon: p.coord[0],
      spd: p.spd,
      hdg: p.hdg,
      t: Date.parse(p.time),
    }))
    const originIcao = meta.origin ? ctx.airportLookup.get(meta.origin)?.ident : undefined
    const destIcao = meta.destination ? ctx.airportLookup.get(meta.destination)?.ident : undefined
    const dep = detectDepartureRunway(detectPts, originIcao ? ctx.runwaysByIcao.get(originIcao) : undefined)
    const arr = detectArrivalRunway(detectPts, destIcao ? ctx.runwaysByIcao.get(destIcao) : undefined)
    departureRunway = dep.runway
    departureRunwayStatus = dep.status
    arrivalRunway = arr.runway
    arrivalRunwayStatus = arr.status
  }

  unwrapAntimeridian(points)
  const decimated = decimate(points, MAX_POINTS)
  const departureTime = points[0].time
  const arrivalTime = points[points.length - 1].time
  const id = slugify(`${meta.callsign}-${departureTime}`)

  const lons = decimated.map((p) => p.coord[0])
  const lats = decimated.map((p) => p.coord[1])
  const bbox: [number, number, number, number] = [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ]

  const track: TrackFeature = {
    type: 'Feature',
    properties: { id, callsign: meta.callsign, times: decimated.map((p) => p.time) },
    geometry: { type: 'LineString', coordinates: decimated.map((p) => p.coord) },
  }

  const manifest: ManifestEntry = {
    id,
    callsign: meta.callsign,
    registration: meta.registration,
    aircraftModel: meta.aircraftModel,
    aircraftType: meta.aircraftType,
    date: departureTime.slice(0, 10),
    origin: meta.origin,
    destination: meta.destination,
    departureTime,
    arrivalTime,
    bbox,
    pointCount: decimated.length,
    sourceFile: fileName,
    departureRunway,
    departureRunwayStatus,
    arrivalRunway,
    arrivalRunwayStatus,
  }

  return { manifest, track }
}

/** Applies manual runway overrides onto the manifest (override wins, marked `manual`). */
function applyOverrides(manifest: ManifestEntry[], overrides: RunwayOverrides): void {
  for (const entry of manifest) {
    const o = overrides[entry.id]
    if (!o) continue
    if (o.departure != null) {
      entry.departureRunway = o.departure
      entry.departureRunwayStatus = 'manual'
    }
    if (o.arrival != null) {
      entry.arrivalRunway = o.arrival
      entry.arrivalRunwayStatus = 'manual'
    }
  }
}

export interface IngestOptions {
  /** Wipe the existing manifest + track files and re-ingest everything from scratch. */
  rebuild?: boolean
}

/**
 * Ingests every new KML in `<root>/data/raw` into `<root>/public/data`.
 *
 * Idempotent by design: a file whose name already appears in the manifest is skipped, and any
 * track whose computed id already exists is skipped as a duplicate. So it's safe to re-run on a
 * folder that mixes already-imported and brand-new files — only the new ones are written.
 */
export async function ingestNewTracks(root: string, options: IngestOptions = {}): Promise<IngestSummary> {
  const rawDir = path.join(root, 'data', 'raw')
  const tracksDir = path.join(root, 'public', 'data', 'tracks')
  const manifestPath = path.join(root, 'public', 'data', 'manifest.json')

  if (options.rebuild) {
    rmSync(tracksDir, { recursive: true, force: true })
    rmSync(manifestPath, { force: true })
  }
  mkdirSync(tracksDir, { recursive: true })

  let manifest: ManifestEntry[] = []
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[]
    } catch {
      manifest = []
    }
  }

  const importedFiles = new Set(manifest.map((m) => m.sourceFile).filter(Boolean))
  const importedIds = new Set(manifest.map((m) => m.id))

  const summary: IngestSummary = {
    imported: [],
    skipped: [],
    failed: [],
    manifestCount: manifest.length,
    airportsCount: 0,
  }

  if (!existsSync(rawDir)) return summary

  // Load reference data once for runway detection + the airports file.
  const airportsCsv = await ensureCsv(root, 'airports.csv')
  const airportLookup = airportsCsv ? parseAirports(airportsCsv) : new Map<string, AirportInfo>()
  const runwaysByIcao = await loadRunways(root)
  const ctx: RunwayContext = { airportLookup, runwaysByIcao }

  const kmlFiles = readdirSync(rawDir)
    .filter((f) => f.toLowerCase().endsWith('.kml'))
    .sort()

  for (const file of kmlFiles) {
    // Fast path: filename already recorded in the manifest — no need to re-parse.
    if (importedFiles.has(file)) {
      summary.skipped.push({ sourceFile: file, reason: 'already-imported' })
      continue
    }

    let parsed: { manifest: ManifestEntry; track: TrackFeature } | null
    try {
      parsed = parseFile(path.join(rawDir, file), file, ctx)
    } catch (e) {
      summary.failed.push({ sourceFile: file, error: e instanceof Error ? e.message : String(e) })
      continue
    }

    if (!parsed) {
      summary.skipped.push({ sourceFile: file, reason: 'no-track' })
      continue
    }
    // A different filename that resolves to a flight we already have (same callsign + start time).
    if (importedIds.has(parsed.manifest.id)) {
      summary.skipped.push({ sourceFile: file, reason: 'duplicate-id' })
      continue
    }

    writeFileSync(path.join(tracksDir, `${parsed.manifest.id}.geojson`), JSON.stringify(parsed.track))
    manifest.push(parsed.manifest)
    importedFiles.add(file)
    importedIds.add(parsed.manifest.id)
    summary.imported.push({
      id: parsed.manifest.id,
      callsign: parsed.manifest.callsign,
      sourceFile: file,
      pointCount: parsed.manifest.pointCount,
    })
  }

  applyOverrides(manifest, loadOverrides(root))
  manifest.sort((a, b) => a.date.localeCompare(b.date))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  summary.manifestCount = manifest.length
  summary.airportsCount = await writeAirportsFile(root, manifest, airportLookup, runwayIdentsByIcao(runwaysByIcao))
  return summary
}

export interface DeleteResult {
  ok: boolean
  error?: string
}

/**
 * Removes a flight from the dataset: deletes its GeoJSON, drops its manifest entry, rebuilds the
 * airport list, and moves the source KML into data/raw/_deleted (recoverable, and no longer
 * re-imported since ingestion only reads top-level `.kml` files).
 */
export async function deleteTrack(root: string, id: string): Promise<DeleteResult> {
  const rawDir = path.join(root, 'data', 'raw')
  const tracksDir = path.join(root, 'public', 'data', 'tracks')
  const manifestPath = path.join(root, 'public', 'data', 'manifest.json')

  if (!existsSync(manifestPath)) return { ok: false, error: 'No manifest found' }

  let manifest: ManifestEntry[]
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[]
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const entry = manifest.find((m) => m.id === id)
  if (!entry) return { ok: false, error: `Flight "${id}" not found` }

  rmSync(path.join(tracksDir, `${id}.geojson`), { force: true })

  if (entry.sourceFile) {
    const src = path.join(rawDir, entry.sourceFile)
    if (existsSync(src)) {
      const deletedDir = path.join(rawDir, '_deleted')
      mkdirSync(deletedDir, { recursive: true })
      renameSync(src, path.join(deletedDir, entry.sourceFile))
    }
  }

  manifest = manifest.filter((m) => m.id !== id)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const airportsCsv = await ensureCsv(root, 'airports.csv')
  const airportLookup = airportsCsv ? parseAirports(airportsCsv) : new Map<string, AirportInfo>()
  const runwaysByIcao = await loadRunways(root)
  await writeAirportsFile(root, manifest, airportLookup, runwayIdentsByIcao(runwaysByIcao))
  return { ok: true }
}

/**
 * Sets (or clears) a manual runway for a flight. The override is persisted to
 * data/runway-overrides.json (so it survives a full re-ingest) and applied to the manifest
 * immediately. Pass an empty value to clear the override.
 */
export function setRunwayOverride(
  root: string,
  id: string,
  direction: 'departure' | 'arrival',
  value: string | null,
): DeleteResult {
  const manifestPath = path.join(root, 'public', 'data', 'manifest.json')
  if (!existsSync(manifestPath)) return { ok: false, error: 'No manifest found' }

  let manifest: ManifestEntry[]
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[]
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const entry = manifest.find((m) => m.id === id)
  if (!entry) return { ok: false, error: `Flight "${id}" not found` }

  const overrides = loadOverrides(root)
  const clean = value && value.trim() ? value.trim().toUpperCase() : null

  const current = overrides[id] ?? {}
  if (clean) current[direction] = clean
  else delete current[direction]
  if (Object.keys(current).length) overrides[id] = current
  else delete overrides[id]
  writeFileSync(overridesPath(root), JSON.stringify(overrides, null, 2))

  if (direction === 'departure') {
    entry.departureRunway = clean
    entry.departureRunwayStatus = clean ? 'manual' : 'unknown'
  } else {
    entry.arrivalRunway = clean
    entry.arrivalRunwayStatus = clean ? 'manual' : 'unknown'
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  return { ok: true }
}
