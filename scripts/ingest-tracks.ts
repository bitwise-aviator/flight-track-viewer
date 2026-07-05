import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingestNewTracks } from './ingest-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rebuild = process.argv.includes('--rebuild')

const summary = await ingestNewTracks(root, { rebuild })

for (const item of summary.imported) {
  console.log(`imported  ${item.sourceFile} -> ${item.id} (${item.pointCount} points)`)
}
for (const item of summary.skipped) {
  console.log(`skipped   ${item.sourceFile} (${item.reason})`)
}
for (const item of summary.failed) {
  console.error(`failed    ${item.sourceFile}: ${item.error}`)
}

console.log(
  `\n${summary.imported.length} imported, ${summary.skipped.length} skipped, ${summary.failed.length} failed. ` +
    `Manifest now has ${summary.manifestCount} flight(s), ${summary.airportsCount} airport(s).`,
)

if (summary.failed.length > 0) process.exitCode = 1
