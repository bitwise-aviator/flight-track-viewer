import { lazy, Suspense, useEffect } from 'react'
import './App.css'
import { useVizStore } from './state/vizStore'
import { usePlaybackClock } from './hooks/usePlaybackClock'
import { FlightList } from './components/FlightList'
import { ImportPanel } from './components/ImportPanel'
import { TimeSlider } from './components/TimeSlider'
import { LayerToggle } from './components/LayerToggle'
import { TailHistory } from './components/TailHistory'
import type { TrackFeature } from './types/track'

// Cesium and MapLibre/deck.gl are each sizeable; only the active view's code should load.
const Map2D = lazy(() => import('./views/Map2D').then((m) => ({ default: m.Map2D })))
const Globe3D = lazy(() => import('./views/Globe3D').then((m) => ({ default: m.Globe3D })))

function App() {
  const viewMode = useVizStore((s) => s.viewMode)
  const setViewMode = useVizStore((s) => s.setViewMode)
  const selectedIds = useVizStore((s) => s.selectedIds)
  const tracks = useVizStore((s) => s.tracks)
  const timeCursor = useVizStore((s) => s.timeCursor)
  const setTimeRange = useVizStore((s) => s.setTimeRange)
  const setTimeCursor = useVizStore((s) => s.setTimeCursor)

  usePlaybackClock()

  useEffect(() => {
    const selectedTracks = selectedIds
      .map((id) => tracks[id])
      .filter((t): t is TrackFeature => Boolean(t))

    if (selectedTracks.length === 0) {
      setTimeRange(null)
      return
    }

    let min = Infinity
    let max = -Infinity
    for (const track of selectedTracks) {
      for (const iso of track.properties.times) {
        const ms = new Date(iso).getTime()
        if (ms < min) min = ms
        if (ms > max) max = ms
      }
    }
    setTimeRange([min, max])
    // Leave timeCursor null so the full heatmap shows by default; only clamp a cursor the user
    // has already scrubbed to if it now falls outside the (re)computed range.
    if (timeCursor != null && (timeCursor < min || timeCursor > max)) {
      setTimeCursor(max)
    }
    // timeCursor is intentionally excluded: this effect only reacts to selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, tracks, setTimeRange, setTimeCursor])

  return (
    <div className="app">
      <header className="app__header">
        <h1>Flight Track Viewer</h1>
        <div className="app__mode-switch">
          <button type="button" className={viewMode === '2d' ? 'active' : ''} onClick={() => setViewMode('2d')}>
            2D Heatmap
          </button>
          <button type="button" className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>
            3D Track Viewer
          </button>
          <button type="button" className={viewMode === 'tail' ? 'active' : ''} onClick={() => setViewMode('tail')}>
            Tail History
          </button>
        </div>
        {viewMode !== 'tail' && <LayerToggle />}
      </header>
      {viewMode === 'tail' ? (
        <div className="app__body">
          <main className="app__tail">
            <TailHistory />
          </main>
        </div>
      ) : (
        <>
          <div className="app__body">
            <aside className="app__sidebar">
              <FlightList />
              <ImportPanel />
              <p className="app__attribution">
                Airports:{' '}
                <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">
                  OurAirports
                </a>{' '}
                (public domain). Basemaps © MapTiler, © OpenStreetMap, Cesium.
              </p>
            </aside>
            <main className="app__view">
              <Suspense fallback={<div className="app__view-loading">Loading…</div>}>
                {viewMode === '2d' ? <Map2D /> : <Globe3D />}
              </Suspense>
            </main>
          </div>
          <footer className="app__footer">
            <TimeSlider />
          </footer>
        </>
      )}
    </div>
  )
}

export default App
