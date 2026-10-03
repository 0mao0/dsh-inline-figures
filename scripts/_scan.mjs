// Scan ALL lines of a session for markers: which guidance phrases loaded, which model, tool presence.
import fs from 'node:fs'
import zlib from 'node:zlib'
const buf = fs.readFileSync(process.argv[2])
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const lines = []
let i = 0
while (i < buf.length) {
  const at = buf.indexOf(MAGIC, i); if (at < 0) break
  let end = buf.indexOf(MAGIC, at + 4); if (end < 0) end = buf.length
  try { lines.push(...zlib.zstdDecompressSync(buf.subarray(at, end)).toString('utf8').split('\n').filter(Boolean)) } catch {}
  i = end
}
const markers = ['just discussion', 'lean toward drawing', 'DENSITY', 'WHEN TO DRAW', 'judge, do not ritualize', '80% ASD-STE100']
const hit = Object.fromEntries(markers.map((m) => [m, 0]))
let drawInTools = false
let model = '??'
for (const line of lines) {
  for (const m of markers) if (line.includes(m)) hit[m]++
  if (/draw_figure/.test(line) && /"tools"|request\/header/.test(line)) drawInTools = true
  const mm = line.match(/"model":"([^"]+)"/)
  if (mm && model === '??') model = mm[1]
}
console.log('model(first seen):', model)
console.log('draw_figure appears in a request/header tools list:', drawInTools)
console.log('guidance phrase hit counts:')
for (const m of markers) console.log('  ', JSON.stringify(m), '=', hit[m])
