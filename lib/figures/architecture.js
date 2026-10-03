// lib/figures/architecture.js — portable layered-architecture layout. No cordis / @deepseek-ai imports.
import { W, M, FONT, esc, wrapText, ellipsis, svgDoc, titleLine } from '../primitives.js'

const PAD = 14
const HEAD = 28
const CHIP_GAP = 10
const V_GAP = 46
const LH = 19
const NH = 16

export function architecture(spec) {
  const warnings = []
  const boxW = W - M * 2
  const plan = spec.layers.map((layer, li) => {
    const n = layer.nodes.length
    const chipW = Math.floor((boxW - PAD * 2 - CHIP_GAP * (n - 1)) / n)
    const innerW = chipW - 12
    const chips = layer.nodes.map((node) => ({
      label: wrapText(node.label, innerW, FONT),
      note: node.note ? wrapText(node.note, innerW, FONT - 2) : [],
    }))
    let chipH = 36
    chips.forEach((c, ci) => {
      chipH = Math.max(chipH, 12 + c.label.length * LH + (layer.nodes[ci].note ? c.note.length * NH + 4 : 0) + 12)
    })
    const boxH = HEAD + chipH + PAD + (layer.note ? 20 : 0)
    const badge = layer.badge !== undefined ? String(layer.badge) : layer.tone === 'danger' ? 'P0' : null
    return { layer, chips, chipW, chipH, boxH, badge, y: 0, li }
  })
  let y = M + 30
  for (const p of plan) {
    p.y = y
    y += p.boxH + V_GAP
  }
  const edges = spec.edges ?? plan.slice(1).map((p, i) => ({ from: i, to: i + 1 }))
  const footnote = spec.footnote ? wrapText(spec.footnote, boxW, FONT) : []
  const height = Math.round(y - V_GAP + (footnote.length ? footnote.length * LH + 6 : 0) + M)
  const parts = [titleLine(spec.title)]
  const TINTS = ['tint1', 'tint2', 'tint3', 'tint4', 'tint5', 'tint6']
  const HEADCOLOR = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']
  plan.forEach((p) => {
    const ci = p.li % TINTS.length
    const danger = p.layer.tone === 'danger'
    const boxCls = danger ? 'box box-danger' : 'box'
    parts.push(`<rect class="${boxCls}" x="${M}" y="${p.y}" width="${boxW}" height="${p.boxH}" rx="10"/>`)
    // Colored accent bar: the read-hue anchor (theme card + colored bar + colored title).
    const barCls = danger ? 'accent accent-danger' : `accent accent${ci + 1}`
    parts.push(`<rect class="${barCls}" x="${M}" y="${p.y}" width="6" height="${p.boxH}" rx="3"/>`)
    let hx = M + PAD + 4
    if (p.badge) {
      const bw = 10 + p.badge.length * 8
      parts.push(`<rect class="badge" x="${hx}" y="${p.y + 7}" width="${bw}" height="19" rx="5"/>`)
      parts.push(`<text class="t-inv" x="${hx + bw / 2}" y="${p.y + 21}" font-size="12" font-weight="700" text-anchor="middle">${esc(p.badge)}</text>`)
      hx += bw + 10
    }
    const headFit = ellipsis(p.layer.label, W - M - hx - PAD, FONT)
    if (headFit.truncated) warnings.push(`layers[${p.li}].label truncated`)
    const headCls = danger ? 't-danger' : HEADCOLOR[ci]
    parts.push(`<text class="${headCls}" x="${hx}" y="${p.y + 21}" font-size="${FONT}" font-weight="600">${esc(headFit.text)}</text>`)
    p.chips.forEach((c, ci) => {
      const cx = M + PAD + ci * (p.chipW + CHIP_GAP)
      const cy = p.y + HEAD
      parts.push(`<rect class="chip" x="${cx}" y="${cy}" width="${p.chipW}" height="${p.chipH}" rx="8"/>`)
      let ty = cy + 26
      for (const line of c.label) {
        parts.push(`<text class="t" x="${Math.round(cx + p.chipW / 2)}" y="${ty}" font-size="${FONT}" text-anchor="middle">${esc(line)}</text>`)
        ty += LH
      }
      if (c.note.length > 0) {
        ty += 3
        for (const line of c.note) {
          parts.push(`<text class="t-dim" x="${Math.round(cx + p.chipW / 2)}" y="${ty}" font-size="${FONT - 2}" text-anchor="middle">${esc(line)}</text>`)
          ty += NH
        }
      }
    })
    if (p.layer.note) {
      const fit = ellipsis(p.layer.note, boxW - PAD * 2, FONT - 2)
      if (fit.truncated) warnings.push(`layers[${p.li}].note truncated`)
      parts.push(`<text class="${p.layer.tone === 'danger' ? 't-danger' : 't-dim'}" x="${M + PAD}" y="${p.y + p.boxH - 10}" font-size="${FONT - 2}">${esc(fit.text)}</text>`)
    }
  })
  const spread = edges.length > 1 ? 44 : 0
  edges.forEach((e, ei) => {
    const from = plan[e.from]
    const to = plan[e.to]
    const downward = e.to > e.from
    const y1 = downward ? from.y + from.boxH + 2 : from.y - 2
    const y2 = downward ? to.y - 10 : to.y + to.boxH + 10
    const x = Math.round(W / 2 + (ei - (edges.length - 1) / 2) * spread)
    parts.push(`<path class="line" d="M${x} ${y1} L${x} ${y2}"/>`)
    if (e.label) parts.push(`<text class="t-dim" x="${x + 8}" y="${Math.round((y1 + y2) / 2) + 4}" font-size="${FONT - 2}">${esc(e.label)}</text>`)
  })
  let fy = y - V_GAP + 18
  for (const line of footnote) {
    parts.push(`<text class="t-danger" x="${M}" y="${fy}" font-size="${FONT}">${esc(line)}</text>`)
    fy += LH
  }
  return { svg: svgDoc(height, parts.join('')), warnings }
}
