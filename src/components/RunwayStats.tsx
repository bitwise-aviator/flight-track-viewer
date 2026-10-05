import { useMemo } from 'react'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type TooltipItem } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useVizStore } from '../state/vizStore'
import type { ManifestEntry } from '../types/track'

ChartJS.register(ArcElement, Tooltip, Legend)

const PALETTE = [
  '#35e0ff',
  '#82ff82',
  '#ffcf5c',
  '#ff8f5c',
  '#c084fc',
  '#5ca8ff',
  '#ff6bd6',
  '#7be0c0',
  '#ffd0a0',
  '#b0b6c0',
]
const UNKNOWN_COLOR = '#55596a'

interface Slice {
  label: string
  value: number
  color: string
}

function countByRunway(entries: ManifestEntry[], pick: (e: ManifestEntry) => string | null): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const key = pick(e) ?? 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Orders a direction's runways biggest-first (Unknown last) and colours them from a shared map. */
function toSlices(counts: Map<string, number>, colorFor: (label: string) => string): Slice[] {
  return [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === 'Unknown') return 1
      if (b[0] === 'Unknown') return -1
      return b[1] - a[1]
    })
    .map(([label, value]) => ({ label, value, color: colorFor(label) }))
}

/**
 * Builds one colour per runway shared across both charts, so e.g. "23R" is the same colour whether
 * it's a departure or an arrival. Busiest runways (summed over both directions) get the first
 * palette entries; "Unknown" is always grey.
 */
function buildColorMap(dep: Map<string, number>, arr: Map<string, number>): (label: string) => string {
  const totals = new Map<string, number>()
  for (const [k, v] of dep) if (k !== 'Unknown') totals.set(k, (totals.get(k) ?? 0) + v)
  for (const [k, v] of arr) if (k !== 'Unknown') totals.set(k, (totals.get(k) ?? 0) + v)
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const map = new Map<string, string>()
  ordered.forEach(([label], i) => map.set(label, PALETTE[i % PALETTE.length]))
  return (label) => (label === 'Unknown' ? UNKNOWN_COLOR : (map.get(label) ?? UNKNOWN_COLOR))
}

function RunwayPie({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((n, s) => n + s.value, 0)

  const data = {
    labels: slices.map((s) => s.label),
    datasets: [
      {
        data: slices.map((s) => s.value),
        backgroundColor: slices.map((s) => s.color),
        borderColor: '#16171d',
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  }

  const options = {
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: {
        position: 'right' as const,
        labels: { color: '#c7cad2', boxWidth: 12, boxHeight: 12, font: { size: 11 }, padding: 6 },
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'doughnut'>) => {
            const value = ctx.parsed
            const pct = total ? Math.round((value / total) * 100) : 0
            return ` ${ctx.label}: ${value} flight${value === 1 ? '' : 's'} (${pct}%)`
          },
        },
      },
    },
  }

  return (
    <div className="runway-pie">
      <h4 className="runway-pie__title">
        {title} <span className="runway-pie__total">{total}</span>
      </h4>
      {total === 0 ? (
        <p className="runway-pie__empty">No flights</p>
      ) : (
        <div className="runway-pie__canvas">
          <Doughnut data={data} options={options} />
        </div>
      )}
    </div>
  )
}

export function RunwayStats() {
  const selectedAirport = useVizStore((s) => s.selectedAirport)
  const manifest = useVizStore((s) => s.manifest)

  const { departures, arrivals } = useMemo(() => {
    const deps = selectedAirport ? manifest.filter((m) => m.origin === selectedAirport) : []
    const arrs = selectedAirport ? manifest.filter((m) => m.destination === selectedAirport) : []
    const depCounts = countByRunway(deps, (e) => e.departureRunway)
    const arrCounts = countByRunway(arrs, (e) => e.arrivalRunway)
    const colorFor = buildColorMap(depCounts, arrCounts)
    return {
      departures: toSlices(depCounts, colorFor),
      arrivals: toSlices(arrCounts, colorFor),
    }
  }, [selectedAirport, manifest])

  if (!selectedAirport) return null

  return (
    <div className="runway-stats">
      <h3 className="runway-stats__heading">{selectedAirport} runway usage</h3>
      <RunwayPie title="Departures" slices={departures} />
      <RunwayPie title="Arrivals" slices={arrivals} />
    </div>
  )
}
