// scripts/make-readme-image.mjs — build the README hero images, one per
// language: docs/assets/before-after.png (English) and
// docs/assets/before-after.zh.png (Chinese).
//
// The picture makes one point: the same answer as a wall of text (left) and as
// text-figure-text (right). Layout reuses the plugin's own text metrics
// (lib/primitives.js), so the mock reads like real plugin output instead of
// hand-placed strings.
//
// Run:  node scripts/make-readme-image.mjs
// Needs the staged sharp (run scripts/stage-sharp.mjs, or install the package);
// without it the script still writes the .svg files and says why the .png files
// are missing.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { wrapText, esc } from '../lib/primitives.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.dirname(here)
const outDir = path.join(pkgRoot, 'docs', 'assets')

const W = 1200            // logical width; the raster is 2x, so GitHub shows it near 1:1 at ~880px
const M = 28              // page margin
const GAP = 28            // gutter between the two panels
const PAD = 26            // panel padding
const PANEL_W = (W - M * 2 - GAP) / 2
const BODY = 16           // body text size
const LEAD = 24           // body line advance
const HEAD = 18           // sub-heading size
const PANEL_H_MIN = 540
const PANEL_TOP = 64

// Fixed light palette for the assets: the PNG gets an opaque white canvas, so it
// stays readable in a dark GitHub theme (the plugin's own theme-adaptive
// stylesheet only applies when a browser renders the SVG).
const CSS = [
  "text{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
  '.t{fill:#22221f}.t-dim{fill:#6f6f68}.t-danger{fill:#a83226}',
  '.box{fill:#f4f4f2;stroke:#d0d0ca;stroke-width:1}',
  '.box-danger{fill:#fbeeec;stroke:#d98c82;stroke-width:1.6;stroke-dasharray:6 4}',
  '.accent1{fill:#5b8def}.accent2{fill:#3fa796}.accent-danger{fill:#c96f63}',
].join('')

const LOCALES = {
  en: {
    out: 'before-after',
    headers: ['WITHOUT THE PLUGIN', 'WITH dsh-inline-figures'],
    left: [
      { k: 'h', text: 'How MCP request handling works' },
      { k: 'p', text: 'By default, MCP requests are serialized. The client keeps one in-flight JSON-RPC message per connection and waits for the response before it sends the next one, so three parts of the stack have to agree on the same contract. The transport owns the socket and the framing, but it does not know what a request id means.' },
      { k: 'p', text: 'When a request times out, three things happen in order. The transport raises a socket error. The session marks the id as orphaned and drops the pending entry. The retry policy then decides whether the message can be replayed, and it can only replay a call that is idempotent.' },
      { k: 'p', text: 'Two consequences follow from this split. A timeout does not tell you which layer failed, so the same message can mean a dead socket, a lost response, or a policy that refused to replay. The client exposes three separate hooks and documents them in three separate places.' },
      { k: 'li', text: 'A timeout never says which layer failed.' },
      { k: 'li', text: 'Replay is safe only for idempotent tool calls.' },
      { k: 'li', text: 'Three hooks, three documents, one failure path.' },
    ],
    rightLead: [{ k: 'p', text: 'By default, MCP requests are serialized: the client keeps one in-flight JSON-RPC message per connection.' }],
    stages: [
      { title: 'Transport', note: 'socket, framing buffer', accent: 'accent1' },
      { title: 'Session', note: 'request id, pending table', accent: 'accent2' },
      { title: 'Retry policy', note: 'replay only if idempotent', accent: 'accent-danger', danger: true },
    ],
    caption: 'one in-flight message per connection',
    rightTail: [
      { k: 'p', text: 'Each layer owns one thing. The transport owns the socket and the framing. The session owns the request id and the pending table.' },
      { k: 'p', text: 'A timeout does not say which layer failed. Replay is safe only for idempotent calls.' },
    ],
    footer: 'Same facts, same answer. On the left you read it; on the right you scan it.',
  },
  zh: {
    out: 'before-after.zh',
    headers: ['不装插件', '装了 dsh-inline-figures'],
    left: [
      { k: 'h', text: 'MCP 请求处理是怎么工作的' },
      { k: 'p', text: '默认情况下，MCP 请求是串行的。客户端每条连接只保留一个在途的 JSON-RPC 消息，收到响应后才发下一条，所以栈里有三个部分必须遵守同一份约定。传输层持有 socket 和分帧，但它不知道请求 id 是什么意思。' },
      { k: 'p', text: '一个请求超时后，会依次发生三件事。传输层抛出 socket 错误。会话层把该 id 标记为孤儿，并丢弃待响应条目。重试策略再判断这条消息能否重放，而只有幂等调用才允许重放。' },
      { k: 'p', text: '这个拆分带来两个后果。超时不会告诉你哪一层出了问题，所以同一条报错可能意味着 socket 断了、响应丢了，或者策略拒绝重放。客户端暴露三个彼此独立的钩子，并把它们写在三份不同的文档里。' },
      { k: 'li', text: '超时永远不会说清是哪一层出的错。' },
      { k: 'li', text: '只有幂等调用才能安全重放。' },
      { k: 'li', text: '三个钩子、三份文档、一条失败路径。' },
    ],
    rightLead: [{ k: 'p', text: '默认情况下，MCP 请求是串行的：每条连接只保留一个在途的 JSON-RPC 消息。' }],
    stages: [
      { title: '传输层', note: 'socket、分帧缓冲', accent: 'accent1' },
      { title: '会话层', note: '请求 id、待响应表', accent: 'accent2' },
      { title: '重试策略', note: '只有幂等才可重放', accent: 'accent-danger', danger: true },
    ],
    caption: '每条连接只允许一个在途消息',
    rightTail: [
      { k: 'p', text: '每一层只管一件事。传输层管 socket 和分帧。会话层管请求 id 和待响应表。' },
      { k: 'p', text: '超时不会说清是哪一层出的错。只有幂等调用才能安全重放。' },
    ],
    footer: '同样的事实，同样的回答。左边要读，右边只要扫。',
  },
}

