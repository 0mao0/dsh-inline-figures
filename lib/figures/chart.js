// lib/figures/chart.js — portable bar/line/pie chart layout. No cordis / @deepseek-ai imports.
import { W, M, FONT, esc, textWidth, ellipsis, svgDoc, titleLine } from '../primitives.js'

// Soft pastel series colors: light enough to read as "gentle", dark enough to
// carry a data label / stay distinct on both light and dark backgrounds.
const SERIES = ['#7fa6d9', '#7bbf97', '#e2b371', '#a993d6', '#d99a9e', '#79c0b6', '#c98a6b', '#9bb06a']
const PLOT_H = 210
const TICK = 12

function niceTicks(maxV) {
  if (maxV <= 0) return { top: 1, ticks: [0, 1] }
  const raw = maxV / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const top = Math.ceil(maxV / step) * step
  const ticks = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { top, ticks }
}

function fmtNum(v) {
  return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)
}

export function chart(spec) {
  if (spec.chartType === 'pie') return pieChart(spec)
  const warnings = []
  const data = spec.data
  const n = data.length
  const seriesNames = spec.seriesNames
  // Grouped mode: one group per item, one bar per value. A "before vs after"
  // table is three groups of two, NOT five flat bars.
  const grouped = Array.isArray(seriesNames)
  const slots = grouped ? seriesNames.length : 1
  const valueAt = (d, s) => (grouped ? d.values[s] : d.value)
  let maxV = 0
  for (const d of data) {
    if (grouped) for (const v of d.values) maxV = Math.max(maxV, v)
    else maxV = Math.max(maxV, d.value)
  }
  const axisW = 50
  const x0 = M + axisW
  const x1 = W - M
  const top = M + (grouped ? 62 : 42)
  const { top: topV, ticks } = niceTicks(maxV)
  const yFor = (v) => Math.round(top + PLOT_H * (1 - v / topV))
  const baseline = top + PLOT_H
  const band = (x1 - x0) / n
  const centers = data.map((_, i) => Math.round(x0 + band * (i + 0.5)))
  const parts = [titleLine(spec.title)]
  if (grouped) {
    // Legend: series color -> series name, laid out left to right under the title.
    let lx = M
    const legendY = M + 30
    seriesNames.forEach((name, s) => {
      const fit = ellipsis(name, Math.max(60, (x1 - x0) / seriesNames.length - 34), FONT - 2)
      if (fit.truncated) warnings.push(`seriesNames[${s}] truncated`)
      parts.push(`<rect x="${lx}" y="${legendY - 9}" width="10" height="10" rx="2.5" fill="${SERIES[s % SERIES.length]}"/>`)
      parts.push(`<text class="t-dim" x="${lx + 15}" y="${legendY}" font-size="${FONT - 2}">${esc(fit.text)}</text>`)
      lx += textWidth(fit.text, FONT - 2) + 34
    })
  }
  for (const t of ticks) {
    const gy = yFor(t)
    parts.push(`<line class="${t === 0 ? 'axis' : 'grid'}" x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}"/>`)
    parts.push(`<text class="t-dim" x="${x0 - 8}" y="${gy + 4}" font-size="${TICK}" text-anchor="end">${esc(fmtNum(t))}</text>`)
  }
  const labelRoom = band - 10
  const rotate = data.some((d) => textWidth(d.label, FONT - 2) > labelRoom)
  if (rotate) warnings.push('x labels rotated 45° to avoid overlap')
  if (spec.chartType === 'bar') {
    const groupW = Math.min(96, band * 0.72)
    const gap = slots > 1 ? Math.min(6, groupW * 0.08) : 0
    const slotW = (groupW - gap * (slots - 1)) / slots
    const barW = slots > 1 ? slotW : Math.min(58, band * 0.62)
    const labelFits = barW >= 18
    data.forEach((d, i) => {
      for (let s = 0; s < slots; s++) {
        const v = valueAt(d, s)
        const left = grouped
          ? centers[i] - groupW / 2 + s * (slotW + gap)
          : centers[i] - barW / 2
        const h = Math.max(1, Math.round(PLOT_H * (v / topV)))
        parts.push(`<rect x="${left.toFixed(2)}" y="${baseline - h}" width="${barW.toFixed(2)}" height="${h}" rx="4" fill="${SERIES[(grouped ? s : i) % SERIES.length]}"/>`)
        if (labelFits) {
          parts.push(`<text class="t" x="${(left + barW / 2).toFixed(2)}" y="${baseline - h - 7}" font-size="${FONT - 2}" font-weight="600" text-anchor="middle">${esc(fmtNum(v))}</text>`)
        }
      }
      if (!labelFits) warnings.push(`group "${d.label}" bars are narrow: value labels omitted, read the axis`)
    })
  } else {
    const lines = grouped ? seriesNames.map((_, s) => s) : [0]
    for (const s of lines) {
      const pts = data.map((d, i) => `${centers[i]},${yFor(valueAt(d, s))}`)
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${SERIES[s % SERIES.length]}" stroke-width="2"/>`)
    }
    let thinned = false
    data.forEach((d, i) => {
      for (const s of lines) {
        const v = valueAt(d, s)
        parts.push(`<circle class="dot" cx="${centers[i]}" cy="${yFor(v)}" r="3.5" fill="${SERIES[s % SERIES.length]}"/>`)
        const show = n <= 8 || i % 2 === 1
        if (!show) thinned = true
        if (show) parts.push(`<text class="t-dim" x="${centers[i]}" y="${yFor(v) - 10}" font-size="${TICK}" text-anchor="middle">${esc(fmtNum(v))}</text>`)
      }
    })
    if (thinned) warnings.push('line value labels thinned to every other point')
  }
  data.forEach((d, i) => {
    const fit = ellipsis(d.label, rotate ? labelRoom * 1.3 : labelRoom, FONT - 2)
    if (fit.truncated) warnings.push(`data[${i}].label truncated`)
    const anchor = rotate ? 'end' : 'middle'
    const transform = rotate ? ` transform="rotate(-45 ${centers[i]} ${baseline + 18})"` : ''
    parts.push(`<text class="t-dim" x="${centers[i]}" y="${baseline + 20}" font-size="${FONT - 2}" text-anchor="${anchor}"${transform}>${esc(fit.text)}</text>`)
  })
  const height = Math.round(baseline + (rotate ? 58 : 30) + M - 12)
  return { svg: svgDoc(height, parts.join('')), warnings }
}

