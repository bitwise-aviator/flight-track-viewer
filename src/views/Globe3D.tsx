import { useEffect, useMemo, useRef } from 'react'
import { Entity, ImageryLayer, Viewer } from 'resium'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  HeightReference,
  JulianDate,
  SampledPositionProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer as CesiumViewer,
} from 'cesium'
import { useVizStore } from '../state/vizStore'
import { getRoadImagery, getSatelliteImagery, getWorldTerrain } from '../lib/cesiumConfig'
import type { ManifestEntry, TrackFeature } from '../types/track'

const TRACK_COLOR = Color.CYAN
const FOCUS_COLOR = Color.MAGENTA
const ARRIVE_COLOR = Color.CYAN // flights arriving at the selected airport
const DEPART_COLOR = Color.fromBytes(130, 255, 130) // light green — flights departing

function buildPositions(track: TrackFeature): Cartesian3[] {
  return track.geometry.coordinates.map(([lon, lat, alt]) => Cartesian3.fromDegrees(lon, lat, alt))
}

/** Time-dynamic position for the animated aircraft marker during playback. */
function buildPositionProperty(track: TrackFeature): SampledPositionProperty {
  const property = new SampledPositionProperty()
  const { coordinates } = track.geometry
  const { times } = track.properties
  coordinates.forEach(([lon, lat, alt], i) => {
    const time = times[i]
    if (!time) return
    property.addSample(JulianDate.fromIso8601(time), Cartesian3.fromDegrees(lon, lat, alt))
  })
  return property
}

export function Globe3D() {
  const manifest = useVizStore((s) => s.manifest)
  const tracks = useVizStore((s) => s.tracks)
  const selectedIds = useVizStore((s) => s.selectedIds)
  const airports = useVizStore((s) => s.airports)
  const focusedId = useVizStore((s) => s.focusedId)
  const selectedAirport = useVizStore((s) => s.selectedAirport)
  const basemapMode = useVizStore((s) => s.basemapMode)
  const timeCursor = useVizStore((s) => s.timeCursor)

  const terrain = useMemo(() => getWorldTerrain(), [])
  const roadImagery = useMemo(() => getRoadImagery(), [])
  const satelliteImagery = useMemo(() => getSatelliteImagery(), [])

  const viewerRef = useRef<{ cesiumElement?: CesiumViewer }>(null)

  const manifestById = useMemo(() => new Map<string, ManifestEntry>(manifest.map((m) => [m.id, m])), [manifest])
  const selectedTracks = selectedIds.map((id) => tracks[id]).filter((t): t is TrackFeature => Boolean(t))
  const selectionKey = selectedTracks.map((t) => t.properties.id).join(',')

  const trackGraphics = useMemo(() => {
    return new Map(
      selectedTracks.map((t) => [
        t.properties.id,
        { positions: buildPositions(t), marker: buildPositionProperty(t) },
      ]),
    )
    // selectionKey captures identity changes; selectedTracks is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  // Click a pin to select its airport; a click on empty globe clears an airport selection.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    const handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      const id: unknown = picked?.id?.id
      const store = useVizStore.getState()
      if (typeof id === 'string' && id.startsWith('apt-')) {
        store.selectAirport(id.slice(4))
      } else if (store.selectedAirport) {
        store.clearSelection()
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => handler.destroy()
  }, [])

  // Drive the Cesium clock from the shared time cursor (for the animated marker).
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || timeCursor == null) return
    viewer.clock.currentTime = JulianDate.fromDate(new Date(timeCursor))
  }, [timeCursor])

  // Zoom the camera to the focused flight's whole route.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || !focusedId) return
    const positions = trackGraphics.get(focusedId)?.positions
    if (!positions || positions.length === 0) return
    viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(positions), { duration: 1.2 })
  }, [focusedId, trackGraphics])

  // Which pins are highlighted magenta, and which are visible (null = all).
  let magentaCodes = new Set<string>()
  let visibleCodes: Set<string> | null = null
  if (focusedId) {
    const entry = manifestById.get(focusedId)
    magentaCodes = new Set([entry?.origin, entry?.destination].filter((c): c is string => Boolean(c)))
    visibleCodes = magentaCodes
  } else if (selectedAirport) {
    const relevant = new Set<string>([selectedAirport])
    for (const m of manifest) {
      if (m.origin === selectedAirport || m.destination === selectedAirport) {
        if (m.origin) relevant.add(m.origin)
        if (m.destination) relevant.add(m.destination)
      }
    }
    magentaCodes = new Set([selectedAirport])
    visibleCodes = relevant
  }
  const shownAirports = visibleCodes ? airports.filter((a) => visibleCodes!.has(a.code)) : airports

  return (
    <Viewer
      full
      ref={viewerRef}
      timeline={false}
      animation={false}
      infoBox={false}
      selectionIndicator={false}
      terrain={terrain}
      baseLayerPicker={false}
      homeButton={false}
      geocoder={false}
      sceneModePicker={false}
      navigationHelpButton={false}
    >
      {(basemapMode === 'satellite' || basemapMode === 'hybrid') && (
        <ImageryLayer imageryProvider={satelliteImagery} />
      )}
      {(basemapMode === 'road' || basemapMode === 'hybrid') && (
        <ImageryLayer imageryProvider={roadImagery} alpha={basemapMode === 'hybrid' ? 0.5 : 1} />
      )}
      {selectedTracks.map((track) => {
        const graphics = trackGraphics.get(track.properties.id)
        if (!graphics) return null
        const entry = manifestById.get(track.properties.id)
        const isFocused = track.properties.id === focusedId

        // In airport mode, show only related flights, coloured by direction.
        let color = TRACK_COLOR
        let width = 2
        if (selectedAirport) {
          if (entry?.origin === selectedAirport) {
            color = DEPART_COLOR
            width = 5
          } else if (entry?.destination === selectedAirport) {
            color = ARRIVE_COLOR
            width = 5
          } else {
            return null // unrelated flight — hidden while an airport is selected
          }
        } else if (isFocused) {
          color = FOCUS_COLOR
          width = 5
        }

        return (
          <Entity
            key={track.properties.id}
            id={track.properties.id}
            // Full route, always visible (independent of playback).
            polyline={{ positions: graphics.positions, width, material: new ColorMaterialProperty(color) }}
            // Animated aircraft marker, shown while the clock is within the flight's time span.
            position={graphics.marker}
            point={{ pixelSize: width > 2 ? 11 : 7, color, outlineColor: Color.BLACK, outlineWidth: 1 }}
            label={{ text: track.properties.callsign, pixelOffset: new Cartesian2(0, -18) }}
          />
        )
      })}
      {shownAirports.map((airport) => {
        const highlighted = magentaCodes.has(airport.code)
        const color = highlighted ? FOCUS_COLOR : TRACK_COLOR
        return (
          <Entity
            key={`apt-${airport.code}`}
            id={`apt-${airport.code}`}
            position={Cartesian3.fromDegrees(airport.lon, airport.lat, 0)}
            // No disableDepthTestDistance: the globe occludes pins on the far side of the Earth.
            point={{
              pixelSize: 7,
              color,
              outlineColor: Color.BLACK,
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            label={{
              text: airport.code,
              font: '12px sans-serif',
              pixelOffset: new Cartesian2(0, -14),
              fillColor: highlighted ? FOCUS_COLOR : Color.WHITE,
              showBackground: true,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
          />
        )
      })}
    </Viewer>
  )
}
