#!/usr/bin/env node
// scripts/extract-app-tree.mjs — copy files out of the DSH Electron archive.
//
// The installer needs a real on-disk node_modules tree, but DSH ships its
// packages inside resources/app.asar (only a handful of native ones also exist
// unpacked). This reads the archive header directly and writes the matching
// entries out, so `install-to-profile.ps1 -Tree` has something to walk.
//
//   node scripts/extract-app-tree.mjs "<app>/resources/app.asar" .dsh-tree "dsh/node_modules/"
//   node scripts/extract-app-tree.mjs "<app>/resources/app.asar" --list "dsh/node_modules/@deepseek-ai/dsh-tools/"
//
// args: <app.asar> <out-dir> [include-regex]   |   <app.asar> --list [include-regex]
// The include pattern is matched case-insensitively against the archive path.
import fs from 'node:fs'
import path from 'node:path'

const [asarPath, outArg, patternArg] = process.argv.slice(2)
const listOnly = outArg === '--list'
const outRoot = listOnly ? null : outArg
const pattern = listOnly ? patternArg : patternArg
const include = pattern ? new RegExp(pattern, 'i') : null

if (!asarPath || !outArg) {
  console.error('usage: node scripts/extract-app-tree.mjs <app.asar> <out-dir> [include-regex]')
  console.error('       node scripts/extract-app-tree.mjs <app.asar> --list [include-regex]')
  process.exit(2)
}
if (!fs.existsSync(asarPath)) {
  console.error(`archive not found: ${asarPath}`)
  process.exit(2)
}

// Electron layout: u32 4 | u32 headerLength | u32 headerLength-4 | u32 headerLength-8
// | JSON header (a few bytes shorter than headerLength) ; payload base = 16 + headerLength - 8.
const fd = fs.openSync(asarPath, 'r')
try {
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const jsonSize = head.readUInt32LE(8) - 4
  if (!(jsonSize > 0 && jsonSize < 64 * 1024 * 1024)) {
    console.error(`implausible asar header length (${jsonSize}); this is not an Electron asar archive`)
    process.exit(2)
  }
  const jsonBuf = Buffer.alloc(jsonSize)
  fs.readSync(fd, jsonBuf, 0, jsonSize, 16)
  let header
  try {
    header = JSON.parse(jsonBuf.toString('utf8'))
  } catch {
    // Tolerate trailing padding: parse up to the last closing brace.
    const end = jsonBuf.lastIndexOf(0x7d) + 1
    header = JSON.parse(jsonBuf.toString('utf8', 0, end))
  }
  const baseOffset = 16 + jsonSize

  const entries = []
  const walk = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name
      if (value.files) walk(value, p)
      else if (!include || include.test(p)) entries.push({ path: p, offset: Number(value.offset ?? 0), size: Number(value.size ?? 0) })
    }
  }
  walk(header, '')

  if (entries.length === 0) {
    console.error(`no archive entry matches ${include}`)
    process.exit(1)
  }

  if (listOnly) {
    for (const e of entries) console.log(e.path)
    console.error(`${entries.length} entries match`)
    process.exit(0)
  }

  let bytes = 0
  for (const e of entries) {
    const dest = path.join(outRoot, e.path)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.alloc(e.size)
    if (e.size > 0) fs.readSync(fd, buf, 0, e.size, baseOffset + e.offset)
    fs.writeFileSync(dest, buf)
    bytes += e.size
  }
  console.log(`extracted ${entries.length} files (${(bytes / 1048576).toFixed(1)} MiB) -> ${outRoot}`)

  // The payload offset above is calibrated per archive layout. If it were wrong,
  // every file would be garbage, so prove the result before anyone builds on it.
  const manifests = entries.filter((e) => e.path.endsWith('package.json')).slice(0, 25)
  for (const m of manifests) {
    const file = path.join(outRoot, m.path)
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      console.error(`extraction looks corrupt: ${m.path} is not valid JSON (${error.message})`)
      console.error('the archive header layout may have changed; do not install from this tree')
      process.exit(1)
    }
  }
  console.log(`verified ${manifests.length} extracted package manifests`)
} finally {
  fs.closeSync(fd)
}
