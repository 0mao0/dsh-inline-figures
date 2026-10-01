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
  'Figure spec. kind=architecture: {title, layers:[{label, note?, tone?: default|danger, badge?: 1-4 chars, nodes:[{label, note?}]}] (2-6 layers, 1-6 nodes each), edges?: [{from, to, label?}], footnote?}.',
  'kind=compare: {title, columnHeads?: [left, right], rows:[{left:{label, note?}, right:{label, note?, tone?: default|danger|ok|muted}}] (1-6 rows), footnote?}.',
  'kind=timeline: {title, steps:[{label, note?, state?: done|active|todo}] (2-10 steps)}.',
  'kind=chart: {title, chartType: bar|line|pie, data:[{label, value>=0}] (1-12 items), unit?}.',
  'kind=raw_svg: {svg} — a bare <svg> fragment with viewBox and no scripts or external references (sanitized).',
].join(' ')

export function apply(ctx, config) {
  if (!config.enabled) return

  ctx.tools.register(defineTool({
    name: 'draw_figure',
    description: 'Render an explanatory vector figure (architecture layers, left/right compare, timeline, bar/line/pie chart) from a JSON spec, save it into the session workspace, and return the inline markdown line. Copy the returned markdown VERBATIM into your reply where the figure belongs. Interleave prose and figures; 1-3 figures per answer.',
    parameters: {
      spec: { type: 'object', required: true, description: SPEC_DESCRIPTION },
      alt: { type: 'string', required: true, description: 'Short descriptive alt text for the figure.' },
      slug: { type: 'string', description: 'Short kebab-case word for the file name (default: the figure kind).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'Figure file path relative to the session workspace.' },
          markdown: { type: 'string', required: true, description: 'Inline image markdown to copy verbatim into the reply.' },
          warnings: { type: 'array', required: true, items: { type: 'string' }, description: 'Non-fatal layout notes (truncated labels and similar).' },
        },
        required: ['path', 'markdown', 'warnings'],
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

  ctx.systemPrompt.section({
    name: GUIDANCE_TITLE,
    order: 9100,
    interpolate: false,
    text: ({ scope }) => (ctx.tools.get('draw_figure', scope) ? GUIDANCE_TEXT : ''),
  })
}