const innerW = PANEL_W - PAD * 2

function wrapBlocks(blocks, width) {
  return blocks.map((b) => {
    const size = b.k === 'h' ? HEAD : BODY
    const indent = b.k === 'li' ? 18 : 0
    return { ...b, lines: wrapText(b.text, width - indent, size) }
  })
}

function measure(blocks) {
  let h = 0
  for (const [i, b] of blocks.entries()) {
    const lead = b.k === 'h' ? 26 : LEAD
    h += (i === 0 ? 0 : b.k === 'h' ? 20 : 10) + b.lines.length * lead
  }
  return h
}

function drawBlocks(blocks, x, y0) {
  const parts = []
  let y = y0
  for (const [i, b] of blocks.entries()) {
    if (i > 0) y += b.k === 'h' ? 20 : 10
    const size = b.k === 'h' ? HEAD : BODY
    const lead = b.k === 'h' ? 26 : LEAD
    const indent = b.k === 'li' ? 18 : 0
    b.lines.forEach((line, li) => {
      y += lead
      const cls = b.k === 'h' ? 't' : 't-dim'
      const weight = b.k === 'h' ? ' font-weight="700"' : ''
      const bullet = b.k === 'li' && li === 0 ? `<circle cx="${x + 5}" cy="${y - 6}" r="3" fill="#9a9a92"/>` : ''
      parts.push(`${bullet}<text class="${cls}" x="${x + indent}" y="${y}" font-size="${size}"${weight}>${esc(line)}</text>`)
    })
  }
  return { parts: parts.join(''), height: y - y0 }
}

// The "after" figure: a three-stage flow, the shape a preset gives you for free.
const FIG_H = 3 * 52 + 2 * 22 + 30
function drawFlow(x, y, width, stages, caption) {
  const boxW = width - 8
  const parts = []
  stages.forEach((s, i) => {
    const by = y + i * (52 + 22)
    parts.push(`<rect class="${s.danger ? 'box box-danger' : 'box'}" x="${x + 8}" y="${by}" width="${boxW}" height="52" rx="10"/>`)
    parts.push(`<rect class="${s.accent}" x="${x + 8}" y="${by}" width="6" height="52" rx="3"/>`)
    parts.push(`<text class="t" x="${x + 28}" y="${by + 24}" font-size="15" font-weight="600">${esc(s.title)}</text>`)
    parts.push(`<text class="t-dim" x="${x + 28}" y="${by + 43}" font-size="13">${esc(s.note)}</text>`)
    if (i < stages.length - 1) {
      const cy = by + 52
      parts.push(`<path d="M${x + 8 + boxW / 2} ${cy + 3} L${x + 8 + boxW / 2} ${cy + 17}" stroke="#7b828d" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>`)
    }
  })
  parts.push(`<text class="t-dim" x="${x + 8}" y="${y + 3 * 52 + 2 * 22 + 20}" font-size="13">${esc(caption)}</text>`)
  return { parts: parts.join(''), height: FIG_H }
}

