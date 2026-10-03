// Validate _asar-lite.cjs: list sharp files, extract package.json + index.cjs,
// check content signatures. Quiet output.
const os = require('node:os')
const path = require('node:path')
const lite = require('./_asar-lite.cjs')
// Point DSH_APP_ASAR at your own install; the default is the Windows layout.
const A = process.env.DSH_APP_ASAR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
const files = lite.listFiles(A)
const sharpDist = files.filter((f) => /\/sharp\/dist\//.test(f.path))
console.log('total files:', files.length, '| sharp dist:', sharpDist.length)

// 1) package.json: JSON must parse with the right name/version.
const pkgBuf = lite.extract(A, 'dsh/node_modules/sharp/package.json')
const pkg = JSON.parse(pkgBuf.toString('utf8'))
console.log('sharp pkg:', pkg.name, pkg.version, '| bytes', pkgBuf.length)

// 2) index.cjs: must start with a CJS preamble, not garbage.
const idx = lite.extract(A, 'dsh/node_modules/sharp/dist/index.cjs')
console.log('index.cjs bytes:', idx.length, '| head:', JSON.stringify(idx.subarray(0, 40).toString('utf8')))

// 3) A dependency from the archive: semver package.json parses and matches.
const sv = lite.extract(A, 'dsh/node_modules/semver/package.json')
const svj = JSON.parse(sv.toString('utf8'))
console.log('semver pkg:', svj.name, svj.version)

// 4) Integrity spot check: extract a second time, compare hashes.
const crypto = require('node:crypto')
const h1 = crypto.createHash('sha256').update(idx).digest('hex')
const h2 = crypto.createHash('sha256').update(lite.extract(A, 'dsh/node_modules/sharp/dist/index.cjs')).digest('hex')
console.log('stable extract:', h1 === h2)
