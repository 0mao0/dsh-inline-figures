// lib/primitives.js — zero-dependency portable module (Node + browser). No cordis / @deepseek-ai imports allowed.
export const W = 680
export const OUT_W = 1600
export const M = 32
export const FONT = 14

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
const LATIN = /[A-Za-z]/
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])
}

export function textWidth(text, size = FONT) {
  let units = 0
  for (const ch of String(text)) {
    if (CJK.test(ch)) units += 1
    else if (ch === ' ') units += 0.34
    else if (LATIN.test(ch)) units += 0.55
    else units += 0.5
  }
  return Math.round(units * size * 100) / 100
}

// Tokens: one CJK char per token, one latin/digit run per token, everything else single-char (spaces kept).
function tokenize(text) {
  return String(text).match(/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]|[A-Za-z0-9]+|\s|./gu) || []
}

export function wrapText(text, maxWidth, size = FONT) {
  const lines = []
  let cur = ''
  for (const token of tokenize(text)) {
    const candidate = cur + token
    if (cur !== '' && textWidth(candidate, size) > maxWidth) {
      lines.push(cur)
      cur = token.replace(/^\s+/, '')
    } else {
      cur = candidate
    }
    while (cur.length > 1 && textWidth(cur, size) > maxWidth) {
      let cut = 1
      while (cut < cur.length && textWidth(cur.slice(0, cut + 1), size) <= maxWidth) cut += 1
      lines.push(cur.slice(0, cut))
      cur = cur.slice(cut)
    }
  }
  if (cur !== '') lines.push(cur)
  return lines.length > 0 ? lines : ['']
}

export function ellipsis(text, maxWidth, size = FONT) {
  const s = String(text)
  if (textWidth(s, size) <= maxWidth) return { text: s, truncated: false }
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (textWidth(s.slice(0, mid) + '…', size) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return { text: s.slice(0, lo) + '…', truncated: true }
}

export function styleBlock() {
  return [
    '<style>',
    "text{font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
    // Canvas is transparent: the host's light/dark background shows through.
    // Node/card SURFACES follow the theme; COLOR lives on strokes, text, edges, and dots.
    '.box{fill:#f4f4f2;stroke:#d0d0ca;stroke-width:1}',
    '.chip{fill:#ffffff;stroke:#dcdcd6;stroke-width:1}',
    // Category accents: colored border + colored label only (no tinted fill), so the
    // card surface stays theme-matched while the element carries a clear hue.
    '.tint1{stroke:#5b8def;stroke-width:1.6}', // blue
    '.tint2{stroke:#3fa796;stroke-width:1.6}', // teal-green
    '.tint3{stroke:#dd9a3a;stroke-width:1.6}', // amber
    '.tint4{stroke:#8a63d2;stroke-width:1.6}', // violet
    '.tint5{stroke:#d2647f;stroke-width:1.6}', // rose
    '.tint6{stroke:#4f9bd0;stroke-width:1.6}', // sky
    // Colored text partners for the accents above (used on the node's own label).
    '.c1{fill:#2f5fb0}.c2{fill:#2b7a6d}.c3{fill:#9a681a}.c4{fill:#5f3ba8}.c5{fill:#a83a58}.c6{fill:#2f6f9a}',
    // Solid accent-bar fills (a thin colored strip is a fill, not a stroke).
    '.accent{stroke:none}.accent1{fill:#5b8def}.accent2{fill:#3fa796}.accent3{fill:#dd9a3a}.accent4{fill:#8a63d2}.accent5{fill:#d2647f}.accent6{fill:#4f9bd0}.accent-danger{fill:#c96f63}',
    // Semantic roles.
    '.box-danger{fill:#fbeeec;stroke:#d98c82;stroke-width:1.6;stroke-dasharray:6 4}',
    '.chip-danger{stroke:#d98c82;stroke-width:1.6}',
    '.chip-ok{stroke:#57a677;stroke-width:1.6}',
    '.badge{fill:#c96f63}',
    '.t{fill:#22221f}',
    '.t-inv{fill:#ffffff}',
    '.t-dim{fill:#6f6f68}',
    '.t-danger{fill:#a83226}',
    '.t-ok{fill:#1c7c46}',
    '.axis{stroke:#9a9a92;stroke-width:1;fill:none}',
    '.grid{stroke:#e6e6e1;stroke-width:1}',
    '.line{stroke:#7b828d;stroke-width:1.6;fill:none;marker-end:url(#arr)}',
    '.dot{fill:#7c5fc0;stroke:#ffffff;stroke-width:1}',
    '.ring-done{fill:#4f9d76}',
    '.ring-active{fill:#c96f63}',
    '.ring-todo{fill:#ffffff;stroke:#9a9a92;stroke-width:1.5}',
    '@media (prefers-color-scheme:dark){',
    '.box{fill:#2f2f2d;stroke:#55554f}',
    '.chip{fill:#3a3a37;stroke:#5c5c55}',
    '.tint1{stroke:#7fa6e8}.c1{fill:#9cc0f5}',
    '.tint2{stroke:#63c4b2}.c2{fill:#7fd8c8}',
    '.tint3{stroke:#eab55f}.c3{fill:#f0c67f}',
    '.tint4{stroke:#a98be0}.c4{fill:#c3a9f0}',
    '.tint5{stroke:#e58ba0}.c5{fill:#f0a8ba}',
    '.tint6{stroke:#6db4e0}.c6{fill:#8fc8ea}',
    '.accent1{fill:#7fa6e8}.accent2{fill:#63c4b2}.accent3{fill:#eab55f}.accent4{fill:#a98be0}.accent5{fill:#e58ba0}.accent6{fill:#6db4e0}.accent-danger{fill:#d05a4c}',
    '.box-danger{fill:#3a2a28;stroke:#a05548}',
    '.chip-danger{stroke:#a05548}',
    '.chip-ok{stroke:#5cb884}',
    '.badge{fill:#d05a4c}',
    '.t{fill:#ecece6}',
    '.t-dim{fill:#a5a59d}',
    '.t-danger{fill:#e08a7e}',
    '.t-ok{fill:#5cb884}',
    '.axis{stroke:#8a8a82}',
    '.grid{stroke:#3d3d3a}',
    '.line{stroke:#9aa0aa}',
    '.dot{stroke:#3a3a37}',
    '.ring-todo{fill:#2f2f2d;stroke:#8a8a82}',
    '}',
    '</style>',
  ].join('')
}

export function defsBlock() {
  return '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9a92"/></marker></defs>'
}

export function svgDoc(height, inner) {
  const outH = Math.round((OUT_W * height) / W)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${OUT_W}" height="${outH}">`,
    styleBlock(),
    defsBlock(),
    inner,
    '</svg>',
  ].join('')
}

export function titleLine(title, x = M, y = M + 4) {
  return `<text class="t" x="${x}" y="${y}" font-size="${FONT + 3}" font-weight="600">${esc(title)}</text>`
}
