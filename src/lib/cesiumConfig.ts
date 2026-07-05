import { Ion, IonImageryProvider, OpenStreetMapImageryProvider, Terrain } from 'cesium'

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined
if (ionToken) {
  Ion.defaultAccessToken = ionToken
}

/** Cesium World Terrain (ion asset 1) — global DEM streamed via the ion token. */
export function getWorldTerrain(): Terrain {
  return Terrain.fromWorldTerrain({ requestVertexNormals: true })
}

/** Cesium World Imagery (ion asset 2) — used for the "satellite" and "hybrid" basemaps. */
export function getSatelliteImagery(): Promise<IonImageryProvider> {
  return IonImageryProvider.fromAssetId(2)
}

/** OpenStreetMap raster tiles — no API key required, used for the "road" basemap and as a
 * label/road overlay on top of satellite imagery for the "hybrid" basemap. */
export function getRoadImagery(): OpenStreetMapImageryProvider {
  return new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
}
