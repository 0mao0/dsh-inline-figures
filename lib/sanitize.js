// lib/sanitize.js — portable string-level SVG sanitizer for model-authored escape-hatch figures.
// Defense in depth: the final carrier is an <img> element (browser isolates SVG scripts anyway).
import { styleBlock, defsBlock } from './primitives.js'
export class SanitizeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SanitizeError'
    this.code = code
  }
}

const FORBIDDEN = /(<script|<!DOCTYPE|<!ENTITY|<iframe|<embed|<object)/i
const COMMENT = /<!--[\s\S]*?-->/g
const FOREIGN = /<foreignObject[\s\S]*?<\/foreignObject>/gi
const EVENT_ATTR = /\son[a-z0-9-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const EXTERNAL_HREF = /\b(?:xlink:)?href\s*=\s*(?:"(?:https?:|data:|javascript:)[^"]*"|'(?:https?:|data:|javascript:)[^']*')/gi
const IMAGE_TAG = /<image\b[^>]*>/gi

export function sanitizeSvg(raw) {
  const text = String(raw).trim()
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) {
    throw new SanitizeError('SVG_ROOT', 'svg must be a bare <svg> ... </svg> fragment')
  }
  if ((text.match(/<svg[\s>]/g) ?? []).length !== 1) {
    throw new SanitizeError('SVG_ROOT', 'svg must contain exactly one root <svg> element')
  }
  if (FORBIDDEN.test(text)) {
    throw new SanitizeError('SVG_REJECTED', 'svg contains forbidden constructs (script, DOCTYPE, ENTITY, iframe, embed, object)')
  }
  const rootEnd = text.indexOf('>')
  const rootTag = text.slice(0, rootEnd)
  const viewBoxMatch = rootTag.match(/viewBox\s*=\s*"([^"]+)"/)
  if (!viewBoxMatch) {
    throw new SanitizeError('SVG_VIEWBOX', 'root <svg> must declare a viewBox (used for full-width scaling)')
  }
  const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number)
  const vw = parts[2]
  const vh = parts[3]
  if (!(vw > 0 && vh > 0)) {
    throw new SanitizeError('SVG_VIEWBOX', 'viewBox must have positive width and height')
  }
  const warnings = []
  const strip = (src, re, note) => {
    const out = src.replace(re, '')
    if (out !== src) warnings.push(note)
    return out
  }
  let svg = strip(text, COMMENT, 'comments removed')
  svg = strip(svg, FOREIGN, 'foreignObject removed')
  svg = strip(svg, EVENT_ATTR, 'on* event attributes removed')
  svg = strip(svg, EXTERNAL_HREF, 'external href references removed')
  svg = strip(svg, IMAGE_TAG, '<image> elements removed')
  // Take ownership of sizing: strip root width/height, emit intrinsic 1600 width so the browser scales to full column width.
  const headEnd = svg.indexOf('>')
  const root = svg.slice(0, headEnd).replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
  const outH = Math.round((1600 * vh) / vw)
  // Prepend the shared style sheet + arrow marker so hand-authored SVGs can use the theme-aware
  // classes (.box/.chip/.t/.line/... with prefers-color-scheme overrides, and class="line" arrows).
  // An author's own <style> follows and wins on equal specificity, so this is a floor, not a ceiling.
  svg = `${root} width="1600" height="${outH}">` + styleBlock() + defsBlock() + svg.slice(headEnd + 1)
  return { svg, warnings }
}
