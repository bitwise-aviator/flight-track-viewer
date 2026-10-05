import { ensureCsv, parseCsvLine } from './airports'
import type { RunwayStatus } from '../src/types/track'

/** A full runway as a line between its two thresholds, with each end's ident + travel heading. */
export interface Runway {
  leIdent: string
  leLat: number
  leLon: number
  leHdg: number // true heading when departing/landing from the le end (i.e. le -> he)
  heIdent: string
  heLat: number
  heLon: number
  heHdg: number // true heading from the he end (he -> le)
}

export interface DetectPoint {
  lat: number
  lon: number
  /** Ground speed in knots, or null if unavailable (then derived from motion). */
  spd: number | null
  /** Track heading in degrees, or null (then derived from motion). */
  hdg: number | null
  /** epoch ms */
  t: number
}

export interface RunwayDetection {
  runway: string | null
  status: RunwayStatus
}

const EARTH_KM = 6371
/** Ground speed above this (knots) marks the takeoff roll / before the landing rollout ends. */
const SPEED_THRESHOLD_KT = 50
/** Auto-detect lateral tolerance from the centerline (km) — ±30 m. */
const LATERAL_AUTO_KM = 0.03
/** Auto-detect requires the travel heading to be within this of the runway axis (clear direction). */
const ALIGN_AUTO_DEG = 25
/** Loose fallback bounds for a flagged (uncertain) match. */
const LATERAL_LOOSE_KM = 1.5
const ALIGN_LOOSE_DEG = 35

function toRad(d: number): number {
  return (d * Math.PI) / 180
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat))
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon))
  return (Math.atan2(y, x) * 180) / Math.PI
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Projects a point onto the runway line: `t` is 0 at the le threshold, 1 at the he threshold;
 * `perpKm` is the perpendicular (lateral) offset from the infinite centerline. Planar approx. */
function projectToLine(pLat: number, pLon: number, rw: Runway): { t: number; perpKm: number } {
  const kx = 111.32 * Math.cos(toRad(pLat))
  const ky = 110.57
  const px = pLon * kx
  const py = pLat * ky
  const ax = rw.leLon * kx
  const ay = rw.leLat * ky
  const bx = rw.heLon * kx
  const by = rw.heLat * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  const projX = ax + t * dx
  const projY = ay + t * dy
  return { t, perpKm: Math.hypot(px - projX, py - projY) }
}

/** Parses OurAirports runways.csv into ICAO ident -> list of runways (as lines). */
export function parseRunways(csv: string): Map<string, Runway[]> {
  const lines = csv.split(/\r?\n/)
  const h = parseCsvLine(lines[0])
  const idx = {
    ap: h.indexOf('airport_ident'),
    closed: h.indexOf('closed'),
    leId: h.indexOf('le_ident'),
    leLat: h.indexOf('le_latitude_deg'),
    leLon: h.indexOf('le_longitude_deg'),
    leHdg: h.indexOf('le_heading_degT'),
    heId: h.indexOf('he_ident'),
    heLat: h.indexOf('he_latitude_deg'),
    heLon: h.indexOf('he_longitude_deg'),
    heHdg: h.indexOf('he_heading_degT'),
  }
  const map = new Map<string, Runway[]>()
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const c = parseCsvLine(lines[i])
    if (c[idx.closed] === '1') continue
    const leLat = Number(c[idx.leLat])
    const leLon = Number(c[idx.leLon])
    const heLat = Number(c[idx.heLat])
    const heLon = Number(c[idx.heLon])
    const leIdent = (c[idx.leId] ?? '').trim()
    const heIdent = (c[idx.heId] ?? '').trim()
    if (!leIdent || !heIdent || ![leLat, leLon, heLat, heLon].every(Number.isFinite)) continue
    const leHdgRaw = Number(c[idx.leHdg])
    const heHdgRaw = Number(c[idx.heHdg])
    const runway: Runway = {
      leIdent,
      leLat,
      leLon,
      leHdg: Number.isFinite(leHdgRaw) ? leHdgRaw : (bearing(leLat, leLon, heLat, heLon) + 360) % 360,
      heIdent,
      heLat,
      heLon,
      heHdg: Number.isFinite(heHdgRaw) ? heHdgRaw : (bearing(heLat, heLon, leLat, leLon) + 360) % 360,
    }
    const list = map.get(c[idx.ap]) ?? []
    list.push(runway)
    map.set(c[idx.ap], list)
  }
  return map
}

/** ICAO ident -> sorted list of runway-end identifiers (for the manual selection UI). */
export function runwayIdentsByIcao(byIcao: Map<string, Runway[]>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [icao, runways] of byIcao) {
    const idents = new Set<string>()
    for (const rw of runways) {
      idents.add(rw.leIdent)
      idents.add(rw.heIdent)
    }
    out.set(icao, [...idents].sort())
  }
  return out
}

