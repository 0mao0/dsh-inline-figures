// Per-request-header: does the system prompt carry the LATEST guidance fingerprint?
import fs from 'node:fs'
import zlib from 'node:zlib'
const buf = fs.readFileSync(process.argv[2])
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const lines = []
let i = 0
while (i < buf.length) {
  const at = buf.indexOf(M, i); if (at < 0) break
  let e = buf.indexOf(M, at + 4); if (e < 0) e = buf.length
  try { lines.push(...zlib.zstdDecompressSync(buf.subarray(at, e)).toString('utf8').split('\n').filter(Boolean)) } catch {}
  i = e
}
// Fingerprints, oldest -> newest revisions.
const REV = {
  'r1 judge/many-none': 'judge, do not ritualize',
  'r2 lean+density': 'lean toward drawing',
  'r3 analysis-not-exempt': 'NOT exempt for being',
}
let n = 0
for (const l of lines) {
  let o; try { o = JSON.parse(l) } catch { continue }
  if (o.type !== 'request/header') continue
  n++
  const s = JSON.stringify(o)
  const tags = Object.entries(REV).filter(([, probe]) => s.includes(probe)).map(([k]) => k)
  // Tool description revisions: lean-to-draw description has 'lean toward drawing' inside the tool desc too;
  // check them separately from the system prompt by locating each marker's neighborhood.
  console.log(`header seq=${o.seq} guidance-revisions-present=[${tags.join(', ') || 'NONE'}]`)
}
console.log('total request headers:', n)
