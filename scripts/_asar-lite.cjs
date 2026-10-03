// Minimal asar reader for the Electron-built archive (npm @electron/asar v4
// fails to open it). Byte-calibrated on this host (see git log of the commit
// that added it):
//   u32 4 | u32 len | u32 len-4 | u32 len-8 | JSON (ends at real JSON end,
//   a few bytes before len), payload base = 16 + len - 8.
const fs = require('node:fs')

function readHeader(A) {
  const fd = fs.openSync(A, 'r')
  const b = Buffer.alloc(16)
  fs.readSync(fd, b, 0, 16, 0)
  const len = b.readUInt32LE(4)
  const jb = Buffer.alloc(len)
  fs.readSync(fd, jb, 0, len, 16)
  fs.closeSync(fd)
  let json = null
  for (let end = len; end > len - 4096; end--) {
    if (jb[end - 1] !== 0x7d) continue // '}'
    try {
      json = JSON.parse(jb.toString('utf8', 0, end))
      break
    } catch {}
  }
  if (!json) throw new Error('asar header JSON not found')
  return { json, base: 16 + len - 8 }
}

function walk(node, parts, files) {
  if (!node.files) {
    if (node.size !== undefined && node.unpacked !== true) files.push({ path: parts.join('/'), offset: Number(node.offset), size: node.size })
    return
  }
  for (const [name, child] of Object.entries(node.files)) walk(child, [...parts, name], files)
}

function listFiles(A) {
  const { json } = readHeader(A)
  const files = []
  walk(json, [], files)
  return files
}

function extract(A, targetPath) {
  const { json, base } = readHeader(A)
  let node = json
  for (const p of targetPath.split('/')) {
    node = node.files?.[p]
    if (!node) throw new Error('not found in archive: ' + targetPath)
  }
  if (node.unpacked) throw new Error('file is unpacked (in app.asar.unpacked): ' + targetPath)
  const fd = fs.openSync(A, 'r')
  const buf = Buffer.alloc(node.size)
  fs.readSync(fd, buf, 0, node.size, base + Number(node.offset))
  fs.closeSync(fd)
  return buf
}

module.exports = { listFiles, extract }
