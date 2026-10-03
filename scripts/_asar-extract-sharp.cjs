// Extract sharp's JS wrapper + its in-archive runtime deps from app.asar into
// the shared cache. Used by scripts/stage-sharp.mjs (spawned as a child).
const path = require('node:path')
const fs = require('node:fs')
const { listFiles, extract } = require('./_asar-lite.cjs')

const A = process.env.DSH_ASAR
const CACHE = process.env.DSH_ASAR_CACHE
const DEPS = ['@img/colour', 'detect-libc', 'semver']
const files = listFiles(A)
let n = 0
for (const f of files) {
  const parts = f.path.split('/')
  if (parts[0] !== 'dsh' || parts[1] !== 'node_modules') continue
  const head = parts.slice(2).join('/')
  const wanted = head === 'sharp' || head.startsWith('sharp/') || DEPS.some((d) => head === d || head.startsWith(d + '/'))
  if (!wanted) continue
  let buf
  try {
    buf = extract(A, f.path)
  } catch (e) {
    console.error('extract miss', f.path, e.message)
    process.exit(3)
  }
  const dst = path.join(CACHE, ...parts.slice(2))
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, buf)
  n++
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

// Nest deps under sharp so createRequire(sharp/package.json) resolves them.
// (fs.cpSync throws EIO on this CJK path; manual copy instead.)
fs.mkdirSync(path.join(CACHE, 'sharp', 'node_modules'), { recursive: true })
for (const dep of DEPS) {
  const from = path.join(CACHE, ...dep.split('/'))
  const to = path.join(CACHE, 'sharp', 'node_modules', ...dep.split('/'))
  if (fs.existsSync(from)) {
    fs.rmSync(to, { recursive: true, force: true })
    copyDir(from, to)
    fs.rmSync(from, { recursive: true, force: true })
  }
}
fs.writeFileSync(path.join(CACHE, '.extracted-v3'), String(n))
console.log('asar extracted files:', n)
