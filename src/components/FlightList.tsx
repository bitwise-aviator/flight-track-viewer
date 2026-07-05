import { useEffect, useMemo } from 'react'
import { useVizStore } from '../state/vizStore'
import type { Airport, ManifestEntry } from '../types/track'
import { localDate } from '../lib/time'
import { FlightDetails } from './FlightDetails'

interface DecoratedFlight {
  entry: ManifestEntry
  /** Local calendar date of departure (origin timezone), shown in the collapsed row. */
  localDay: string
}

interface YearGroup {
  year: string
  flights: DecoratedFlight[]
}

/**
 * Groups flights by the (local) year of departure, years descending. Within a year, flights are
 * sorted by absolute Zulu departure time, most-recent first — so same-day departures order by time.
 */
function groupByYear(flights: DecoratedFlight[]): YearGroup[] {
  const byYear = new Map<string, DecoratedFlight[]>()
  for (const f of flights) {
    const year = f.localDay.slice(0, 4)
    const bucket = byYear.get(year)
    if (bucket) bucket.push(f)
    else byYear.set(year, [f])
  }
  return [...byYear.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((year) => ({
      year,
      flights: byYear
        .get(year)!
        .sort((a, b) => Date.parse(b.entry.departureTime) - Date.parse(a.entry.departureTime)),
    }))
}

export function FlightList() {
  const manifest = useVizStore((s) => s.manifest)
  const airports = useVizStore((s) => s.airports)
  const selectedIds = useVizStore((s) => s.selectedIds)
  const focusedId = useVizStore((s) => s.focusedId)
  const selectedAirport = useVizStore((s) => s.selectedAirport)
  const loadManifest = useVizStore((s) => s.loadManifest)
  const loadAirports = useVizStore((s) => s.loadAirports)
  const loadTrack = useVizStore((s) => s.loadTrack)
  const selectAll = useVizStore((s) => s.selectAll)
  const toggleSelected = useVizStore((s) => s.toggleSelected)
  const focusFlight = useVizStore((s) => s.focusFlight)

  // On startup: load airports (for pins + local dates), the manifest, then toggle every flight on.
  useEffect(() => {
    loadAirports().catch((err: unknown) => console.error('Failed to load airports', err))
    loadManifest()
      .then(() => selectAll())
      .catch((err: unknown) => console.error('Failed to load flights', err))
  }, [loadManifest, loadAirports, selectAll])

  const airportByCode = useMemo(() => new Map<string, Airport>(airports.map((a) => [a.code, a])), [airports])

  const groups = useMemo(() => {
    const visible = selectedAirport
      ? manifest.filter((m) => m.origin === selectedAirport || m.destination === selectedAirport)
      : manifest
    const decorated: DecoratedFlight[] = visible.map((entry) => ({
      entry,
      localDay: localDate(entry.departureTime, entry.origin ? airportByCode.get(entry.origin)?.tz : null),
    }))
    return groupByYear(decorated)
  }, [manifest, selectedAirport, airportByCode])

  const selected = new Set(selectedIds)
  const totalVisible = groups.reduce((n, g) => n + g.flights.length, 0)

  const handleToggleHeatmap = (entry: ManifestEntry) => {
    toggleSelected(entry.id)
    loadTrack(entry.id).catch((err: unknown) => console.error('Failed to load track', entry.id, err))
  }

  return (
    <div className="flight-list">
      <h2>
        Flights ({totalVisible}){selectedAirport ? ` · ${selectedAirport}` : ''}
      </h2>
      {groups.map((group) => (
        <div key={group.year} className="flight-list__group">
          <h3 className="flight-list__year">{group.year}</h3>
          <ul>
            {group.flights.map(({ entry, localDay }) => {
              const isFocused = focusedId === entry.id
              // In airport mode, colour the label by direction relative to the selected airport.
              const dirClass = selectedAirport
                ? entry.origin === selectedAirport
                  ? 'flight-row__label--dep'
                  : 'flight-row__label--arr'
                : ''
              return (
                <li
                  key={entry.id}
                  className={isFocused ? 'flight-list__item flight-list__item--focused' : 'flight-list__item'}
                >
                  <div className="flight-row">
                    <input
                      type="checkbox"
                      title="Show in heatmap"
                      checked={selected.has(entry.id)}
                      onChange={() => handleToggleHeatmap(entry)}
                    />
                    <button
                      type="button"
                      className={`flight-row__label ${dirClass}`}
                      onClick={() => focusFlight(entry.id)}
                    >
                      {entry.callsign} — {localDay}
                      {entry.origin && entry.destination ? ` (${entry.origin} → ${entry.destination})` : ''}
                    </button>
                  </div>
                  {isFocused && <FlightDetails entry={entry} />}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
