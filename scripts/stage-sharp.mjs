// scripts/stage-sharp.mjs — make the host app's sharp (JS wrapper + native +
// libvips DLLs) available to this plugin. Run AFTER EVERY DSH app upgrade and
// after any plugin reinstall (npm/pnpm installs can drop the staged copies —
// see the final guard below). Idempotent; verifies with a real SVG->PNG smoke
// at every location before declaring success.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
// Where DSH is installed. Override with --app-resources <dir> or DSH_APP_RESOURCES.
const APP_ROOT = opt('app-resources') ?? process.env.DSH_APP_RESOURCES ??
  path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness', 'resources')
const ASAR_UNPACKED = path.join(APP_ROOT, 'app.asar.unpacked', 'dsh', 'node_modules', '@img', 'sharp-win32-x64', 'lib')
if (!fs.existsSync(path.join(APP_ROOT, 'app.asar'))) {
  console.error(`no app.asar under ${APP_ROOT}\n` +
    'point the script at your DSH install:  node scripts/stage-sharp.mjs --app-resources "<app>\\resources"')
  process.exit(1)
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

// The app.asar path is Electron's virtual view, NOT a real directory. Extract
// sharp's JS wrapper from the archive with our own reader (_asar-lite.cjs,
// byte-calibrated on this host) via the helper script next to this one.
function sharpJsCache() {
  const cache = path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js')
  const marker = path.join(cache, '.extracted-v3')
  if (!fs.existsSync(marker)) {
    execFileSync(process.execPath, [path.join(here, '_asar-extract-sharp.cjs')], {
      stdio: 'inherit',
      env: { ...process.env, DSH_ASAR: path.join(APP_ROOT, 'app.asar'), DSH_ASAR_CACHE: cache },
    })
    if (!fs.existsSync(marker)) throw new Error('asar extraction did not complete')
  }
  return path.join(cache, 'sharp')
}

// Native addon + libvips DLLs at the path sharp's loader checks first.
function stageNatives(sharpDst) {
  const rel = path.join(sharpDst, 'src', 'build', 'Release')
  fs.mkdirSync(rel, { recursive: true })
  const natives = fs.readdirSync(ASAR_UNPACKED)
  const nodeFile = natives.find((f) => /^sharp-win32-x64-[\d.]+\.node$/.test(f))
  if (!nodeFile) throw new Error(`no .node in ${ASAR_UNPACKED}`)
  for (const f of natives) fs.copyFileSync(path.join(ASAR_UNPACKED, f), path.join(rel, f))
  return nodeFile
}

function smoke(sharpDst) {
  const req = createRequire(path.join(sharpDst, 'package.json'))
  let sharp = req('./dist/index.cjs')
  sharp = sharp.default ?? sharp
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120"><rect x="10" y="10" width="120" height="60" fill="#3b82f6" rx="6"/><text x="24" y="46" font-size="16" fill="#fff">ok</text></svg>'
  return sharp(Buffer.from(svg)).resize({ width: 1360 }).png().toBuffer().then((out) => {
    if (out.length < 100 || out.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('bad PNG')
    return out.length
  })
}

// sharp's runtime deps (@img/colour, detect-libc, semver) live INSIDE the
// archive; the shared cache nests them under sharp (see _asar-extract-sharp).
// A plugin-dir copy MUST carry its own complete copies: parent chains from a
// plugin dir do not reach vendor/node_modules, so a wrapper-only copy there is
// dead weight. COMPLETE = wrapper + nested deps + native/DLLs (smoke proves).
function stageIntoPlugin(pluginDir, sharpSrc) {
  const sharpDst = path.join(pluginDir, 'node_modules', 'sharp')
  fs.rmSync(sharpDst, { recursive: true, force: true })
  copyDir(sharpSrc, sharpDst)
  const nodeFile = stageNatives(sharpDst)
  return { sharpDst, nodeFile }
}

const sharpSrc = sharpJsCache()
// 1) The shared cache must be complete (native staged + smoke).
const cacheNode = stageNatives(sharpSrc)
const cachePng = await smoke(sharpSrc)
console.log(`OK cache staged+smoked: ${sharpSrc} (native: ${cacheNode}, png ${cachePng} bytes)`)
// 2) Every install dir gets a COMPLETE copy (wrapper + nested deps + native),
//    smoke-tested through the same node_modules resolution the runtime uses.
//    Layouts: the persistent staging copy, plus one directory per DSH profile.
const pkgName = JSON.parse(fs.readFileSync(path.join(path.dirname(here), 'package.json'), 'utf8')).name
const profilesRoot = path.join(os.homedir(), '.dsh', 'profiles')
const profileNames = opt('profile')
  ? [opt('profile')]
  : (fs.existsSync(profilesRoot) ? fs.readdirSync(profilesRoot).filter((n) => !n.includes('.bak')) : [])
const INSTALL_DIRS = [
  path.join(os.homedir(), '.dsh', 'vendor', pkgName.split('/').pop()),
  ...profileNames.map((n) => path.join(profilesRoot, n, 'node_modules', ...pkgName.split('/'))),
]
for (const dir of INSTALL_DIRS) {
  if (!fs.existsSync(dir)) { console.log(`skip (absent): ${dir}`); continue }
  const { sharpDst, nodeFile } = stageIntoPlugin(dir, sharpSrc)
  const bytes = await smoke(sharpDst)
  console.log(`OK plugin staged+smoked: ${dir} (native: ${nodeFile}, png ${bytes} bytes)`)
}
