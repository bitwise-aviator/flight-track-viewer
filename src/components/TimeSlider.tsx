import { useVizStore } from '../state/vizStore'

const SPEED_OPTIONS = [10, 30, 60, 120, 300]

function formatTime(ms: number): string {
  // Data can span years, so show date + time (UTC).
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

export function TimeSlider() {
  const timeRange = useVizStore((s) => s.timeRange)
  const timeCursor = useVizStore((s) => s.timeCursor)
  const isPlaying = useVizStore((s) => s.isPlaying)
  const playbackSpeed = useVizStore((s) => s.playbackSpeed)
  const setTimeCursor = useVizStore((s) => s.setTimeCursor)
  const togglePlaying = useVizStore((s) => s.togglePlaying)
  const setPlaybackSpeed = useVizStore((s) => s.setPlaybackSpeed)

  if (!timeRange) {
    return <div className="time-slider time-slider--empty">Select one or more flights to enable playback</div>
  }

  const [start, end] = timeRange
  // A null cursor means "show everything" — park the handle at the end and label it accordingly.
  const atFull = timeCursor == null
  const current = timeCursor ?? end

  return (
    <div className="time-slider">
      <button type="button" onClick={togglePlaying}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min={start}
        max={end}
        step={1000}
        value={current}
        onChange={(e) => setTimeCursor(Number(e.target.value))}
      />
      <span className="time-slider__time">{atFull ? 'All flights' : formatTime(current)}</span>
      <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(Number(e.target.value))}>
        {SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed}>
            {speed}x
          </option>
        ))}
      </select>
    </div>
  )
}
