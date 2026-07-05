import type { BasemapMode } from '../types/track'

const key = import.meta.env.VITE_MAPTILER_KEY as string | undefined

export const maplibreStyles: Record<BasemapMode, string> = {
  road: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
  satellite: `https://api.maptiler.com/maps/satellite/style.json?key=${key}`,
  hybrid: `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`,
}
