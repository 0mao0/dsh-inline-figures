// lib/figures/compare.js — portable left/right compare layout. No cordis / @deepseek-ai imports.
import { W, M, FONT, esc, wrapText, ellipsis, svgDoc, titleLine } from '../primitives.js'

const PAD = 14
const ARROW = 40
const V_GAP = 12
const LH = 19
const NH = 16

const RIGHT_RECT = { default: 'chip', danger: 'chip chip-danger', ok: 'chip chip-ok', muted: 'chip' }
const RIGHT_NOTE = { default: 't-dim', danger: 't-danger', ok: 't-ok', muted: 't-dim' }

export function compare(spec) {
  const warnings = []
  const total = W - M * 2
  const colW = Math.floor((total - ARROW) / 2)
  const innerW = colW - PAD * 2
  const cell = (c) => {
    const label = wrapText(c.label, innerW, FONT)
    const note = c.note ? wrapText(c.note, innerW, FONT - 2) : []
    const h = 12 + label.length * LH + (note.length ? note.length * NH + 4 : 0) + 12
    return { label, note, h }
  }
  const rows = spec.rows.map((row) => {
    const left = cell(row.left)
    const right = cell(row.right)
    return { left, right, h: Math.max(44, left.h, right.h), tone: row.right.tone ?? 'default' }
  })
  let y = M + 30 + (spec.columnHeads ? 26 : 0)
  const tops = rows.map((r) => {
    const t = y
    y += r.h + V_GAP
    return t
  })
  const footnote = spec.footnote ? wrapText(spec.footnote, total, FONT) : []
  const height = Math.round(y - V_GAP + (footnote.length ? footnote.length * LH + 6 : 0) + M)
  const parts = [titleLine(spec.title)]
  if (spec.columnHeads) {
    const fit0 = ellipsis(spec.columnHeads[0], colW, FONT - 2)
    const fit1 = ellipsis(spec.columnHeads[1], colW, FONT - 2)
    if (fit0.truncated || fit1.truncated) warnings.push('columnHeads truncated')
    parts.push(`<text class="t-dim" x="${M}" y="${M + 34}" font-size="${FONT - 2}" font-weight="600">${esc(fit0.text)}</text>`)
    parts.push(`<text class="t-dim" x="${M + colW + ARROW}" y="${M + 34}" font-size="${FONT - 2}" font-weight="600">${esc(fit1.text)}</text>`)
  }
  rows.forEach((r, ri) => {
    const top = tops[ri]
    const rx = M + colW + ARROW
    parts.push(`<rect class="chip" x="${M}" y="${top}" width="${colW}" height="${r.h}" rx="8"/>`)
    parts.push(`<rect class="${RIGHT_RECT[r.tone]}" x="${rx}" y="${top}" width="${colW}" height="${r.h}" rx="8"/>`)
    parts.push(`<path class="line" d="M${M + colW + 6} ${top + r.h / 2} L${rx - 9} ${top + r.h / 2}"/>`)
    const draw = (c, x, cls) => {
      const blockH = c.label.length * LH + (c.note.length ? c.note.length * NH + 4 : 0)
      let ty = top + (r.h - blockH) / 2 + 15
      for (const line of c.label) {
        parts.push(`<text class="t" x="${x + PAD}" y="${Math.round(ty)}" font-size="${FONT}">${esc(line)}</text>`)
        ty += LH
      }
      if (c.note.length) {
        ty += 4
        for (const line of c.note) {
          parts.push(`<text class="${cls}" x="${x + PAD}" y="${Math.round(ty)}" font-size="${FONT - 2}">${esc(line)}</text>`)
          ty += NH
        }
      }
    }
    draw(r.left, M, 't-dim')
    draw(r.right, rx, RIGHT_NOTE[r.tone])
  })
  let fy = y - V_GAP + 20
  for (const line of footnote) {
    parts.push(`<text class="t-danger" x="${M}" y="${fy}" font-size="${FONT}">${esc(line)}</text>`)
    fy += LH
  }
  return { svg: svgDoc(height, parts.join('')), warnings }
}
