// Dump every tool/call name + args preview, and every tool/result isError + short, in seq order.
import fs from 'node:fs'
import zlib from 'node:zlib'
const file = process.argv[2]
const buf = fs.readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const lines = []
let i = 0
while (i < buf.length) {
  const at = buf.indexOf(MAGIC, i)
  if (at < 0) break
  let end = buf.indexOf(MAGIC, at + 4)
  if (end < 0) end = buf.length
  const frame = buf.subarray(at, end)
  try { lines.push(...zlib.zstdDecompressSync(frame).toString('utf8').split('\n').filter(Boolean)) } catch {}
  i = end
}
const MODE = process.argv[3] // 'stats' | undefined(dump)
const stats = { drawOk: 0, drawErr: 0, otherErr: 0, assistantChars: 0, figRefs: 0, turns: 0 }
for (const line of lines) {
  let o; try { o = JSON.parse(line) } catch { continue }
  const t = o.type
  if (t === 'assistant/message') {
    const c = o.data?.message?.content
    if (Array.isArray(c)) for (const b of c) if (b.type === 'text') stats.assistantChars += (b.text ?? '').length
  } else if (t === 'tool/call') {
    const content = o.data?.message?.content ?? o.data?.content ?? []
    for (const c of content.filter((b) => b.type === 'tool-call')) {
      if (MODE !== 'stats') console.log(`[seq ${o.seq}] CALL ${c.name} :: ${JSON.stringify(c.arguments).slice(0, 300)}`)
    }
  } else if (t === 'tool/result') {
    const m = o.data?.message ?? o.data ?? {}
    const err = m.isError ? ' ERROR' : ''
    const txt = (m.content?.[0]?.text ?? '').replace(/\n/g, ' ').slice(0, 160)
    const callId = m.toolCallId ?? m.source?.callId ?? ''
    const isDraw = /\.svg/.test(m.content?.[0]?.text ?? '')
    if (isDraw) { m.isError ? stats.drawErr++ : stats.drawOk++ }
    else if (m.isError) stats.otherErr++
    if (MODE !== 'stats') console.log(`[seq ${o.seq}] RESULT${err} ${callId} :: ${txt}`)
  } else if (t === 'turn/start') {
    stats.turns++
  }
}
if (MODE === 'stats') {
  stats.figRefs = lines.filter((l) => /!\[[^\]]*\]\([^)]*\.svg/.test(l)).length
  console.log(JSON.stringify(stats))
}
