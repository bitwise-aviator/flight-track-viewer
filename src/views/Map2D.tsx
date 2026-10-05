import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { GeoJsonLayer, IconLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { Feature } from 'geojson'
import { useVizStore } from '../state/vizStore'
import { maplibreStyles } from '../lib/maplibreStyles'
import { buildHeatmapPoints, type HeatPoint } from '../heatmap/buildHeatmap'
import { splitAntimeridian } from '../lib/antimeridian'
import type { Airport, TrackFeature } from '../types/track'

interface PathSegment {
  id: string
  path: [number, number][]
}

const HEATMAP_COLOR_RANGE: [number, number, number][] = [
  [0, 0, 255],
  [0, 200, 0],
  [255, 255, 0],
  [255, 140, 0],
  [220, 0, 0],
]

const FOCUS_COLOR: [number, number, number] = [255, 0, 200]
const ARRIVING_COLOR: [number, number, number] = [0, 229, 255] // cyan — flights arriving at the airport
const DEPARTING_COLOR: [number, number, number] = [130, 255, 130] // light green — flights departing
const AIRPORT_LABEL_COLOR: [number, number, number] = [255, 255, 255]
const FOCUS_LABEL_COLOR: [number, number, number] = [255, 45, 212]
const SELECTED_WIDTH = 6

// Simple map-pin glyph; tip sits at the coordinate (anchorY = full height).
function pinSvg(fill: string): string {
  return (
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">' +
        `<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${fill}" stroke="#003b46" stroke-width="1.5"/>` +
        '<circle cx="12" cy="12" r="4.5" fill="#0b0c10"/></svg>',
    )
  )
}
const PIN_CYAN = pinSvg('#00e5ff')
const PIN_MAGENTA = pinSvg('#ff2dd4')

