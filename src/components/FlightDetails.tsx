import { useState } from 'react'
import { useVizStore } from '../state/vizStore'
import type { Airport, ManifestEntry, RunwayStatus } from '../types/track'
import { formatLocal, formatZulu } from '../lib/time'
import { Flag } from './Flag'

const STATUS_LABEL: Record<RunwayStatus, string> = {
  auto: 'detected',
  uncertain: 'uncertain',
  manual: 'manual',
  unknown: 'not found',
}

function RunwayControl({
  runway,
  status,
  options,
  onSet,
}: {
  runway: string | null
  status: RunwayStatus
  options: string[]
  onSet: (value: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  // A settled runway — one confidently detected ("auto") or already confirmed by the user
  // ("manual") — is read-only until deliberately unlocked, to prevent accidental re-edits.
  // Unresolved ones (uncertain / unknown) are editable straight away.
  const locked = status === 'auto' || status === 'manual'
  const editable = !locked || unlocked

  const handle = async (value: string | null) => {
    setBusy(true)
    try {
      await onSet(value)
      setUnlocked(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="leg__runway">
      <span className="leg__runway-key">Runway</span>
      {editable ? (
        <select
          className={`leg__runway-select rwy-status--${status}`}
          value={runway ?? ''}
          disabled={busy}
          autoFocus={unlocked}
          onChange={(e) => handle(e.target.value || null)}
        >
          <option value="">— none —</option>
          {runway && !options.includes(runway) && <option value={runway}>{runway}</option>}
          {options.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : (
        <span className="leg__runway-value">{runway ?? '—'}</span>
      )}
      <span className={`leg__runway-status rwy-status--${status}`}>{STATUS_LABEL[status]}</span>
      {status === 'uncertain' && runway && (
        <button
          type="button"
          className="leg__runway-confirm"
          title="Confirm this runway is correct (no change needed)"
          aria-label="Confirm runway"
          disabled={busy}
          onClick={() => handle(runway)}
        >
          ✓
        </button>
      )}
      {locked &&
        (unlocked ? (
          <button type="button" className="leg__runway-change" onClick={() => setUnlocked(false)}>
            cancel
          </button>
        ) : (
          <button
            type="button"
            className="leg__runway-change"
            title={
              status === 'manual'
                ? 'You set this runway — click to change it'
                : "This runway was detected automatically — override only if it's wrong"
            }
            onClick={() => setUnlocked(true)}
          >
            change
          </button>
        ))}
    </div>
  )
}

function LegBlock({
  label,
  code,
  airport,
  iso,
  runway,
  runwayStatus,
  onSetRunway,
}: {
  label: string
  code: string | null
  airport: Airport | undefined
  iso: string
  runway: string | null
  runwayStatus: RunwayStatus
  onSetRunway: (value: string | null) => void
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
      <RunwayControl
        runway={runway}
        status={runwayStatus}
        options={airport?.runways ?? []}
        onSet={onSetRunway}
      />
    </div>
  )
}

export function FlightDetails({ entry }: { entry: ManifestEntry }) {
  const airports = useVizStore((s) => s.airports)
  const deleteFlight = useVizStore((s) => s.deleteFlight)
  const setRunway = useVizStore((s) => s.setRunway)
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

      <LegBlock
        label="Departure"
        code={entry.origin}
        airport={origin}
        iso={entry.departureTime}
        runway={entry.departureRunway}
        runwayStatus={entry.departureRunwayStatus}
        onSetRunway={(v) => setRunway(entry.id, 'departure', v)}
      />
      <LegBlock
        label="Arrival"
        code={entry.destination}
        airport={destination}
        iso={entry.arrivalTime}
        runway={entry.arrivalRunway}
        runwayStatus={entry.arrivalRunwayStatus}
        onSetRunway={(v) => setRunway(entry.id, 'arrival', v)}
      />

      {entry.firs.length > 0 && (
        <div className="firs">
          <div className="firs__label">FIRs overflown ({entry.firs.length})</div>
          <ol className="firs__list">
            {entry.firs.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <span className="firs__code">{f.code}</span>
                <span className="firs__name">{f.name}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

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
