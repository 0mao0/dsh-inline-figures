// Rasterize a hand-authored raw_svg THROUGH THE REAL ENGINE (sanitize + theme
// stylesheet injection, exactly like index.js), then write the .png/.svg pair
// into the workspace figure dir so the GUI can preview it inline.
// Usage: node _render-png.mjs <src.svg> <out-stem>
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [srcSvg, outStem] = process.argv.slice(2)
// Workspace root: 3rd argument, else $DSH_WORKSPACE, else the current directory.
const workspace = process.argv[4] ?? process.env.DSH_WORKSPACE ?? process.cwd()
const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(workspace, '.dsh-figures', 'fallback')
fs.mkdirSync(outDir, { recursive: true })

// 1) Real engine: validate + sanitize + inject the theme stylesheet.
const { drawFigure, validateSpec } = await import(pathToFileURL(path.join(pluginDir, 'lib', 'engine.js')).href)
const spec = { kind: 'raw_svg', svg: fs.readFileSync(srcSvg, 'utf8') }
const errors = validateSpec(spec)
if (errors.length > 0) {
  console.error('spec invalid:', errors.map((e) => `${e.path}: ${e.message}`).join('; '))
  process.exit(2)
}
const { svg, warnings } = drawFigure(spec)

// 2) Rasterize with the staged sharp, 2x width (same as index.js).
const entry = path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js', 'sharp', 'dist', 'index.cjs')
const mod = await import(pathToFileURL(entry).href)
const sharp = mod.default ?? mod
const width = Number(/viewBox="0 0 (\d+)/.exec(svg)[1])
const png = await sharp(Buffer.from(svg)).resize({ width: width * 2 }).png().toBuffer()

fs.writeFileSync(path.join(outDir, `${outStem}.png`), png)
fs.writeFileSync(path.join(outDir, `${outStem}.svg`), svg)
console.log(`wrote ${outStem}.png (${png.length} bytes, ${width * 2}px wide, magic ${png.subarray(0, 4).toString('hex')})`)
console.log(`warnings: ${warnings.length ? warnings.join('; ') : 'none'}`)
console.log(`markdown: ![](.dsh-figures/fallback/${outStem}.png)`)
