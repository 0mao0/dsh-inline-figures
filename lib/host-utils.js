// lib/host-utils.js — host-side file helpers. Node APIs only (no cordis APIs); exercised by unit tests.
// The engine entry (./engine) must stay free of this module so it remains portable to browsers.
import fsp from 'node:fs/promises'
import path from 'node:path'

export function sanitizeSlug(value, fallback = 'figure') {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return cleaned === '' ? fallback : cleaned
}

export function nextFileIndex(names) {
  let max = 0
  for (const name of names) {
    const m = /^(\d+)-[^/\\]*\.svg$/.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export function figureRelPath(sessionId, file) {
  return `.dsh-figures/${String(sessionId).slice(0, 8)}/${file}`
}

export async function writeFigure(dir, svgText, slug) {
  await fsp.mkdir(dir, { recursive: true })
  try {
    await fsp.writeFile(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const existing = (await fsp.readdir(dir)).filter((f) => /\.svg$/.test(f))
  let n = nextFileIndex(existing)
  const base = sanitizeSlug(slug)
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = `${n}-${base}.svg`
    try {
      const handle = await fsp.open(path.join(dir, file), 'wx')
      try {
        await handle.writeFile(svgText)
      } finally {
        await handle.close()
      }
      return { file, index: n }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      n += 1
    }
  }
  throw new Error('could not allocate a unique figure file name')
}

export async function pruneFigures(dir, keep = 200) {
  const names = (await fsp.readdir(dir)).filter((f) => /\.svg$/.test(f))
  if (names.length <= keep) return []
  const stats = await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await fsp.stat(path.join(dir, name))).mtimeMs })))
  stats.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name, 'en'))
  const doomed = stats.slice(0, stats.length - keep).map((s) => s.name)
  await Promise.all(doomed.map((name) => fsp.rm(path.join(dir, name), { force: true })))
  return doomed
}
