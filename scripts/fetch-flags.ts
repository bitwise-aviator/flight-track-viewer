import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Downloads country/territory flags from flagcdn.com (public-domain flag images) into
 * public/flags/w{20,40,80}/{code}.png for every ISO 3166-1 code it serves — which includes
 * autonomous and disputed territories (Taiwan, Hong Kong, Macau, etc.). Idempotent: existing
 * files are skipped unless `--force` is passed. Run with `npm run flags`.
 */
const SIZES = [20, 40, 80] as const
const CODES_URL = 'https://flagcdn.com/en/codes.json'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'flags')
const force = process.argv.includes('--force')

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await worker(items[i++])
    }),
  )
}

async function main() {
  const names = (await (await fetch(CODES_URL)).json()) as Record<string, string>
  const codes = Object.keys(names)
  console.log(`Fetching flags for ${codes.length} codes at sizes ${SIZES.join(', ')} (w px)…`)

  // Save the code -> country name map for UI tooltips.
  writeFileSync(path.join(ROOT, 'src', 'lib', 'countryNames.json'), JSON.stringify(names))

  for (const size of SIZES) mkdirSync(path.join(OUT_DIR, `w${size}`), { recursive: true })

  const jobs = codes.flatMap((code) => SIZES.map((size) => ({ code, size })))
  let downloaded = 0
  let skipped = 0
  let failed = 0

  await runPool(jobs, 20, async ({ code, size }) => {
    const dest = path.join(OUT_DIR, `w${size}`, `${code}.png`)
    if (!force && existsSync(dest)) {
      skipped++
      return
    }
    try {
      const res = await fetch(`https://flagcdn.com/w${size}/${code}.png`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      downloaded++
    } catch (e) {
      failed++
      console.warn(`  failed ${code} w${size}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  console.log(`Done. ${downloaded} downloaded, ${skipped} skipped, ${failed} failed → ${path.relative(ROOT, OUT_DIR)}`)
}

main()