function pieChart(spec) {
  const warnings = []
  const data = spec.data
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = 86
  const cx = M + 112
  const cy = M + 42 + r
  const parts = [titleLine(spec.title)]
  let angle = -Math.PI / 2
  data.forEach((d, i) => {
    const color = SERIES[i % SERIES.length]
    const frac = d.value / total
    if (frac === 0) {
      warnings.push(`data[${i}].value is 0, slice skipped`)
      return
    }
    if (frac >= 1) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`)
      return
    }
    const a2 = angle + frac * Math.PI * 2
    const large = a2 - angle > Math.PI ? 1 : 0
    const x1 = (cx + r * Math.cos(angle)).toFixed(2)
    const y1 = (cy + r * Math.sin(angle)).toFixed(2)
    const x2 = (cx + r * Math.cos(a2)).toFixed(2)
    const y2 = (cy + r * Math.sin(a2)).toFixed(2)
    parts.push(`<path d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"/>`)
    angle = a2
  })
  const unit = spec.unit ? ` ${spec.unit}` : ''
  const legendX = M + 260
  let ly = cy - (data.length * 21) / 2 + 8
  data.forEach((d, i) => {
    const color = SERIES[i % SERIES.length]
    const pct = Math.round((d.value / total) * 1000) / 10
    const fit = ellipsis(`${d.label}  ${fmtNum(d.value)}${unit} · ${pct}%`, W - M - legendX - 22, FONT)
    if (fit.truncated) warnings.push(`data[${i}] legend truncated`)
    parts.push(`<rect x="${legendX}" y="${Math.round(ly - 11)}" width="12" height="12" rx="3" fill="${color}"/>`)
    parts.push(`<text class="t" x="${legendX + 20}" y="${Math.round(ly)}" font-size="${FONT}">${esc(fit.text)}</text>`)
    ly += 21
  })
  const height = Math.round(Math.max(cy + r, ly) + M - 14)
  return { svg: svgDoc(height, parts.join('')), warnings }
}
