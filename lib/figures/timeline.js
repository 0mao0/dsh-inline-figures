// lib/figures/timeline.js — portable vertical timeline layout. No cordis / @deepseek-ai imports.
import { W, M, FONT, esc, wrapText, svgDoc, titleLine } from '../primitives.js'

const R = 8
const TX = M + 44

export function timeline(spec) {
  const warnings = []
  const steps = spec.steps.map((s) => ({
    state: s.state ?? 'todo',
    label: wrapText(s.label, W - M - TX, FONT + 1),
    note: s.note ? wrapText(s.note, W - M - TX, FONT - 2) : [],
  }))
  let y = M + 42
  for (const s of steps) {
    s.y = y
    y += Math.max(44, s.label.length * 20 + (s.note.length ? s.note.length * 16 + 5 : 0) + 18)
  }
  const height = Math.round(y + M - 14)
  const parts = [titleLine(spec.title)]
  steps.forEach((s, i) => {
    const cy = s.y
    if (i > 0) parts.push(`<line class="axis" x1="${M + 12}" y1="${steps[i - 1].y + R + 3}" x2="${M + 12}" y2="${cy - R - 3}"/>`)
    if (s.state === 'done') {
      parts.push(`<circle class="ring-done" cx="${M + 12}" cy="${cy}" r="${R}"/>`)
      parts.push(`<path d="M${M + 8} ${cy} l2.8 3 l5.4 -6.2" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (s.state === 'active') {
      parts.push(`<circle class="ring-active" cx="${M + 12}" cy="${cy}" r="${R}"/>`)
    } else {
      parts.push(`<circle class="ring-todo" cx="${M + 12}" cy="${cy}" r="${R}"/>`)
    }
    let ty = cy + 6
    for (const line of s.label) {
      parts.push(`<text class="t" x="${TX}" y="${Math.round(ty)}" font-size="${FONT + 1}" font-weight="600">${esc(line)}</text>`)
      ty += 20
    }
    if (s.note.length) {
      ty += 3
      for (const line of s.note) {
        parts.push(`<text class="t-dim" x="${TX}" y="${Math.round(ty)}" font-size="${FONT - 2}">${esc(line)}</text>`)
        ty += 16
      }
    }
  })
  return { svg: svgDoc(height, parts.join('')), warnings }
}
