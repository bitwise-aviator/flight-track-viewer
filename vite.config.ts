import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { deleteTrack, ingestNewTracks, setRunwayOverride } from './scripts/ingest-core'

/**
 * Dev-only endpoints backing the in-app data tools, so tracks can be bulk-imported from data/raw
 * and individual flights deleted without dropping to a terminal. Not part of the production build
 * (`apply: 'serve'`), which stays a pure static site.
 */
function dataApiPlugin(): Plugin {
  return {
    name: 'flight-track-data-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/ingest', (req, res, next) => {
        if (req.method !== 'POST') return next()
        res.setHeader('Content-Type', 'application/json')
        ingestNewTracks(server.config.root)
          .then((summary) => res.end(JSON.stringify(summary)))
          .catch((e: unknown) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          })
      })

      server.middlewares.use('/api/delete', (req, res, next) => {
        if (req.method !== 'POST') return next()
        res.setHeader('Content-Type', 'application/json')
        const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id')
        if (!id) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: 'Missing id' }))
          return
        }
        deleteTrack(server.config.root, id)
          .then((result) => {
            if (!result.ok) res.statusCode = 400
            res.end(JSON.stringify(result))
          })
          .catch((e: unknown) => {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
          })
      })

      server.middlewares.use('/api/runway', (req, res, next) => {
        if (req.method !== 'POST') return next()
        res.setHeader('Content-Type', 'application/json')
        const url = new URL(req.url ?? '', 'http://localhost')
        const id = url.searchParams.get('id')
        const dir = url.searchParams.get('dir')
        const value = url.searchParams.get('value')
        if (!id || (dir !== 'departure' && dir !== 'arrival')) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: 'Expected id and dir=departure|arrival' }))
          return
        }
        try {
          const result = setRunwayOverride(server.config.root, id, dir, value)
          if (!result.ok) res.statusCode = 400
          res.end(JSON.stringify(result))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cesium(), dataApiPlugin()],
})