export function Map2D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  const manifest = useVizStore((s) => s.manifest)
  const tracks = useVizStore((s) => s.tracks)
  const selectedIds = useVizStore((s) => s.selectedIds)
  const airports = useVizStore((s) => s.airports)
  const firBoundaries = useVizStore((s) => s.firBoundaries)
  const focusedId = useVizStore((s) => s.focusedId)
  const selectedAirport = useVizStore((s) => s.selectedAirport)
  const basemapMode = useVizStore((s) => s.basemapMode)
  const timeCursor = useVizStore((s) => s.timeCursor)
  const setZoom = useVizStore((s) => s.setZoom)

  // Cache each track's anti-meridian-split path segments (coords are immutable once loaded), so
  // playback re-renders don't re-split every frame.
  const segmentCache = useRef(new Map<string, PathSegment[]>())
  const segmentsFor = (track: TrackFeature): PathSegment[] => {
    const cached = segmentCache.current.get(track.properties.id)
    if (cached) return cached
    const segments = splitAntimeridian(
      track.geometry.coordinates.map(([lon, lat]): [number, number] => [lon, lat]),
    ).map((path) => ({ id: track.properties.id, path }))
    segmentCache.current.set(track.properties.id, segments)
    return segments
  }

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: maplibreStyles.road,
      center: [-40, 30],
      zoom: 2,
    })
    const overlay = new MapboxOverlay({
      layers: [],
      onClick: (info) => {
        const store = useVizStore.getState()
        if (info?.object && info.layer?.id === 'airport-pins') {
          store.selectAirport((info.object as Airport).code)
        } else if (store.selectedAirport) {
          // Click on empty map clears an airport selection (flight focus is toggled via the list).
          store.clearSelection()
        }
      },
    })
    map.addControl(overlay)
    map.on('zoom', () => setZoom(map.getZoom()))
    mapRef.current = map
    overlayRef.current = overlay

    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mapRef.current?.setStyle(maplibreStyles[basemapMode])
  }, [basemapMode])

  // Fit the map to the focused flight's full route.
  useEffect(() => {
    if (!focusedId || !mapRef.current) return
    const entry = manifest.find((m) => m.id === focusedId)
    if (!entry) return
    const [minLon, minLat, maxLon, maxLat] = entry.bbox
    mapRef.current.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 80, duration: 900 },
    )
  }, [focusedId, manifest])

  useEffect(() => {
    if (!overlayRef.current) return
    const selectedTracks = selectedIds.map((id) => tracks[id]).filter((t): t is TrackFeature => Boolean(t))
    const focusedTrack = focusedId ? tracks[focusedId] : undefined
    const layers: Layer[] = []

    // FIR boundaries as a subtle reference layer underneath everything else.
    if (firBoundaries) {
      layers.push(
        new GeoJsonLayer({
          id: 'fir-boundaries',
          data: firBoundaries,
          stroked: true,
          filled: false,
          getLineColor: [150, 170, 205, 70],
          lineWidthUnits: 'pixels',
          getLineWidth: 0.7,
          lineWidthMinPixels: 0.6,
          pickable: false,
        }),
      )
      // Highlight the FIRs the focused flight overflies.
      const focusEntry = focusedId ? manifest.find((m) => m.id === focusedId) : undefined
      if (focusEntry && focusEntry.firs.length > 0) {
        const codes = new Set(focusEntry.firs.map((f) => f.code))
        const features = firBoundaries.features.filter((f) => codes.has((f.properties?.id as string) ?? ''))
        layers.push(
          new GeoJsonLayer<Feature>({
            id: 'fir-highlight',
            data: { type: 'FeatureCollection', features },
            stroked: true,
            filled: true,
            getFillColor: [255, 0, 200, 20],
            getLineColor: [255, 122, 224, 150],
            lineWidthUnits: 'pixels',
            getLineWidth: 1.2,
            lineWidthMinPixels: 1,
            pickable: false,
          }),
        )
      }
    }

    // `magentaCodes` are the airport pins drawn magenta; `visibleCodes` (null = all) filters pins.
    let magentaCodes = new Set<string>()
    let visibleCodes: Set<string> | null = null

    if (focusedTrack) {
      // Flight focus: no heatmap. Other selected tracks white; the focused one magenta + thick.
      const focusEntry = manifest.find((m) => m.id === focusedId)
      magentaCodes = new Set([focusEntry?.origin, focusEntry?.destination].filter((c): c is string => Boolean(c)))
      visibleCodes = magentaCodes
      layers.push(
        new PathLayer<PathSegment>({
          id: 'track-paths',
          data: selectedTracks.filter((t) => t.properties.id !== focusedId).flatMap(segmentsFor),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 110],
          getWidth: 2,
          widthMinPixels: 1,
        }),
        new PathLayer<PathSegment>({
          id: 'track-focused',
          data: segmentsFor(focusedTrack),
          getPath: (d) => d.path,
          getColor: FOCUS_COLOR,
          getWidth: SELECTED_WIDTH,
          widthMinPixels: 4,
        }),
      )
    } else if (selectedAirport) {
      // Airport selection: no heatmap. Only flights to/from the airport, coloured by direction.
      const arriving: PathSegment[] = []
      const departing: PathSegment[] = []
      const relevant = new Set<string>([selectedAirport])
      for (const m of manifest) {
        if (m.origin !== selectedAirport && m.destination !== selectedAirport) continue
        if (m.origin) relevant.add(m.origin)
        if (m.destination) relevant.add(m.destination)
        const track = tracks[m.id]
        if (!track) continue
        if (m.origin === selectedAirport) departing.push(...segmentsFor(track))
        else arriving.push(...segmentsFor(track))
      }
      magentaCodes = new Set([selectedAirport])
      visibleCodes = relevant
      layers.push(
        new PathLayer<PathSegment>({
          id: 'track-arriving',
          data: arriving,
          getPath: (d) => d.path,
          getColor: ARRIVING_COLOR,
          getWidth: SELECTED_WIDTH,
          widthMinPixels: 4,
        }),
        new PathLayer<PathSegment>({
          id: 'track-departing',
          data: departing,
          getPath: (d) => d.path,
          getColor: DEPARTING_COLOR,
          getWidth: SELECTED_WIDTH,
          widthMinPixels: 4,
        }),
      )
    } else {
      layers.push(
        new HeatmapLayer<HeatPoint>({
          id: 'track-heatmap',
          data: buildHeatmapPoints(selectedTracks, timeCursor),
          getPosition: (d) => d.position,
          getWeight: (d) => d.weight,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.03,
          colorRange: HEATMAP_COLOR_RANGE,
        }),
        new PathLayer<PathSegment>({
          id: 'track-paths',
          data: selectedTracks.flatMap(segmentsFor),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 120],
          getWidth: 2,
          widthMinPixels: 1,
        }),
      )
    }

    // Airport pins + code labels (pickable), always on top. Magenta for the highlighted airport(s).
    const shownAirports = visibleCodes ? airports.filter((a) => visibleCodes!.has(a.code)) : airports
    const modeKey = `${focusedId ?? ''}|${selectedAirport ?? ''}`
    layers.push(
      new IconLayer<Airport>({
        id: 'airport-pins',
        data: shownAirports,
        pickable: true,
        getIcon: (a) => ({
          url: magentaCodes.has(a.code) ? PIN_MAGENTA : PIN_CYAN,
          width: 24,
          height: 32,
          anchorY: 32,
        }),
        getPosition: (a) => [a.lon, a.lat],
        getSize: 28,
        sizeUnits: 'pixels',
        updateTriggers: { getIcon: modeKey },
      }),
      new TextLayer<Airport>({
        id: 'airport-labels',
        data: shownAirports,
        getPosition: (a) => [a.lon, a.lat],
        getText: (a) => a.code,
        getSize: 12,
        getColor: (a) => (magentaCodes.has(a.code) ? FOCUS_LABEL_COLOR : AIRPORT_LABEL_COLOR),
        getPixelOffset: [0, -36],
        fontWeight: 700,
        background: true,
        getBackgroundColor: [0, 0, 0, 160],
        backgroundPadding: [4, 2],
        updateTriggers: { getColor: modeKey },
      }),
    )

    overlayRef.current.setProps({ layers })
  }, [selectedIds, tracks, timeCursor, focusedId, selectedAirport, airports, manifest, firBoundaries])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