export async function loadRunways(root: string): Promise<Map<string, Runway[]>> {
  const csv = await ensureCsv(root, 'runways.csv')
  return csv ? parseRunways(csv) : new Map()
}

interface Candidate {
  ident: string
  perpKm: number
  /** Distance to the runway *segment* (clamped to the thresholds) — used for the loose fallback. */
  segKm: number
  align: number
  between: boolean
}

/** For a runway line, the end being used = the threshold the aircraft is travelling *away from*,
 * decided by which end's travel heading the aircraft heading aligns with. */
function evaluateRunway(lat: number, lon: number, heading: number, rw: Runway): Candidate {
  const { t, perpKm } = projectToLine(lat, lon, rw)
  const dhLe = angleDiff(heading, rw.leHdg)
  const dhHe = angleDiff(heading, rw.heHdg)
  const useLe = dhLe <= dhHe
  // Distance to the segment: perpendicular when between thresholds, else to the nearer threshold.
  const segKm =
    t >= 0 && t <= 1
      ? perpKm
      : Math.min(haversineKm(lat, lon, rw.leLat, rw.leLon), haversineKm(lat, lon, rw.heLat, rw.heLon))
  return {
    ident: useLe ? rw.leIdent : rw.heIdent,
    perpKm,
    segKm,
    align: Math.min(dhLe, dhHe),
    between: t >= 0 && t <= 1,
  }
}

/**
 * Matches an on-runway position + travel heading to a runway end.
 *
 * Auto: the point is within ±30 m laterally of a runway centerline, between its thresholds, and the
 * travel heading clearly follows the runway axis (so the end being left behind is unambiguous).
 * Falls back to a looser (flagged "uncertain") match near a runway, else unknown.
 */
function matchRunway(lat: number, lon: number, heading: number, runways: Runway[] | undefined): RunwayDetection {
  if (!runways || runways.length === 0) return { runway: null, status: 'unknown' }

  const cands = runways.map((rw) => evaluateRunway(lat, lon, heading, rw))

  const strict = cands.filter((c) => c.perpKm <= LATERAL_AUTO_KM && c.between && c.align <= ALIGN_AUTO_DEG)
  if (strict.length > 0) {
    strict.sort((a, b) => a.perpKm - b.perpKm)
    const ambiguous =
      strict.length > 1 && strict[1].ident !== strict[0].ident && Math.abs(strict[1].perpKm - strict[0].perpKm) < 0.015
    return { runway: strict[0].ident, status: ambiguous ? 'uncertain' : 'auto' }
  }

  const loose = cands.filter((c) => c.segKm <= LATERAL_LOOSE_KM && c.align <= ALIGN_LOOSE_DEG)
  if (loose.length > 0) {
    loose.sort((a, b) => a.segKm - b.segKm || a.align - b.align)
    return { runway: loose[0].ident, status: 'uncertain' }
  }
  return { runway: null, status: 'unknown' }
}

function speedAt(points: DetectPoint[], i: number): number {
  const p = points[i]
  if (p.spd != null) return p.spd
  if (i === 0) return 0
  const prev = points[i - 1]
  const km = haversineKm(prev.lat, prev.lon, p.lat, p.lon)
  const hours = (p.t - prev.t) / 3_600_000
  return hours > 0 ? km / 1.852 / hours : 0
}

function headingAt(points: DetectPoint[], i: number): number {
  const p = points[i]
  if (p.hdg != null) return p.hdg
  if (i === 0) return 0
  const prev = points[i - 1]
  return (bearing(prev.lat, prev.lon, p.lat, p.lon) + 360) % 360
}

/** Departure runway: evaluated at the first point where ground speed exceeds the threshold
 * (the takeoff roll). Returns unknown if the track doesn't capture the start of the roll. */
export function detectDepartureRunway(points: DetectPoint[], runways: Runway[] | undefined): RunwayDetection {
  let crossing = -1
  for (let i = 0; i < points.length; i++) {
    if (speedAt(points, i) > SPEED_THRESHOLD_KT) {
      crossing = i
      break
    }
  }
  // crossing must be preceded by a sub-threshold point, else the track began airborne.
  if (crossing <= 0) return { runway: null, status: 'unknown' }
  return matchRunway(points[crossing].lat, points[crossing].lon, headingAt(points, crossing), runways)
}

/** Arrival runway: evaluated where ground speed falls back below the threshold after landing —
 * i.e. the last point still above it, during the rollout. Unknown if no landing is captured. */
export function detectArrivalRunway(points: DetectPoint[], runways: Runway[] | undefined): RunwayDetection {
  let lastFast = -1
  for (let i = 0; i < points.length; i++) {
    if (speedAt(points, i) > SPEED_THRESHOLD_KT) lastFast = i
  }
  // Must have slowed below the threshold afterwards (a captured landing), not still be airborne.
  if (lastFast < 0 || lastFast >= points.length - 1) return { runway: null, status: 'unknown' }
  return matchRunway(points[lastFast].lat, points[lastFast].lon, headingAt(points, lastFast), runways)
}
