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
    // Neutral base.
    '.box{fill:#f4f4f2;stroke:#dcdcd6;stroke-width:1}',
    '.chip{fill:#ffffff;stroke:#e0e0da;stroke-width:1}',
    // Soft pastel category tints (light): low-chroma fills, one family per role.
    '.tint1{fill:#eaf1fb;stroke:#b9cdea;stroke-width:1}', // blue
    '.tint2{fill:#eaf6ef;stroke:#b4d8c3;stroke-width:1}', // green
    '.tint3{fill:#fbf1e6;stroke:#e7c9a3;stroke-width:1}', // amber
    '.tint4{fill:#f2ecf8;stroke:#cbbbe4;stroke-width:1}', // violet
    '.tint5{fill:#fdeeef;stroke:#e6b4b8;stroke-width:1}', // rose
    '.tint6{fill:#e9f4f3;stroke:#aed4cf;stroke-width:1}', // teal
    // Semantic roles.
    '.box-danger{fill:#fbeeec;stroke:#d98c82;stroke-width:1.2;stroke-dasharray:6 4}',
    '.chip-danger{fill:#fbeeec;stroke:#d98c82;stroke-width:1}',
    '.chip-ok{fill:#edf5ef;stroke:#7bb892;stroke-width:1}',
    '.badge{fill:#c96f63}',
    '.t{fill:#22221f}',
    '.t-inv{fill:#ffffff}',
    '.t-dim{fill:#6f6f68}',
    '.t-danger{fill:#a83226}',
    '.t-ok{fill:#1c7c46}',
    '.axis{stroke:#9a9a92;stroke-width:1;fill:none}',
    '.grid{stroke:#e6e6e1;stroke-width:1}',
    '.line{stroke:#9aa0aa;stroke-width:1.4;fill:none;marker-end:url(#arr)}',
    '.dot{fill:#7c5fc0;stroke:#ffffff;stroke-width:1}',
    '.ring-done{fill:#4f9d76}',
    '.ring-active{fill:#c96f63}',
    '.ring-todo{fill:#ffffff;stroke:#9a9a92;stroke-width:1.5}',
    '@media (prefers-color-scheme:dark){',
    '.box{fill:#2b2b29;stroke:#4a4a45}',
    '.chip{fill:#343431;stroke:#52524c}',
    '.tint1{fill:#22303f;stroke:#3d5670}',
    '.tint2{fill:#20332a;stroke:#3c6a51}',
    '.tint3{fill:#36291a;stroke:#6d5230}',
    '.tint4{fill:#2b2740;stroke:#4d4468}',
    '.tint5{fill:#3a2628;stroke:#6d4549}',
    '.tint6{fill:#1f302e;stroke:#3c5e59}',
    '.box-danger{fill:#3a2a28;stroke:#a05548}',
    '.chip-danger{fill:#3a2a28;stroke:#a05548}',
    '.chip-ok{fill:#25332a;stroke:#3f7a55}',
    '.badge{fill:#d05a4c}',
    '.t{fill:#e9e9e3}',
    '.t-dim{fill:#9a9a92}',
    '.t-danger{fill:#e08a7e}',
    '.t-ok{fill:#5cb884}',
    '.axis{stroke:#8a8a82}',
    '.grid{stroke:#3d3d3a}',
    '.line{stroke:#8a8a82}',
    '.dot{stroke:#343431}',
    '.ring-todo{fill:#2b2b29;stroke:#8a8a82}',
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
