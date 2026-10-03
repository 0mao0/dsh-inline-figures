// scripts/readme-assets.mjs — shared plumbing for the README asset generators
// (make-readme-image.mjs, make-readme-diagram.mjs): locate the output directory
// and rasterize an SVG with sharp, from the package dependency or the offline
// staging copy.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const outDir = path.join(pkgRoot, 'docs', 'assets')

/** Load sharp, or explain which candidate failed. */
export async function loadSharp() {
  const candidates = [
    path.join(pkgRoot, 'node_modules', 'sharp', 'dist', 'index.cjs'),
    path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js', 'sharp', 'dist', 'index.cjs'),
  ]
  const why = []
  for (const entry of candidates) {
    try {
      const mod = await import(pathToFileURL(entry).href)
      const sharp = mod.default ?? mod
      if (typeof sharp === 'function') return { sharp, why }
      why.push(`${entry}: unexpected export shape`)
    } catch (error) {
      why.push(`${entry}: ${String(error?.message ?? error).split('\n')[0].slice(0, 90)}`)
    }
  }
  return { sharp: null, why }
}

/** Write <name>.svg, and <name>.png when sharp is available. */
export async function emit(name, svg, sharp) {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${name}.svg`), svg)
  if (!sharp) return `${name}: svg only`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  fs.writeFileSync(path.join(outDir, `${name}.png`), png)
  return `${name}: png ${png.length} bytes (magic ${png.subarray(0, 4).toString('hex')})`
}
