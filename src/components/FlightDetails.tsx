import { useState } from 'react'
import { useVizStore } from '../state/vizStore'
import type { Airport, ManifestEntry } from '../types/track'
import { formatLocal, formatZulu } from '../lib/time'
import { Flag } from './Flag'

function LegBlock({
  label,
  code,
  airport,
  iso,
}: {
  label: string
  code: string | null
  airport: Airport | undefined
  iso: string
}) {
  const city = [airport?.municipality, airport?.region].filter(Boolean).join(', ')
  const local = formatLocal(iso, airport?.tz ?? null)
  return (
    <div className="leg">
      <div className="leg__label">{label}</div>
      <div className="leg__head">
        <Flag country={airport?.country} />
        <span className="leg__place">
          <span className="leg__code">({code ?? '—'})</span>{' '}
          <span className="leg__name">{airport?.name ?? 'Unknown airport'}</span>
        </span>
      </div>
      {city && <div className="leg__city">{city}</div>}
      <div className="leg__time">{local ?? 'Local time unknown'}</div>
      <div className="leg__time leg__time--zulu">{formatZulu(iso)}</div>
    </div>
  )
}

export function FlightDetails({ entry }: { entry: ManifestEntry }) {
  const airports = useVizStore((s) => s.airports)
  const deleteFlight = useVizStore((s) => s.deleteFlight)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const origin = airports.find((a) => a.code === entry.origin)
  const destination = airports.find((a) => a.code === entry.destination)

  const onConfirmDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteFlight(entry.id)
      // Component unmounts on success (flight leaves the manifest).
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flight-details">
      <dl className="flight-details__grid">
        <dt>Aircraft</dt>
        <dd>{entry.aircraftModel ?? '—'}</dd>
        <dt>Registration</dt>
        <dd>{entry.registration ?? '—'}</dd>
      </dl>

      <LegBlock label="Departure" code={entry.origin} airport={origin} iso={entry.departureTime} />
      <LegBlock label="Arrival" code={entry.destination} airport={destination} iso={entry.arrivalTime} />

      <button type="button" className="flight-details__delete" onClick={() => setConfirming(true)}>
        Delete flight
      </button>
      {error && <p className="flight-details__error">{error}</p>}

      {confirming && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <p>
              Delete <strong>{entry.callsign}</strong> ({entry.date})? Its source KML is moved to
              <code> data/raw/_deleted/</code> and can be restored.
            </p>
            <div className="modal__actions">
              <button type="button" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="modal__danger" onClick={onConfirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
