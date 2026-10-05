export interface ManifestEntry {
  id: string
  callsign: string
  registration: string | null
  aircraftModel: string | null
  /** ICAO type designator (4-char code, e.g. "B738", "CRJ9") — used to group by model. */
  aircraftType: string | null
  date: string
  origin: string | null
  destination: string | null
  /** ISO 8601 (UTC) timestamp of the first track point. */
  departureTime: string
  /** ISO 8601 (UTC) timestamp of the last track point. */
  arrivalTime: string
  bbox: [number, number, number, number]
  pointCount: number
  /** The KML filename in data/raw this track was ingested from. Used to skip re-imports. */
  sourceFile: string
  /** Detected (or manually set) departure runway end, e.g. "23R". */
  departureRunway: string | null
  departureRunwayStatus: RunwayStatus
  /** Detected (or manually set) arrival runway end. */
  arrivalRunway: string | null
  arrivalRunwayStatus: RunwayStatus
  /** Flight Information Regions overflown, in chronological order. */
  firs: FirRef[]
}

/** A Flight Information Region: 4-letter ICAO-style code + name. */
export interface FirRef {
  code: string
  name: string
}

/**
 * How a flight's runway was determined:
 * - `auto`: confidently detected from the track
 * - `uncertain`: detected but questionable (e.g. parallel runways) — worth confirming
 * - `manual`: set by the user
 * - `unknown`: could not be determined (e.g. track began airborne) — needs manual entry
 */
export type RunwayStatus = 'auto' | 'uncertain' | 'manual' | 'unknown'

/** One airport referenced by at least one track's origin/destination. */
export interface Airport {
  /** IATA code (also used as the pin label). */
  code: string
  name: string
  lat: number
  lon: number
  /** IANA timezone (from the airport's coordinates); used for DST-correct local times. */
  tz: string | null
  /** ISO 3166-1 alpha-2 country code (from OurAirports iso_country), for the flag. */
  country: string | null
  /** City the airport serves. */
  municipality: string | null
  /** Region/province name (resolved from OurAirports regions), e.g. "North Carolina". */
  region: string | null
  /** Runway-end identifiers at this airport (for manual runway selection), e.g. ["05L","23R",…]. */
  runways: string[]
}

export type SkipReason = 'already-imported' | 'no-track' | 'duplicate-id'

export interface IngestImported {
  id: string
  callsign: string
  sourceFile: string
  pointCount: number
}

export interface IngestSkipped {
  sourceFile: string
  reason: SkipReason
}

export interface IngestFailed {
  sourceFile: string
  error: string
}

/** Result of a bulk import run, returned by the /api/ingest dev endpoint and the CLI. */
export interface IngestSummary {
  imported: IngestImported[]
  skipped: IngestSkipped[]
  failed: IngestFailed[]
  manifestCount: number
  airportsCount: number
}

export interface TrackProperties {
  id: string
  callsign: string
  /** ISO 8601 timestamp per coordinate, same length/order as geometry.coordinates */
  times: string[]
}

export interface TrackFeature {
  type: 'Feature'
  properties: TrackProperties
  geometry: {
    type: 'LineString'
    /** [lon, lat, altitudeMeters] */
    coordinates: [number, number, number][]
  }
}

export type BasemapMode = 'road' | 'satellite' | 'hybrid'
export type ViewMode = '2d' | '3d' | 'tail'
