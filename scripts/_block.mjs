// Print full assistant text blocks (one file per long block) for inspection.
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
let n = 0
for (const line of lines) {
  let o; try { o = JSON.parse(line) } catch { continue }
  if (o.type !== 'assistant/message') continue
  const c = o.data?.message?.content
  if (!Array.isArray(c)) continue
  for (const b of c) if (b.type === 'text' && b.text && b.text.length > 400) { n++; console.log(`\n########## BLOCK ${n} (seq ${o.seq}, ${b.text.length} chars) ##########\n${b.text}`) }
}
