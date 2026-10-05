// index.js — DSH host adapter. The ONLY file in this package importing @deepseek-ai/* packages.
// All real logic lives in portable modules (lib/) that are unit-tested without cordis.
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import fsp from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { drawFigure, FigureError, validateSpec, formatErrors, GUIDANCE_TEXT, GUIDANCE_TITLE } from './lib/engine.js'
import { decideNudge, extractAssistantText, countFiguresIn, structureSignal, figureReferencesIn, isWorkspaceRelativeTarget, NUDGE_DEFAULTS, NUDGE_REMINDER, NUDGE_STEER, NUDGE_STEER_BROKEN_REF, NUDGE_STEER_BROKEN_TAIL, NUDGE_SOURCE } from './lib/nudge.js'
import { writeFigure, pruneFigures, figureRelPath, figureDirName } from './lib/host-utils.js'

// Rasterizer (option A): the GUI serves figure files with a CSP `sandbox`
// header, and Chromium refuses to rasterize an SVG served that way, so the
// embedded <img> fails. PNG has no document semantics and previews fine. We
// therefore rasterize every figure to PNG (2x) and embed the PNG, keeping the
// SVG as the archival vector copy.
//
// sharp is resolved in layers, first hit wins (cache only SUCCESS, see below):
//  1. <plugin>/node_modules/sharp/dist/index.cjs — the nested layout pnpm uses
//     for an isolated install, and the offline staging copy.
//  2. bare import('sharp') — Node resolution from this file. The official
//     plugin-manager install runs pnpm in the profile with the hoisted linker,
//     so a declared dependency lands at the profile root and resolves here.
//  3. ~/.dsh/cache/inline-figures/sharp-js — offline staging used when the
//     registry was unreachable (scripts/stage-sharp.mjs).
//     Layers 1 and 3 are extracted from the app install (asar wrapper +
//     unpacked native), byte-calibrated and smoke-tested by the staging script.
// Explicit file URLs are deterministic where Node's resolution is
// layout-dependent; a bare import alone was observed landing on an unrelated
// older copy in the user's home node_modules. Layer 2 exists because the
// official install layout has no nested copy to name.
// Any layer that throws is skipped; total failure degrades to SVG-only.
//
// A failure is cached per attempt, never forever: a failed load is retried on
// the next draw, so a machine that gains sharp mid-process recovers without a
// DSH restart. The last failure writes ONE line to raster-diagnostic.txt.
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const STAGED_SHARP = path.join(os.homedir(), '.dsh', 'cache', 'inline-figures', 'sharp-js', 'sharp', 'dist', 'index.cjs')
const LOCAL_SHARP = path.join(PLUGIN_DIR, 'node_modules', 'sharp', 'dist', 'index.cjs')
// Test/support hook: point every layer at one explicit entry file, so the
// degradation path (data URI + diagnostic) is exercisable without deleting an
// installed sharp. Unset in normal operation.
const SHARP_OVERRIDE = process.env.DSH_INLINE_FIGURES_SHARP

// The canvas the PNG is rasterized onto — the PNG only. A rasterizer has no
// prefers-color-scheme, so the theme-adaptive stylesheet collapses to its light
// values; without this the transparent canvas stayed dark on a dark GUI and
// dark text landed on it. The archived .svg keeps its transparent canvas, so a
// browser that renders it still follows the active theme.
const PNG_BACKDROP = '<rect width="100%" height="100%" fill="#fbfbfa"/>'
export function withBackdrop(svg) {
  return svg.replace(/(<svg\b[^>]*>)/, `$1${PNG_BACKDROP}`)
}

/** The workspace side of a figure path (`<cwd>/.dsh-figures/<dir>/`) or undefined. */
function figureDirOf(cwd, sid) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  return path.join(cwd, '.dsh-figures', figureDirName(sid))
}

/**
 * Record a raster degradation where the USER can find it. The session workspace
 * is the only path a host plugin may rely on: writing next to the plugin was
 * observed failing silently (an install under ~/.dsh is outside the shell
 * sandbox), which is why this failure stayed invisible. Never throws.
 */
async function writeDiagnostic(dir, reason) {
  if (dir === undefined) return
  try {
    await fsp.appendFile(
      path.join(dir, 'raster-diagnostic.txt'),
      `${new Date().toISOString()}  ${String(reason).slice(0, 400)}\n`,
    )
  } catch {}
}

// 32 KB of SVG becomes ~43 KB of base64 — large enough for a full-width figure,
// small enough that one inline chat message stays sane.
const DATA_URI_MAX_BYTES = 32 * 1024

