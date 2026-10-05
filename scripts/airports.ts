import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import tzlookup from 'tz-lookup'
import type { Airport, ManifestEntry } from '../src/types/track'

/** OurAirports keeps these CSVs continuously up to date and places the data in the public domain
 * (attribution appreciated). See https://ourairports.com/data/ */
const OURAIRPORTS_BASE = 'https://davidmegginson.github.io/ourairports-data/'
const CACHE_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000 // one AIRAC cycle

export interface AirportInfo {
  ident: string // ICAO / GPS code, e.g. "KRDU" (joins to runways.csv)
  name: string
  lat: number
  lon: number
  country: string | null
  municipality: string | null
  region: string | null // iso_region code, e.g. "US-NC"
}

/** Quote-aware parse of a single CSV line (handles commas and "" inside quoted fields). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Fetches an OurAirports CSV by filename, caching it under data/cache and only re-downloading
 * when the cached copy is older than one AIRAC cycle. Falls back to a stale cache on network error. */
export async function ensureCsv(root: string, file: string): Promise<string | null> {
  const cacheDir = path.join(root, 'data', 'cache')
  const cacheFile = path.join(cacheDir, `ourairports-${file}`)
  mkdirSync(cacheDir, { recursive: true })

  const fresh = existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < CACHE_MAX_AGE_MS
  if (!fresh) {
    try {
      const res = await fetch(OURAIRPORTS_BASE + file)
      if (res.ok) {
        const text = await res.text()
        writeFileSync(cacheFile, text)
        return text
      }
    } catch {
      // fall through to a possibly-stale cache
    }
  }
  return existsSync(cacheFile) ? readFileSync(cacheFile, 'utf-8') : null
}

/** Builds an IATA-code -> airport-info lookup from the OurAirports airports CSV. */
export function parseAirports(csv: string): Map<string, AirportInfo> {
  const lines = csv.split(/\r?\n/)
  const header = parseCsvLine(lines[0])
  const idx = {
    ident: header.indexOf('ident'),
    name: header.indexOf('name'),
    lat: header.indexOf('latitude_deg'),
    lon: header.indexOf('longitude_deg'),
    iata: header.indexOf('iata_code'),
    country: header.indexOf('iso_country'),
    region: header.indexOf('iso_region'),
    municipality: header.indexOf('municipality'),
  }
  const map = new Map<string, AirportInfo>()
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const cols = parseCsvLine(lines[i])
    const iata = (cols[idx.iata] ?? '').trim().toUpperCase()
    if (iata.length !== 3) continue
    const lat = Number(cols[idx.lat])
    const lon = Number(cols[idx.lon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (!map.has(iata)) {
      map.set(iata, {
        ident: (cols[idx.ident] ?? '').trim(),
        name: cols[idx.name] ?? iata,
        lat,
        lon,
        country: cols[idx.country]?.trim().toUpperCase() || null,
        municipality: cols[idx.municipality]?.trim() || null,
        region: cols[idx.region]?.trim() || null,
      })
    }
  }
  return map
}

/** Builds an iso_region code -> region name lookup (e.g. "US-NC" -> "North Carolina"). */
function parseRegions(csv: string): Map<string, string> {
  const lines = csv.split(/\r?\n/)
  const header = parseCsvLine(lines[0])
  const codeIdx = header.indexOf('code')
  const nameIdx = header.indexOf('name')
  const map = new Map<string, string>()
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const cols = parseCsvLine(lines[i])
    const code = cols[codeIdx]?.trim()
    const name = cols[nameIdx]?.trim()
    if (code && name) map.set(code, name)
  }
  return map
}

function safeTz(lat: number, lon: number): string | null {
  try {
    return tzlookup(lat, lon)
  } catch {
    return null
  }
}

/**
 * Rebuilds `public/data/airports.json` to contain exactly the airports referenced (as origin or
 * destination) by the current manifest, with coordinates, timezone, location, and the list of
 * runway-end identifiers (for manual runway selection). The caller supplies the already-parsed
 * airport lookup and a map of ICAO ident -> runway-end idents. Returns the number written.
 */
export async function writeAirportsFile(
  root: string,
  manifest: ManifestEntry[],
  lookup: Map<string, AirportInfo>,
  runwayIdents: Map<string, string[]>,
): Promise<number> {
  const outPath = path.join(root, 'public', 'data', 'airports.json')

  const codes = new Set<string>()
  for (const m of manifest) {
    if (m.origin) codes.add(m.origin)
    if (m.destination) codes.add(m.destination)
  }
  if (codes.size === 0) {
    writeFileSync(outPath, '[]')
    return 0
  }

  const regionsCsv = await ensureCsv(root, 'regions.csv')
  const regions = regionsCsv ? parseRegions(regionsCsv) : new Map<string, string>()

  const airports: Airport[] = []
  for (const code of [...codes].sort()) {
    const info = lookup.get(code)
    if (!info) continue
    airports.push({
      code,
      name: info.name,
      lat: info.lat,
      lon: info.lon,
      tz: safeTz(info.lat, info.lon),
      country: info.country,
      municipality: info.municipality,
      region: (info.region && regions.get(info.region)) || info.region,
      runways: runwayIdents.get(info.ident) ?? [],
    })
  }

  writeFileSync(outPath, JSON.stringify(airports, null, 2))
  return airports.length
}
