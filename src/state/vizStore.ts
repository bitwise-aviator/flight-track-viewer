import { create } from 'zustand'
import type { Airport, BasemapMode, ManifestEntry, TrackFeature, ViewMode } from '../types/track'

interface VizState {
  manifest: ManifestEntry[]
  tracks: Record<string, TrackFeature>
  selectedIds: string[]
  airports: Airport[]
  /** The single flight the user has clicked to inspect; drives the detail panel + map focus.
   * Mutually exclusive with `selectedAirport`. */
  focusedId: string | null
  /** The airport (IATA code) the user has clicked; mutually exclusive with `focusedId`. */
  selectedAirport: string | null

  /** epoch ms, null until a time range is known */
  timeCursor: number | null
  timeRange: [number, number] | null
  isPlaying: boolean
  playbackSpeed: number

  /** 2D map zoom level, drives the heatmap's effective radius */
  zoom: number
  basemapMode: BasemapMode
  viewMode: ViewMode

  setManifest: (manifest: ManifestEntry[]) => void
  /** Fetches (or re-fetches) the published manifest and replaces the flight list. */
  loadManifest: () => Promise<void>
  /** Fetches the airport list (referenced origins/destinations) for the map pins. */
  loadAirports: () => Promise<void>
  setTrack: (id: string, track: TrackFeature) => void
  /** Fetches a track's GeoJSON if not already loaded. */
  loadTrack: (id: string) => Promise<void>
  toggleSelected: (id: string) => void
  /** Selects every flight in the manifest and loads all their tracks (startup default). */
  selectAll: () => Promise<void>
  setSelectedIds: (ids: string[]) => void
  /** Toggles single-flight focus; clears if the same flight is clicked again. Clears any airport. */
  focusFlight: (id: string) => void
  clearFocus: () => void
  /** Toggles airport selection; clicking the same airport again clears it. Clears any flight focus. */
  selectAirport: (code: string) => void
  /** Clears both flight focus and airport selection (e.g. a click on empty map). */
  clearSelection: () => void
  /** Deletes a flight via the dev endpoint, then refreshes the dataset. */
  deleteFlight: (id: string) => Promise<void>
  /** Sets (or clears, with null) a flight's departure/arrival runway via the dev endpoint. */
  setRunway: (id: string, direction: 'departure' | 'arrival', value: string | null) => Promise<void>
  setTimeCursor: (t: number) => void
  setTimeRange: (range: [number, number] | null) => void
  play: () => void
  pause: () => void
  togglePlaying: () => void
  setPlaybackSpeed: (speed: number) => void
  setZoom: (zoom: number) => void
  setBasemapMode: (mode: BasemapMode) => void
  setViewMode: (mode: ViewMode) => void
}

/** Loads track GeoJSONs with a bounded number of concurrent fetches. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

export const useVizStore = create<VizState>((set, get) => ({
  manifest: [],
  tracks: {},
  selectedIds: [],
  airports: [],
  focusedId: null,
  selectedAirport: null,

  timeCursor: null,
  timeRange: null,
  isPlaying: false,
  playbackSpeed: 30,

  zoom: 6,
  basemapMode: 'road',
  viewMode: '2d',

  setManifest: (manifest) => set({ manifest }),
  loadManifest: async () => {
    // Cache-bust so a fresh import is reflected immediately rather than served from HTTP cache.
    const res = await fetch(`${import.meta.env.BASE_URL}data/manifest.json?t=${Date.now()}`)
    if (!res.ok) throw new Error(`Failed to load manifest (HTTP ${res.status})`)
    set({ manifest: (await res.json()) as ManifestEntry[] })
  },
  loadAirports: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}data/airports.json?t=${Date.now()}`)
    if (!res.ok) {
      set({ airports: [] })
      return
    }
    set({ airports: (await res.json()) as Airport[] })
  },
  setTrack: (id, track) => set((s) => ({ tracks: { ...s.tracks, [id]: track } })),
  loadTrack: async (id) => {
    if (get().tracks[id]) return
    const res = await fetch(`${import.meta.env.BASE_URL}data/tracks/${id}.geojson`)
    if (!res.ok) throw new Error(`Failed to load track ${id} (HTTP ${res.status})`)
    const track = (await res.json()) as TrackFeature
    set((s) => ({ tracks: { ...s.tracks, [id]: track } }))
  },
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((existing) => existing !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: async () => {
    const ids = get().manifest.map((m) => m.id)
    set({ selectedIds: ids })
    await runPool(ids, 12, (id) =>
      get()
        .loadTrack(id)
        .catch((err: unknown) => console.error('Failed to load track', id, err)),
    )
  },
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  focusFlight: (id) => {
    const next = get().focusedId === id ? null : id
    set({ focusedId: next, selectedAirport: null })
    if (next) {
      get()
        .loadTrack(next)
        .catch((err: unknown) => console.error('Failed to load focused track', next, err))
    }
  },
  clearFocus: () => set({ focusedId: null }),
  selectAirport: (code) => {
    const next = get().selectedAirport === code ? null : code
    set({ selectedAirport: next, focusedId: null })
    if (next) {
      // Make sure the tracks for this airport's flights are loaded so they can be drawn.
      const related = get().manifest.filter((m) => m.origin === next || m.destination === next)
      void runPool(related, 12, (m) =>
        get()
          .loadTrack(m.id)
          .catch((err: unknown) => console.error('Failed to load track', m.id, err)),
      )
    }
  },
  clearSelection: () => set({ focusedId: null, selectedAirport: null }),
  deleteFlight: async (id) => {
    const res = await fetch(`/api/delete?id=${encodeURIComponent(id)}`, { method: 'POST' })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!res.ok || !data.ok) throw new Error(data.error ?? `Delete failed (HTTP ${res.status})`)
    set((s) => ({
      focusedId: s.focusedId === id ? null : s.focusedId,
      selectedIds: s.selectedIds.filter((existing) => existing !== id),
    }))
    await get().loadManifest()
    await get().loadAirports()
    await get().selectAll()
  },
  setRunway: async (id, direction, value) => {
    const url = `/api/runway?id=${encodeURIComponent(id)}&dir=${direction}&value=${encodeURIComponent(value ?? '')}`
    const res = await fetch(url, { method: 'POST' })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!res.ok || !data.ok) throw new Error(data.error ?? `Failed to set runway (HTTP ${res.status})`)
    await get().loadManifest()
  },
  setTimeCursor: (t) => set({ timeCursor: t }),
  setTimeRange: (range) => set({ timeRange: range }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setZoom: (zoom) => set({ zoom }),
  setBasemapMode: (mode) => set({ basemapMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
}))