/**
 * Embed the SVG as a data URI. The GUI serves figure files with
 * `Content-Security-Policy: sandbox; default-src 'none'`, and Chromium refuses
 * to rasterize an SVG loaded that way — so a relative `.svg` link is a broken
 * image in the GUI (measured, 2026-10-05). A data URI is an image, not a
 * document, so it renders. It is the fallback for a missing rasterizer, not the
 * default: it costs message bytes and hides the figure from the workspace.
 */
export function svgDataUri(svg) {
  const bytes = Buffer.byteLength(svg, 'utf8')
  if (bytes > DATA_URI_MAX_BYTES) return { ok: false, bytes }
  return { ok: true, bytes, uri: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}` }
}

/**
 * Figure references in an answer whose file is NOT on disk. A reference is
 * reported only when it is a workspace-relative path: absolute paths, `http(s)`
 * URLs and data URIs are the caller's business, not ours. Pure Node, no host.
 */
export function unverifiedFigureRefs(text, cwd) {
  if (typeof text !== 'string' || text === '' || typeof cwd !== 'string' || cwd === '') return []
  const broken = []
  for (const ref of figureReferencesIn(text)) {
    if (!isWorkspaceRelativeTarget(ref.target)) continue
    const abs = path.resolve(cwd, ref.target.replace(/[?#].*$/, ''))
    let ok = false
    try {
      ok = fs.existsSync(abs)
    } catch {
      ok = false
    }
    if (!ok) broken.push({ alt: ref.alt, target: ref.target })
  }
  return broken
}

/** The newest N figure files in a session's figure directory, as relative paths. */
async function availableFigureFiles(dir, limit = 8) {
  let names = []
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const figures = []
  for (const name of names) {
    if (!/\.(?:svg|png)$/.test(name)) continue
    try {
      figures.push({ name, mtimeMs: (await fsp.stat(path.join(dir, name))).mtimeMs })
    } catch {}
  }
  figures.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'en'))
  return figures.slice(0, limit).map((f) => `.dsh-figures/${path.basename(dir)}/${f.name}`)
}

/** The repair instruction for the broken references of one answer. */
export function brokenRefSteer(broken, available) {
  const lines = [NUDGE_STEER_BROKEN_REF]
  for (const ref of broken) lines.push(`- ${ref.target}${ref.alt === '' ? '' : `  (alt: ${ref.alt.slice(0, 60)})`}`)
  lines.push(available.length > 0
    ? `Figures that DO exist in this session (newest first):\n${available.map((p) => `- ${p}`).join('\n')}`
    : 'This session has written no figure files yet, so every reference must come from a draw_figure result.')
  lines.push(NUDGE_STEER_BROKEN_TAIL)
  return lines.join('\n')
}

let rasterPromise = null
function loadRasterizer() {
  if (rasterPromise === null) {
    rasterPromise = (async () => {
      const attempts = [
        async () => {
          const mod = await import(pathToFileURL(SHARP_OVERRIDE ?? LOCAL_SHARP).href)
          return mod.default ?? mod
        },
        async () => {
          if (SHARP_OVERRIDE !== undefined) throw new Error('sharp override in use')
          const mod = await import('sharp')
          return mod.default ?? mod
        },
        async () => {
          if (SHARP_OVERRIDE !== undefined) throw new Error('sharp override in use')
          const mod = await import(pathToFileURL(STAGED_SHARP).href)
          return mod.default ?? mod
        },
      ]
      const failures = []
      for (const [i, attempt] of attempts.entries()) {
        try {
          const factory = await attempt()
          if (typeof factory === 'function') return factory
          failures.push(`L${i + 1}: sharp export shape unexpected`)
        } catch (error) {
          failures.push(`L${i + 1}: ${String(error?.message ?? error).split('\n')[0].slice(0, 120)}`)
        }
      }
      return { reason: failures.join(' | ').slice(0, 400) }
    })()
  }
  return rasterPromise
}

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
  'kind=chart: {title, chartType: bar|line|pie, unit?, seriesNames?: [2-6 names], data:[{label, value>=0} or {label, values:[2-6 numbers]}] (1-12 items)}. A comparison (before/after, arm A/B, two time points) uses GROUPS: {seriesNames: ["修前","修后"], data: [{label:"图边", values:[13,41]}]} draws one group of two bars per metric. NEVER flatten a comparison into one bar per metric-and-time with the time concatenated into the label: it stops being a comparison, and a missing half is rejected.',
].join(' ')

export function apply(ctx, config) {
  if (!config.enabled) return

  // Per-session figure usage for the nudge. Keyed by SESSION (not agent) because
  // the `session/event` observer must find the counters of the session that
  // emitted the event, and a WeakMap cannot be iterated. Entries die with the
  // agent (`agent/disposed`), so the map cannot grow with a long-lived host.
  // drawCalls counts from within this process (the tool's execute is the one
  // place every successful draw passes through); a resumed session that drew
  // before a restart starts at zero, and the earliest two answered turns simply
  // see no nudge - a safe, self-correcting floor.
  const usage = new Map()
  // The assistant's latest text, keyed by session, held OUTSIDE the usage ledger:
  // the first answer of a session arrives before that session has any counters
  // (measured: usage was empty when the message landed), and the ledger clears
  // its own copy at every turn boundary. Without this map the text was dropped
  // and every structure check silently saw an empty answer.
  const latestText = new Map()
  const sessionKeyOf = (agent) => {
    const candidates = [agent?.session?.id, agent?.session?.header?.id, agent?.sessionId, agent?.id]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate !== '') return candidate
    }
    return 'unknown'
  }
  ctx.on('agent/disposed', ({ agent }) => {
    const key = sessionKeyOf(agent)
    usage.delete(key)
    latestText.delete(key)
  })
  const usageOf = (agent) => {
    const key = sessionKeyOf(agent)
    let u = usage.get(key)
    if (!u) {
      u = {
        drawCalls: 0,
        turns: 0,
        nudgesSent: 0,
        steersSent: 0,
        lastNudgeTurn: undefined,
        lastSteerTurn: undefined,
        turnsSinceDraw: 0,
        embeddedFigures: 0,
        structured: false,
        sawText: false,
        lastAssistantText: '',
      }
      usage.set(key, u)
    }
    return u
  }

  // Host contract: every resource a plugin contributes is registered through
  // ctx.effect (or ctx.on) and its disposer returned, so disabling or unloading
  // the row actually removes the tool and the prompt section.
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'draw_figure',
    description: 'Render an explanatory vector figure and return the inline markdown line to copy VERBATIM into your reply. Preferred: hand-author an SVG for free-form structures and pass kind=raw_svg; preset kinds architecture/compare/timeline/chart compute layout from JSON specs. The figure is saved in the session workspace and rendered full-width. COPY the returned markdown line byte for byte - a file name you retype or invent points at nothing, and the reader sees a broken image. Use it by judgment, but lean toward drawing: wherever the answer carries structure (components and relations, a flow or sequence, a timeline/state machine, a comparison, counts/proportions/a ranking), draw a figure THERE and delete the paragraph it replaces. Most explanatory answers want at least one figure; a multi-topic answer wants one per structure. A figure replaces prose, it does not stack on it. Only atomic replies are exempt (one number, one date, one name, a one-line definition, a small edit, pure code). Never use ASCII art instead.',
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
          warnings: { type: 'array', required: true, items: { type: 'string' }, description: 'Non-fatal layout or embedding notes (truncated labels, raster degradation).' },
          coverage: { type: 'string', description: 'Session figure coverage: figures embedded in replies vs. figures drawn.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Figure saved: ${value.path}\nInsert this line verbatim into your reply where the figure belongs:\n${value.markdown}${value.coverage !== undefined ? `\n${value.coverage}` : ''}${value.warnings.length > 0 ? `\nLayout warnings: ${value.warnings.join('; ')}` : ''}`,
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
      const svgRel = `.dsh-figures/${dirName}/${file}`
      // Rasterize for preview (see loadRasterizer). Failures must never fail the
      // draw, but they must also never leave a broken image: a relative .svg link
      // IS broken in the GUI (CSP `sandbox` on /api/file). So the fallback order
      // is PNG -> inline data URI -> (too large) relative SVG with a warning).
      let embedRel = svgRel
      let inlineUri
      const raster = await loadRasterizer()
      let rasterFailure
      if (typeof raster === 'function') {
        try {
          const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?)/.exec(rendered.svg)
          const baseWidth = viewBox ? Math.max(160, Math.min(1200, Number(viewBox[1]))) : 680
          const png = await raster(Buffer.from(withBackdrop(rendered.svg), 'utf8'))
            .resize({ width: baseWidth * 2 })
            .png()
            .toBuffer()
          exec.signal.throwIfAborted()
          const pngFile = file.replace(/\.svg$/, '.png')
          await fsp.writeFile(path.join(dir, pngFile), png)
          embedRel = `.dsh-figures/${dirName}/${pngFile}`
        } catch (error) {
          rasterFailure = `raster call failed: ${String(error?.message ?? error).split('\n')[0].slice(0, 160)}`
        }
      } else {
        rasterFailure = `no rasterizer: ${raster.reason}`
      }
      if (rasterFailure !== undefined) {
        const inline = svgDataUri(rendered.svg)
        if (inline.ok) {
          inlineUri = inline.uri
          rendered.warnings.push(`PNG raster unavailable (${rasterFailure}); the figure is embedded as an SVG data URI so it still renders. Run the plugin's scripts/stage-sharp.mjs to restore PNG.`)
        } else {
          rendered.warnings.push(`PNG raster unavailable (${rasterFailure}) and the figure is too large to inline (${inline.bytes} bytes > ${DATA_URI_MAX_BYTES}); it is embedded as a relative .svg, which the GUI cannot render. Stage sharp or shrink the figure.`)
        }
        await writeDiagnostic(dir, rasterFailure)
      }
      await pruneFigures(dir, FIGURE_LIMIT)
      // Count the successful draw for the nudge policy of this agent.
      const u = exec.agent ? usageOf(exec.agent) : undefined
      if (u !== undefined) {
        u.drawCalls += 1
        u.turnsSinceDraw = 0
      }
      // Coverage: figures actually embedded in replies vs. figures drawn. A
      // session at 12 draws and 0 embeds looks healthy to a draw counter while
      // the reader sees nothing, so the ratio is reported, not just the count.
      let coverage
      if (u !== undefined && u.embeddedFigures > 0) {
        const rate = Math.round((Math.min(u.embeddedFigures, u.drawCalls) / u.drawCalls) * 100)
        coverage = `Figures embedded in replies so far: ${u.embeddedFigures} of ${u.drawCalls} drawn (${rate}%).`
      }
      const embed = inlineUri === undefined ? embedRel : inlineUri
      // The returned value must be LOSSLESS JSON: the host validates every tool
      // result and rejects `undefined` as a value (dsh-tools: `value is not
      // lossless JSON`). So an absent `coverage` must be an ABSENT KEY, never a
      // key holding undefined - shipping `coverage: undefined` made every
      // draw_figure call fail for a whole session after 0.1.0.
      return {
        path: embedRel,
        markdown: `![${args.alt}](${embed})`,
        warnings: rendered.warnings,
        ...(coverage !== undefined ? { coverage } : {}),
      }
    },
  })), 'inline-figures: draw_figure tool')

  // systemPrompt.section() treats `text` as a literal string (interpolate:false
  // bypasses variable interpolation entirely) — a function here would be
  // stringified into the prompt. Tool visibility is gated by `config.enabled`.
  // section() returns "the exact Cordis effect disposer", so it is registered
  // the same way as the tool.
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: GUIDANCE_TITLE,
      order: 9100,
      interpolate: false,
      text: GUIDANCE_TEXT,
    }),
    'inline-figures: guidance section',
  )

  // The nudge watches the ANSWER, not a session average. The old counter-only
  // rule (draw rate below a ratio) was measurably wrong: the AnGIneer session
  // drew 12 figures over 29 turns - a "healthy" rate - while individual answers
  // shipped tables where a figure belonged, and the rule stayed silent for all
  // 29 turns (measured 2026-10-05). Two channels now share one decision core:
  //
  //   'remind' - one self-contained reminder rides the next tool result's
  //     `additionalContexts` (the mechanism the first-party
  //     repeat-tool-reminder uses). Costs no extra model step: the loop accepts
  //     the context into the step that is already running.
  //   'steer'  - the turn is closing on a structured, figure-less answer, so
  //     `agent.steer(...)` re-opens the inbox and the model owes another step.
  //     This is the channel that does not depend on the model remembering, and
  //     it costs one extra step, so it is capped hard and requires that the
  //     session has drawn at least once.
  //
  // NOTE: a waterfall listener receives `next` bound by ctx.waterfall(...),
  // never by ctx.emit(...). Tests driving these listeners MUST call
  // ctx.waterfall('tools/post-execute', ...) (see scripts/_repro-nudge.mjs).
  if (config.nudge) {
    ctx.on('tools/post-execute', async ({ agent, name: toolName }, result, next) => {
      const downstream = await next()
      if (!agent || toolName === 'draw_figure' || result?.kind === 'block') return downstream
      const u = usageOf(agent)
      // Judge the LAST completed answer, which is what `latestText` holds: the
      // turn ledger clears itself at the turn boundary, so reading the ledger
      // here always saw an empty string. A reminder attached now is read before
      // the model writes its next message, so it costs no extra model step.
      // `only: 'remind'`: a tool result can attach context, it cannot re-open the
      // turn. The closing channel owns 'steer'.
      const text = latestText.get(sessionKeyOf(agent))
      const verdict = decideNudge({ ...u, text }, { only: 'remind' })
      if (verdict !== 'remind') return downstream
      u.nudgesSent += 1
      u.lastNudgeTurn = u.turns
      const reminder = createUserMessage({
        content: [{ type: 'text', text: NUDGE_REMINDER }],
        source: { ...NUDGE_SOURCE, form: 'notice', summary: 'inline-figures nudge' },
      })
      return { ...downstream, additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])] }
    })

    // The closing-turn channel. `agent/turn-stopping` is a serial hook awaited
    // before the boundary commits; a listener that steers makes the machine
    // re-read its inbox, so fresh steering runs another step (host contract,
    // api-catalog). Anything that throws here must not break the turn.
    //
    // Two checks run here, and the FILE check comes first because a broken image
    // link is the worse outcome: the reader sees a box where the figure should
    // be. Measured 2026-10-05 in an AnGIneer session: 5 of 28 embedded figures
    // pointed at files that did not exist, because the model INVENTED a
    // plausible file name instead of copying the line the tool returned (the
    // tool wrote `23-challenge-verdict.png`; the answer linked
    // `23-mechanism-usage.svg`, and one path repeated `.dsh-figures/` twice).
    ctx.on('agent/turn-stopping', async ({ agent }) => {
      if (!agent) return
      const u = usageOf(agent)
      const key = sessionKeyOf(agent)
      const text = latestText.get(key)
      const cwd = agent?.session?.header?.cwd
      const figureDir = figureDirOf(cwd, agent?.session?.id ?? agent?.session?.header?.id ?? agent?.sessionId ?? agent?.id)
      const broken = unverifiedFigureRefs(text, cwd)
      // The repair shares the steer budget, so a model that keeps inventing file
      // names cannot loop the turn forever.
      if (broken.length > 0 && figureDir !== undefined && u.steersSent < NUDGE_DEFAULTS.maxSteers) {
        u.steersSent += 1
        u.lastSteerTurn = u.turns
        const available = await availableFigureFiles(figureDir)
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: brokenRefSteer(broken, available) }],
          source: { ...NUDGE_SOURCE, form: 'notice', summary: 'inline-figures broken reference' },
        }))
        return
      }
      if (decideNudge({ ...u, text }) !== 'steer') return
      u.steersSent += 1
      u.lastSteerTurn = u.turns
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: NUDGE_STEER }],
        source: { ...NUDGE_SOURCE, form: 'notice', summary: 'inline-figures closing check' },
      }))
    })

    // Read the log to learn what the model actually wrote: the last assistant
    // message is the text the channels judge. Two measured subtleties:
    //  - `session/event` is published from the session's own context. A listener
    //    here does receive those emissions (probe-verified), and `{ global: true }`
    //    states that intent explicitly - the option the first-party dsh-session
    //    invariant uses. The subscription was never the bug.
    //  - The text must be stored in `latestText` (keyed by session), NOT only in
    //    the usage ledger: the ledger is created lazily on the first pre-step, so
    //    a session's first answer arrived before it existed and was dropped, and
    //    the ledger clears its own copy at every turn boundary. Both failures
    //    left every structure check reading an empty answer.
    ctx.on('session/event', (session, event) => {
      if (event?.type !== 'assistant/message') return
      const text = extractAssistantText(event.data)
      if (text === '') return
      const key = sessionKeyOf({ session })
      latestText.set(key, text)
      const u = usage.get(key)
      if (u !== undefined) u.lastAssistantText = text
    }, { global: true })

    ctx.on('agent/pre-step', ({ agent, messages }, next) => {
      // One answered turn begins when a step batch carries a user prompt.
      // (A mid-turn restart can re-count a turn; over-counting only nudges
      // slightly earlier - safe direction.) The finished answer is committed
      // into the turn ledger here, so a channel always judges a complete answer.
      const u = usageOf(agent)
      if (messages.some((message) => message.source?.kind === 'user')) {
        const key = sessionKeyOf(agent)
        const answer = latestText.get(key) ?? ''
        u.turns += 1
        u.embeddedFigures += countFiguresIn(answer)
        if (answer !== '') u.sawText = true
        if (structureSignal(answer).structural) u.structured = true
        u.lastAssistantText = ''
        u.turnsSinceDraw += 1
      }
      return next()
    })
  }
}
