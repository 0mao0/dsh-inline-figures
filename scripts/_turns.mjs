// Dump turn starts + assistant flow after a seq cutoff.
import fs from 'node:fs'
import zlib from 'node:zlib'
const buf = fs.readFileSync(process.argv[2])
const cut = Number(process.argv[3] || 0)
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const lines = []
let i = 0
while (i < buf.length) {
  const at = buf.indexOf(M, i); if (at < 0) break
  let e = buf.indexOf(M, at + 4); if (e < 0) e = buf.length
  try { lines.push(...zlib.zstdDecompressSync(buf.subarray(at, e)).toString('utf8').split('\n').filter(Boolean)) } catch {}
  i = e
}
for (const l of lines) {
  let o; try { o = JSON.parse(l) } catch { continue }
  const t = o.type
  if (t === 'turn/start') {
    const d = o.data || {}
    const inp = typeof d.input === 'string' ? d.input : JSON.stringify(d.input ?? d.prompt ?? d.message ?? '')
    console.log(`[seq ${o.seq}] TURN turn=${d.turn} input=${inp.slice(0, 120).replace(/\n/g, ' ')}`)
  } else if (t === 'assistant/message' && o.seq >= cut) {
    for (const b of (o.data?.message?.content || [])) {
      if (b.type === 'text' && b.text) {
        const emb = (b.text.match(/!\[[^\]]*\]\([^)]*\.svg/) || ['no-embed'])[0]
        console.log(`[seq ${o.seq}] TEXT len=${b.text.length} embed=${emb} :: ${b.text.slice(0, 50).replace(/\n/g, ' ')}`)
      } else if (b.type === 'tool-call') console.log(`[seq ${o.seq}] CALL ${b.name}`)
    }
  }
}
console.log('total lines:', lines.length)
