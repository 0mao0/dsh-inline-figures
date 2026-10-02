// index.js — DSH host adapter. The ONLY file in this package importing @deepseek-ai/* packages.
// All real logic lives in portable modules (lib/) that are unit-tested without cordis.
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { drawFigure, FigureError, validateSpec, formatErrors, GUIDANCE_TEXT, GUIDANCE_TITLE } from './lib/engine.js'
import { writeFigure, pruneFigures, figureRelPath } from './lib/host-utils.js'

export const name = 'inline-figures'
export const inject = ['tools', 'systemPrompt']
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
})

const FIGURE_LIMIT = 200

const SPEC_DESCRIPTION = [
  'Figure spec. kind=raw_svg (preferred for free-form structures: trees, branching pipelines, state flows, custom diagrams): {svg} - a bare <svg> fragment with viewBox="0 0 680 H", labels as <text> font-size >= 12, using the theme-aware classes and class="line" for arrows; no scripts or external references. Preset kinds below compute layout deterministically.',
  'kind=architecture: {title, layers:[{label, note?, tone?: default|danger, badge?: 1-4 chars, nodes:[{label, note?}]}] (2-6 layers, 1-6 nodes each), edges?: [{from, to, label?}], footnote?}.',
  'kind=compare: {title, columnHeads?: [left, right], rows:[{left:{label, note?}, right:{label, note?, tone?: default|danger|ok|muted}}] (1-6 rows), footnote?}.',
  'kind=timeline: {title, steps:[{label, note?, state?: done|active|todo}] (2-10 steps)}.',
  'kind=chart: {title, chartType: bar|line|pie, data:[{label, value>=0}] (1-12 items), unit?}.',
].join(' ')

export function apply(ctx, config) {
  if (!config.enabled) return

  ctx.tools.register(defineTool({
    name: 'draw_figure',
    description: 'Render an explanatory vector figure and return the inline markdown line to copy VERBATIM into your reply. Preferred: hand-author an SVG for free-form structures and pass kind=raw_svg; preset kinds architecture/compare/timeline/chart compute layout from JSON specs. The figure is saved in the session workspace and rendered full-width. Use it by judgment, but lean toward drawing: wherever the answer carries structure (components and relations, a flow or sequence, a timeline/state machine, a comparison, counts/proportions/a ranking), draw a figure THERE and delete the paragraph it replaces. Most explanatory answers want at least one figure; a multi-topic answer wants one per structure. A figure replaces prose, it does not stack on it. Only atomic replies are exempt (one number, one date, one name, a one-line definition, a small edit, pure code). Never use ASCII art instead.',
    parameters: {
      // dsh-tools' compiler requires every `type:'object'` node to declare
      // additionalProperties. spec is heterogeneous (raw_svg vs. the four preset
      // kinds, each with its own nested layers/nodes/rows/steps/data), so the
      // schema is intentionally OPEN here (additionalProperties: true): the host
      // compiles and passes it through, and the real, deep validation lives in
      // validateSpec()/drawFigure() at execute time — the designed check path.
      spec: { type: 'object', required: true, additionalProperties: true, description: SPEC_DESCRIPTION },
      alt: { type: 'string', required: true, description: 'Short descriptive alt text for the figure.' },
      slug: { type: 'string', description: 'Short kebab-case word for the file name (default: the figure kind).' },
    },
    output: {
      // The output "value schema" DSL differs from the parameter DSL: use a
      // per-property `required: true` flag only — a top-level required array is rejected.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'Figure file path relative to the session workspace.' },
          markdown: { type: 'string', required: true, description: 'Inline image markdown to copy verbatim into the reply.' },
          warnings: { type: 'array', required: true, items: { type: 'string' }, description: 'Non-fatal layout notes (truncated labels and similar).' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Figure saved: ${value.path}\nInsert this line verbatim into your reply where the figure belongs:\n${value.markdown}${value.warnings.length > 0 ? `\nLayout warnings: ${value.warnings.join('; ')}` : ''}`,
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const cwd = exec.agent?.session?.header?.cwd
      if (typeof cwd !== 'string' || cwd === '') throw new Error('draw_figure requires a session workspace; continue the answer in prose.')
      const errors = validateSpec(args.spec)
      if (errors.length > 0) throw new Error(`draw_figure spec invalid: ${formatErrors(errors)}`)
      let rendered
      try {
        rendered = drawFigure(args.spec)
      } catch (error) {
        if (error instanceof FigureError) throw new Error(`draw_figure failed: ${error.code}: ${error.message}`)
        throw error
      }
      exec.signal.throwIfAborted()
      const sid8 = String(exec.agent.session.header.id).slice(0, 8)
      const dir = path.join(cwd, '.dsh-figures', sid8)
      const { file } = await writeFigure(dir, rendered.svg, args.slug ?? args.spec.kind)
      exec.signal.throwIfAborted()
      await pruneFigures(dir, FIGURE_LIMIT)
      const rel = figureRelPath(exec.agent.session.header.id, file)
      return { path: rel, markdown: `![${args.alt}](${rel})`, warnings: rendered.warnings }
    },
  }))

  // systemPrompt.section() treats `text` as a literal string (interpolate:false
  // bypasses variable interpolation entirely) — a function here would be
  // stringified into the prompt. Tool visibility is gated by `config.enabled`.
  ctx.systemPrompt.section({
    name: GUIDANCE_TITLE,
    order: 9100,
    interpolate: false,
    text: GUIDANCE_TEXT,
  })
}
