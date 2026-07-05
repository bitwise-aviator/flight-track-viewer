import { useVizStore } from '../state/vizStore'
import type { BasemapMode } from '../types/track'

const OPTIONS: { mode: BasemapMode; label: string }[] = [
  { mode: 'road', label: 'Road' },
  { mode: 'satellite', label: 'Satellite' },
  { mode: 'hybrid', label: 'Hybrid' },
]

export function LayerToggle() {
  const basemapMode = useVizStore((s) => s.basemapMode)
  const setBasemapMode = useVizStore((s) => s.setBasemapMode)

  return (
    <div className="layer-toggle">
      {OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          className={mode === basemapMode ? 'active' : ''}
          onClick={() => setBasemapMode(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
