import { useState } from 'react'
import { useVizStore } from '../state/vizStore'
import type { IngestSummary } from '../types/track'

/**
 * Dev-only bulk-import control. Triggers the /api/ingest endpoint (served by the Vite dev
 * plugin), which converts any new KML in data/raw into GeoJSON and refreshes the manifest.
 * Hidden in production builds, where the dataset is static and updated via redeploy.
 */
export function ImportPanel() {
  const loadManifest = useVizStore((s) => s.loadManifest)
  const selectAll = useVizStore((s) => s.selectAll)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<IngestSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!import.meta.env.DEV) return null

  const runImport = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ingest', { method: 'POST' })
      const data = (await res.json()) as IngestSummary & { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? `Import failed (HTTP ${res.status})`)
      setSummary(data)
      await loadManifest()
      // Newly imported flights should appear toggled on, consistent with the startup default.
      await selectAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const alreadyImported = summary?.skipped.filter((s) => s.reason === 'already-imported').length ?? 0
  const otherSkipped = (summary?.skipped.length ?? 0) - alreadyImported

  return (
    <div className="import-panel">
      <h2>Import tracks</h2>
      <p className="import-panel__hint">
        Reads new KML files from <code>data/raw/</code>. Tracks already imported are skipped.
      </p>
      <button type="button" onClick={runImport} disabled={busy}>
        {busy ? 'Importing…' : 'Import new tracks'}
      </button>

      {error && <p className="import-panel__error">{error}</p>}

      {summary && !error && (
        <div className="import-panel__summary">
          <div>
            <strong>{summary.imported.length}</strong> imported
          </div>
          <div>
            <strong>{alreadyImported}</strong> already imported (skipped)
          </div>
          {otherSkipped > 0 && (
            <div>
              <strong>{otherSkipped}</strong> skipped (no track / duplicate)
            </div>
          )}
          {summary.failed.length > 0 && (
            <div className="import-panel__error">
              <strong>{summary.failed.length}</strong> failed
            </div>
          )}
          {summary.imported.length > 0 && (
            <ul>
              {summary.imported.map((item) => (
                <li key={item.id}>
                  {item.callsign} <span className="import-panel__muted">({item.pointCount} pts)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
