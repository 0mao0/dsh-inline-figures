// lib/engine.js — the public "./engine" entry: portable, zero @deepseek-ai imports (enforced by tests),
// usable as-is from any Node or browser app: drawFigure(spec) -> { svg, warnings }.
import { validateSpec, formatErrors, LIMITS } from './schema.js'
import { sanitizeSvg, SanitizeError } from './sanitize.js'
import { GUIDANCE_TEXT, GUIDANCE_TITLE } from './guidance.js'
import { architecture } from './figures/architecture.js'
import { compare } from './figures/compare.js'
import { timeline } from './figures/timeline.js'
import { chart } from './figures/chart.js'

export class FigureError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FigureError'
    this.code = code
  }
}

const FIGURES = { architecture, compare, timeline, chart }

export function drawFigure(spec) {
  const errors = validateSpec(spec)
  if (errors.length > 0) throw new FigureError('SPEC_INVALID', formatErrors(errors))
  if (spec.kind === 'raw_svg') {
    try {
      const { svg, warnings } = sanitizeSvg(spec.svg)
      return { svg, warnings }
    } catch (error) {
      if (error instanceof SanitizeError) throw new FigureError(error.code, error.message)
      throw error
    }
  }
  return FIGURES[spec.kind](spec)
}

export { validateSpec, formatErrors, LIMITS, sanitizeSvg, SanitizeError, GUIDANCE_TEXT, GUIDANCE_TITLE }
