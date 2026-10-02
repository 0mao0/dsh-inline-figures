// Print each assistant text block's length + whether it has a real ![...](...svg) embed.
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
for (const line of lines) {
  let o; try { o = JSON.parse(line) } catch { continue }
  if (o.type !== 'assistant/message') continue
  const c = o.data?.message?.content
  if (!Array.isArray(c)) continue
  for (const b of c) {
    if (b.type === 'text' && b.text) {
      const md = (b.text.match(/!\[[^\]]*\]\([^)]*\.svg[^)]*\)/g) ?? []).length
      const head = b.text.slice(0, 60).replace(/\n/g, ' ')
      console.log(`[seq ${o.seq}] text len=${b.text.length} realSvgEmbeds=${md} :: ${head}`)
    }
  }
}
