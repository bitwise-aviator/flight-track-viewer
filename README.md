# Flight Track Viewer

A shareable web tool for visualizing flown flight tracks (FlightRadar24 KML exports) with:

- A **2D heatmap** view (MapLibre GL + deck.gl) showing track density, colored blue → green → yellow → orange → red, with the effective radius shrinking/growing automatically with zoom.
- A **3D globe** view (CesiumJS) showing tracks at true altitude over real-world terrain.
- Satellite / road / hybrid basemap toggle, shared between both views.
- A time slider with play/pause/speed for animated playback.
- Click a flight to focus it: the list row expands with aircraft, registration, and departure/
  arrival times (airport-local with correct DST, plus Zulu) and a delete action; its track turns
  magenta and thickens, the heatmap hides, and the map zooms to the whole route.
- Airport pins (labelled with the IATA code) for every origin/destination in the dataset.

The dataset is static: KML files are converted to GeoJSON once (`npm run ingest`) and the
output is committed and deployed with the site. There's no backend — add new flights by
dropping in KML files, re-running the ingest script, committing, and redeploying.

## Data sources & attribution

- Basemaps: **© MapTiler © OpenStreetMap contributors** (shown on the 2D map) and **Cesium ion /
  Cesium World Terrain** (3D).
- Airport locations, city, and region: **[OurAirports](https://ourairports.com/data/)** —
  public-domain data, refreshed continuously. The ingest step downloads `airports.csv` and
  `regions.csv`, caching them under `data/cache/` (gitignored) and re-fetching only when older
  than 28 days.
- Airport timezones (for DST-correct local times) are derived from each airport's coordinates via
  [`tz-lookup`](https://www.npmjs.com/package/tz-lookup) at ingest time and formatted at runtime
  with the built-in `Intl` API.
- Country/territory flags: **[flagcdn.com](https://flagcdn.com)** (public-domain flag images).
  Run `npm run flags` to (re)download every ISO 3166-1 flag — including territories such as
  Taiwan, Hong Kong, and Macau — into `public/flags/w{20,40,80}/` and refresh the country-name map.
- Aircraft registration → country of registry is resolved from the ICAO nationality-mark prefixes
  ([src/lib/registrationCountry.ts](src/lib/registrationCountry.ts)), with the shared "B" prefix
  disambiguated between China, Taiwan, Hong Kong, and Macau.

## Setup

> This repository ships **without any flight data**. The raw KML exports and everything derived
> from them (per-flight GeoJSON, `manifest.json`, `airports.json`) are gitignored. Add your own
> KML files to `data/raw/` and run `npm run ingest` — see [Adding flights](#adding-flights).

```bash
npm install
cp .env.example .env
```

Fill in `.env` with two free-tier API keys:

- `VITE_CESIUM_ION_TOKEN` — from [ion.cesium.com/tokens](https://ion.cesium.com/tokens). Used for Cesium World Terrain in the 3D view. If left blank, Cesium falls back to its own rate-limited demo token, which is enough for local development.
- `VITE_MAPTILER_KEY` — from [cloud.maptiler.com/account/keys](https://cloud.maptiler.com/account/keys). Used for the road/satellite/hybrid basemap styles in the 2D view. Without it, 2D basemap tiles won't load (the heatmap/track layers still render, just without a basemap underneath).

## Adding flights

1. Export a flight's track as KML from FlightRadar24.
2. Drop the `.kml` file(s) into `data/raw/`.
3. Import them, either way:
   - **In the app (recommended):** run `npm run dev` and click **Import new tracks** in the
     sidebar. This bulk-imports every new KML in `data/raw/` and refreshes the flight list
     without leaving the browser. The Import panel is dev-only (hidden in production builds).
   - **From the terminal:** `npm run ingest`.
4. Commit the updated `data/raw/` and `public/data/` and redeploy.

Both paths do the same thing: read each KML's timed track points into a per-flight GeoJSON file
in `public/data/tracks/` and update `public/data/manifest.json` (the flight list the UI reads).
Flight number, registration, and origin/destination are pulled from the KML's metadata. The
parser handles the current FR24 export shape (one timestamped `<Point>` placemark per position)
as well as the older `<gx:Track>` form. Tracks with more than 1500 points are decimated for
browser performance.

**Imports are incremental and idempotent.** Each manifest entry records the `sourceFile` it came
from, so re-importing a folder that mixes old and new files only imports the new ones — existing
tracks are skipped (reported as "already imported"), never duplicated. A file that resolves to a
flight already present (same callsign + start time) is skipped as a duplicate, and a KML with no
usable track points (e.g. an empty FR24 export) is skipped as "no track".

To wipe and re-ingest everything from scratch, run `npm run ingest -- --rebuild`.

## Development

```bash
npm run dev
```

## Build & deploy

```bash
npm run build
```

Outputs a static site to `dist/`, deployable to any static host (Vercel, Netlify, GitHub
Pages, etc). Set the two environment variables above in your host's project settings before
building/deploying — Vite inlines `VITE_*` vars at build time.
