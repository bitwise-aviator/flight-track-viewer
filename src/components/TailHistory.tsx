import { useEffect, useMemo } from 'react'
import { useVizStore } from '../state/vizStore'
import type { Airport, ManifestEntry } from '../types/track'
import { displayRegistration, modelName, registrationKey } from '../lib/aircraft'
import { registrationCountry } from '../lib/registrationCountry'
import { localDate } from '../lib/time'
import { Flag } from './Flag'

interface TailGroup {
  key: string
  registration: string
  flights: ManifestEntry[]
}

interface TypeGroup {
  type: string
  model: string
  tailCount: number
  tails: TailGroup[]
}

function buildGroups(manifest: ManifestEntry[]): TypeGroup[] {
  // type code -> registration key -> flights
  const byType = new Map<string, { model: string; tails: Map<string, { regs: Set<string>; flights: ManifestEntry[] }> }>()

  for (const entry of manifest) {
    if (!entry.registration) continue // a tail can't be tracked without a registration
    const type = entry.aircraftType ?? 'UNKNOWN'
    let typeBucket = byType.get(type)
    if (!typeBucket) {
      typeBucket = { model: modelName(entry.aircraftType, entry.aircraftModel), tails: new Map() }
      byType.set(type, typeBucket)
    }
    const regKey = registrationKey(entry.registration)
    let tail = typeBucket.tails.get(regKey)
    if (!tail) {
      tail = { regs: new Set(), flights: [] }
      typeBucket.tails.set(regKey, tail)
    }
    tail.regs.add(entry.registration)
    tail.flights.push(entry)
  }

  const types: TypeGroup[] = [...byType.entries()].map(([type, bucket]) => {
    const tails: TailGroup[] = [...bucket.tails.entries()]
      .map(([key, t]) => ({
        key,
        registration: displayRegistration([...t.regs]),
        flights: t.flights.sort((a, b) => Date.parse(b.departureTime) - Date.parse(a.departureTime)),
      }))
      .sort((a, b) => a.registration.localeCompare(b.registration))
    return { type, model: bucket.model, tailCount: tails.length, tails }
  })

  // Sort by the readable model name, not the code.
  return types.sort((a, b) => a.model.localeCompare(b.model))
}

export function TailHistory() {
  const manifest = useVizStore((s) => s.manifest)
  const airports = useVizStore((s) => s.airports)
  const setViewMode = useVizStore((s) => s.setViewMode)
  const focusFlight = useVizStore((s) => s.focusFlight)
  const loadManifest = useVizStore((s) => s.loadManifest)
  const loadAirports = useVizStore((s) => s.loadAirports)

  // Defensive: ensure data is present even if this tab is opened before the map views populate it.
  useEffect(() => {
    if (manifest.length === 0) loadManifest().catch((err: unknown) => console.error(err))
    if (airports.length === 0) loadAirports().catch((err: unknown) => console.error(err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tzByCode = useMemo(
    () => new Map<string, Airport['tz']>(airports.map((a) => [a.code, a.tz])),
    [airports],
  )
  const groups = useMemo(() => buildGroups(manifest), [manifest])
  const withReg = manifest.filter((m) => m.registration).length

  const openFlight = (id: string) => {
    focusFlight(id)
    setViewMode('2d')
  }

  return (
    <div className="tail-history">
      <div className="tail-history__intro">
        <h2>Tail History</h2>
        <p>
          {groups.length} models · {groups.reduce((n, g) => n + g.tailCount, 0)} unique aircraft ·{' '}
          {withReg} flights
        </p>
      </div>

      {groups.map((typeGroup) => (
        <section key={typeGroup.type} className="tail-model">
          <h3 className="tail-model__name">
            {typeGroup.model} <span className="tail-model__code">{typeGroup.type}</span>
            <span className="tail-model__count">{typeGroup.tailCount} aircraft</span>
          </h3>

          {typeGroup.tails.map((tail) => (
            <div key={tail.key} className="tail">
              <div className="tail__reg">
                <Flag country={registrationCountry(tail.registration)} />
                {tail.registration}
                <span className="tail__flights-count">
                  {tail.flights.length} {tail.flights.length === 1 ? 'flight' : 'flights'}
                </span>
              </div>
              <ul className="tail__flights">
                {tail.flights.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="tail-flight" onClick={() => openFlight(f.id)}>
                      <span className="tail-flight__num">{f.callsign}</span>
                      <span className="tail-flight__date">
                        {localDate(f.departureTime, f.origin ? tzByCode.get(f.origin) : null)}
                      </span>
                      <span className="tail-flight__route">
                        {f.origin ?? '?'} → {f.destination ?? '?'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
