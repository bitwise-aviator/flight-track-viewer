import { useEffect, useRef } from 'react'
import { useVizStore } from '../state/vizStore'

/** Drives the shared time cursor forward while playing, at `playbackSpeed` track-seconds
 * per real second. Both the 2D and 3D views read `timeCursor` from the store and react to it,
 * so this is the single place that owns the animation loop. */
export function usePlaybackClock() {
  const isPlaying = useVizStore((s) => s.isPlaying)
  const playbackSpeed = useVizStore((s) => s.playbackSpeed)
  const timeRange = useVizStore((s) => s.timeRange)
  const rafRef = useRef<number>(0)
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying || !timeRange) return

    // If the cursor is parked at the end of a previous run, rewind so Play always plays.
    const initial = useVizStore.getState()
    if (initial.timeCursor != null && initial.timeCursor >= timeRange[1]) {
      initial.setTimeCursor(timeRange[0])
    }

    lastRef.current = null
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now
      const dtMs = now - lastRef.current
      lastRef.current = now

      const state = useVizStore.getState()
      const current = state.timeCursor ?? timeRange[0]
      const next = current + dtMs * state.playbackSpeed

      if (next >= timeRange[1]) {
        state.setTimeCursor(timeRange[1])
        state.pause()
        return
      }
      state.setTimeCursor(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, playbackSpeed, timeRange])
}
