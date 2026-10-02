// index.js — DSH host adapter. The ONLY file in this package importing @deepseek-ai/* packages.
// All real logic lives in portable modules (lib/) that are unit-tested without cordis.
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { drawFigure, FigureError, validateSpec, formatErrors, GUIDANCE_TEXT, GUIDANCE_TITLE } from './lib/engine.js'
import { decideNudge, NUDGE_REMINDER, NUDGE_SOURCE } from './lib/nudge.js'
import { writeFigure, pruneFigures, figureRelPath, figureDirName } from './lib/host-utils.js'

export const name = 'inline-figures'
export const inject = ['tools', 'systemPrompt']
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  /** Inject one figure-usage reminder into the next step when a session answers with figures far below the guidance rate. */
  nudge: z.boolean().default(true).volatile(),
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

  // Per-agent figure usage for the nudge. WeakMap: entries die with the agent.
  // drawCalls counts from within this process (the tool's execute is the one
  // place every successful draw passes through); a resumed session that drew
  // before a restart starts at zero, and the earliest two answered turns simply
  // see no nudge - a safe, self-correcting floor.
  const usage = new WeakMap()
  const usageOf = (agent) => {
    let u = usage.get(agent)
    if (!u) {
      u = { drawCalls: 0, turns: 0, nudgesSent: 0 }
      usage.set(agent, u)
    }
    return u
  }

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
      // Robust session identity + safe dir name (see figureDirName). The
      // figure dir and the URL we return MUST stay in lockstep: same input,
      // same function. 'session-' dirs were observed on the GUI once the
      // session surface misbehaved; the guard makes that state impossible.
      const sid = exec.agent?.sessionId ?? exec.agent?.session?.header?.id
      const dirName = figureDirName(sid)
      const dir = path.join(cwd, '.dsh-figures', dirName)
      const { file } = await writeFigure(dir, rendered.svg, args.slug ?? args.spec.kind)
      exec.signal.throwIfAborted()
      await pruneFigures(dir, FIGURE_LIMIT)
      const rel = `.dsh-figures/${dirName}/${file}`
      // Count the successful draw for the nudge policy of this agent.
      if (exec.agent) usageOf(exec.agent).drawCalls += 1
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

  // Soft nudge, modeled exactly on the first-party repeat-tool-reminder plugin:
  // it adds one short, self-contained reminder to the NEXT tool call's
  // post-execute `additionalContexts` (the loop accepts those into the same
  // step). No inject list beyond tools/systemPrompt is needed: every listener
  // receives the acting `agent`, and counting lives entirely in the
  // tool/post-execute + agent/pre-step waterfalls the plugin already sees.
  // Turns count from user prompts (pre-step batches containing a user-source
  // message), turns never figures - a session drawing at or above the guidance
  // rate never hears from us; a silent one is nudged at most maxNudges times.
  if (config.nudge) {
    // NOTE: a waterfall listener receives `next` bound by ctx.waterfall(...),
    // never by ctx.emit(...). Tests driving these listeners MUST call
    // ctx.waterfall('tools/post-execute', ...) (see scripts/_repro-nudge.mjs).
    ctx.on('tools/post-execute', async ({ agent, name: toolName }, result, next) => {
      const downstream = await next()
      if (!agent || toolName === 'draw_figure' || result?.kind === 'block') return downstream
      const u = usageOf(agent)
      if (decideNudge(u) !== 'remind') return downstream
      u.nudgesSent += 1
      const reminder = createUserMessage({
        content: [{ type: 'text', text: NUDGE_REMINDER }],
        source: { ...NUDGE_SOURCE, form: 'notice', summary: 'inline-figures nudge' },
      })
      return { ...downstream, additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])] }
    })
    ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      // One answered turn begins when a step batch carries a user prompt.
      // (A mid-turn restart can re-count a turn; over-counting only nudges
      // slightly earlier - safe direction.)
      if (messages.some((message) => message.source?.kind === 'user')) usageOf(agent).turns += 1
      return next()
    })
  }
}