function build(L) {
  const leftBlocks = wrapBlocks(L.left, innerW)
  const rightBlocks = wrapBlocks(L.rightLead, innerW)
  const rightTailBlocks = wrapBlocks(L.rightTail, innerW)

  const leftH = measure(leftBlocks)
  const rightH = measure(rightBlocks) + 18 + FIG_H + 18 + measure(rightTailBlocks)
  const panelH = Math.max(leftH + PAD * 2, rightH + PAD * 2, PANEL_H_MIN)
  const H = PANEL_TOP + panelH + 62

  const LX = M
  const RX = M + PANEL_W + GAP
  const body = []

  body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`)
  for (const [px, label] of [[LX, L.headers[0]], [RX, L.headers[1]]]) {
    body.push(`<text class="t-dim" x="${px + 2}" y="${PANEL_TOP - 16}" font-size="12" font-weight="700" letter-spacing="1.6">${esc(label)}</text>`)
    body.push(`<rect x="${px}" y="${PANEL_TOP}" width="${PANEL_W}" height="${panelH}" rx="14" fill="#fbfbfa" stroke="#e6e6e1"/>`)
  }

  // left: the wall of text
  body.push(drawBlocks(leftBlocks, LX + PAD, PANEL_TOP + PAD).parts)

  // right: the same facts, text-figure-text
  const rHead = drawBlocks(rightBlocks, RX + PAD, PANEL_TOP + PAD)
  body.push(rHead.parts)
  const figY = PANEL_TOP + PAD + rHead.height + 18
  body.push(drawFlow(RX + PAD, figY, innerW, L.stages, L.caption).parts)
  body.push(drawBlocks(rightTailBlocks, RX + PAD, figY + FIG_H + 18).parts)

  body.push(`<text x="${W / 2}" y="${H - 26}" font-size="14" fill="#6f6f68" text-anchor="middle">${esc(L.footer)}</text>`)

  return {
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">`,
      `<style>${CSS}</style>`,
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9a92"/></marker></defs>',
      body.join(''),
      '</svg>',
    ].join(''),
    width: W,
    height: H,
  }
}

// Rasterize with sharp: the package dependency, or the offline staging copy.
const candidates = [
  path.join(pkgRoot, 'node_modules', 'sharp', 'dist', 'index.cjs'),
  path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js', 'sharp', 'dist', 'index.cjs'),
]
let sharp = null
const why = []
for (const entry of candidates) {
  try {
    const mod = await import(pathToFileURL(entry).href)
    sharp = mod.default ?? mod
    if (typeof sharp === 'function') break
    sharp = null
    why.push(`${entry}: unexpected export shape`)
  } catch (error) {
    why.push(`${entry}: ${String(error?.message ?? error).split('\n')[0].slice(0, 90)}`)
  }
}

fs.mkdirSync(outDir, { recursive: true })
for (const [code, L] of Object.entries(LOCALES)) {
  const { svg, width, height } = build(L)
  fs.writeFileSync(path.join(outDir, `${L.out}.svg`), svg)
  let note = 'svg only'
  if (sharp) {
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    fs.writeFileSync(path.join(outDir, `${L.out}.png`), png)
    note = `${png.length} bytes, magic ${png.subarray(0, 4).toString('hex')}`
  }
  console.log(`${code}: docs/assets/${L.out}.svg + .png  (${width}x${height} logical, ${width * 2}x${height * 2} raster)  ${note}`)
}
if (!sharp) console.error(`sharp unavailable, .png files not written:\n  ${why.join('\n  ')}`)
