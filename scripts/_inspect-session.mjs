// inspect the AnGIneer session log for draw_figure presence/calls and guidance
import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const raw = fs.readFileSync(file)
// the .jsonl.zstd is a multi-frame stream; decompressSync/streams stop at frame 1.
// Split on the zstd frame magic (28 B5 2F FD) and inflate each frame.
const text = decompressFrames(raw)
function decompressFrames(buf) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let i = 0
  while (i < buf.length) {
    const start = i === 0 ? 0 : buf.indexOf(magic, i)
    if (start === -1) break
    const next = buf.indexOf(magic, start + magic.length)
    const frame = buf.subarray(start, next === -1 ? buf.length : next)
    try { parts.push(zlib.zstdDecompressSync(frame)) } catch { /* trailing partial frame */ }
    i = next === -1 ? buf.length : next
  }
  return Buffer.concat(parts).toString('utf8')
}
if (process.argv[3] === '--head') {
  console.log('decompressed bytes:', text.length, '| newlines:', (text.match(/\n/g) || []).length)
  console.log('has WHEN TO DRAW:', text.includes('WHEN TO DRAW'))
  console.log('has draw_figure:', text.includes('draw_figure'))
  console.log('has inline-figures:', text.includes('inline-figures'))
  console.log('head 500:', JSON.stringify(text.slice(0, 500)))
  process.exit(0)
}
const lines = text.split('\n').filter(Boolean)
console.log('lines:', lines.length)

const hits = {
  guidance_WHEN_TO_DRAW: 0,
  guidance_title_inline: 0,
  draw_figure_mention: 0,
  draw_figure_tool_call: 0,
  figure_extension: 0,
}
const sample = {}
for (const line of lines) {
  if (line.includes('WHEN TO DRAW')) { hits.guidance_WHEN_TO_DRAW++; sample.guidance ??= line.slice(0, 200) }
  if (line.includes('inline-figures:guidance')) hits.guidance_title_inline++
  if (line.includes('draw_figure')) { hits.draw_figure_mention++ }
  if (/"name":"draw_figure"|tool_call[^]*draw_figure|"tool":"draw_figure"/.test(line)) hits.draw_figure_tool_call++
  if (/\.dsh-figures|\.svg/.test(line)) hits.figure_extension++
}
console.log(JSON.stringify(hits, null, 2))
if (sample.guidance) console.log('guidance sample:', sample.guidance)

// list tool names declared anywhere in the log (first tool-def occurrences)
const toolNames = new Set()
for (const m of text.matchAll(/"name":"([a-z_]+)"/g)) toolNames.add(m[1])
console.log('names seen:', [...toolNames].join(', '))

// deep-dump every draw_figure call and its result
if (process.argv[3] === '--calls') {
  for (const line of lines) {
    if (!line.includes('draw_figure')) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    const t = obj.type
    const d = obj.data
    // tool call arguments
    const callText = JSON.stringify(d)
    if (/draw_figure/.test(callText)) {
      const brief = {
        seq: obj.seq, type: t,
        name: d?.name ?? d?.tool,
        argsKind: d?.args?.spec?.kind ?? d?.input?.spec?.kind ?? d?.spec?.kind,
        argsHead: (d?.args ?? d?.input ?? d ?? '').toString().slice(0, 0) || safeHead(d),
        isError: d?.isError,
        resultHead: typeof d?.result === 'string' ? d.result.slice(0, 200) : safeHead(d?.result),
        contentHead: Array.isArray(d?.content) ? JSON.stringify(d.content).slice(0, 220) : undefined,
      }
      console.log('\n---', JSON.stringify(brief))
    }
  }
}
function safeHead(v) {
  if (v == null) return undefined
  try { return JSON.stringify(v).slice(0, 240) } catch { return String(v).slice(0, 240) }
}

if (process.argv[3] === '--results') {
  for (const line of lines) {
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (!/^tool\//.test(obj.type ?? '')) continue
    const s = JSON.stringify(obj.data)
    if (!/draw_figure|invalid arguments|spec|figure/i.test(s)) continue
    console.log('\n== seq', obj.seq, obj.type)
    console.log(s.slice(0, 700))
  }
}
