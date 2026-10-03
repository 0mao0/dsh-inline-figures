// Evidence for the loader design in index.js, and a smoke test of the exact
// routes it uses. Run it from any plugin install dir:
//     node scripts/_validate-loader.mjs
// It proves: (a) both staged copies load BY FILE URL and rasterize an SVG,
// (b) what a bare import('sharp') WOULD have resolved to in this layout.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const pluginDir = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '')
const LOCAL = path.join(pluginDir, 'node_modules', 'sharp', 'dist', 'index.cjs')
const STAGED = path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js', 'sharp', 'dist', 'index.cjs')

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120"><rect x="10" y="10" width="120" height="60" fill="#3b82f6" rx="6"/><text x="24" y="46" font-size="16" fill="#fff">ok</text></svg>'

async function check(label, entry) {
  if (!fs.existsSync(entry)) return console.log(`SKIP ${label}: not staged at ${entry}`)
  try {
    const mod = await import(pathToFileURL(entry).href)
    const sharp = mod.default ?? mod
    const png = await sharp(Buffer.from(SVG)).resize({ width: 1360 }).png().toBuffer()
    const magic = png.subarray(0, 4).toString('hex')
    console.log(`PASS ${label}: ${entry}`)
    console.log(`     PNG ${png.length} bytes, magic ${magic}${magic === '89504e47' ? '' : ' (NOT a PNG!)'}`)
    if (magic !== '89504e47') process.exitCode = 1
  } catch (error) {
    console.log(`FAIL ${label}: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}

await check('layer 1 (plugin-local)', LOCAL)
await check('layer 2 (shared cache)', STAGED)

// Why the shipped loader names the entry file instead of a bare import: this
// prints where node_modules resolution lands, which differs per layout.
try {
  const resolved = (await import.meta.resolve?.('sharp')) ?? '(no import.meta.resolve)'
  console.log(`INFO bare import('sharp') resolves to: ${resolved}`)
  if (!String(resolved).startsWith(pathToFileURL(pluginDir).href)) {
    console.log('     ^ OUTSIDE this plugin dir - resolution is layout-dependent, which is why the loader uses explicit file URLs.')
  }
} catch (error) {
  console.log(`INFO bare import('sharp') does not resolve here: ${String(error?.message ?? error).split('\n')[0]}`)
}
