// lib/nudge.js — portable nudge decision core. Zero dependencies; host-agnostic.
//
// A nudge fires when the ANSWER, not the scoreboard, shows structure that a
// figure should have carried. The host adapter feeds in:
//   - the reply text gathered so far in the turn (streamed assistant messages),
//   - per-session counters (turns, draws, nudges sent, last nudge turn).
//
// Two delivery channels, both decided here:
//   'remind' — attach one reminder to a tool result's additionalContexts. The
//              model reads it before it writes the next message. No extra step.
//   'steer'  — the turn is closing with a figure-less structured answer:
//              `agent.steer(...)` re-opens the inbox, so the model owes another
//              step and draws. This is the channel that does not depend on the
//              model remembering.
//
// The old counter-only rule (draw rate below a ratio) was measurably wrong: a
// healthy average silently licenses individual figure-less structured answers.

export const NUDGE_REMINDER = [
  'Inline-figure check (from the inline-figures plugin): your reply so far contains structure -',
  'a table, a long list, a comparison, counts, or a plan - but this conversation has no draw_figure',
  'call in the current turn. Before you write the next message, scan the answer for every structure',
  'point: components and relations, a flow or sequence, a comparison or trade-off, counts or',
  'proportions, a plan or phase list. Call draw_figure for each one and embed the returned markdown',
  'line where that point is discussed, then DELETE the paragraph it replaces. Only an atomic answer',
  '(one number, one date, one name, a one-line definition, a small edit, pure code) may skip drawing.',
  'This applies even when the question is about our own tooling, status, or this plugin itself.',
].join(' ')

// The closing-turn variant: the answer is already written, so the instruction
// must ask for the figure to be ADDED to the reply, not planned into it.
export const NUDGE_STEER = [
  'Inline-figure check (from the inline-figures plugin): that answer carried structure but no figure.',
  'Add the missing figures before the turn closes. For each structure the answer explains - a',
  'components-and-relations map, a flow or sequence, a comparison or trade-off, counts or proportions,',
  'a plan or phase list - call draw_figure once, embed the returned markdown line at the point it',
  'illuminates, and DELETE the paragraph or table it replaces. Keep one short lead-in sentence before',
  'a figure and one takeaway sentence after it, and never stack two figures back to back. If the',
  'answer is genuinely atomic (one number, one date, one name, a one-line definition, a small edit,',
  'pure code), reply with it unchanged and this reminder will not repeat.',
].join(' ')

// The repair variant: the answer references figures whose files do not exist, so
// the reader gets a broken-image box. A tool cannot place or verify the embed
// itself, so this closing check compares what the answer points at with what is
// actually on disk. Measured cause (2026-10-05): an AnGIneer session embedded
// `23-mechanism-usage.svg` while the tool had returned `23-challenge-verdict.png`
// - the model invented a plausible name instead of copying the returned line, and
// three other answers referenced files that no run ever wrote.
export const NUDGE_STEER_BROKEN_REF = [
  'Inline-figure check (from the inline-figures plugin): this answer references figure files that DO NOT',
  'EXIST in the session workspace, so every reader sees a broken-image box. Repair the references now,',
  'before the turn closes:',
].join(' ')

/** The tail of the broken-reference steer, shared by every caller. */
export const NUDGE_STEER_BROKEN_TAIL = [
  'For each broken one: if the file was never drawn, call `draw_figure` and use the markdown line it',
  'returns; if a figure for that point already exists, use one of the paths listed above. COPY the',
  'returned line EXACTLY - never retype it, never change the file name, and never repeat the',
  '`.dsh-figures/` directory prefix twice. Then remove the broken line from the answer.',
].join(' ')

const DEFAULTS = {
  /** Answered turns required before any nudge; also protects the first answer of a session. */
  minTurns: 2,
  /** Hard cap on reminders attached to tool results, per session. */
  maxNudges: 3,
  /** Hard cap on closing-turn steers, per session. A steer costs one extra model step. */
  maxSteers: 2,
  /** Answered turns that must pass between two deliveries of the same channel. */
  gapTurns: 2,
  /** Turns without a draw that mark a session as dormant (counter fallback only). */
  dormantTurns: 3,
  /** Text length below which an answer is never treated as structural. */
  minChars: 600,
  /** List items that make an answer structural without a table. */
  minListItems: 5,
}

// A table row: a pipe-delimited line that is not a fenced-code line.
const TABLE_ROW = /^\s*\|.*\|\s*$/
// A markdown list item, counted only when the answer has no table.
const LIST_ITEM = /^\s{0,6}(?:[-*+]|\d{1,2}[.)])\s+\S/
// Comparison / decision / plan vocabulary that marks prose as structural.
const STRUCTURE_WORDS = /(?:对照|对比|相比| versus |\bvs\.?\b|取舍|权衡|方案|选项|决策|路径|分支|流程|步骤|阶段|时序|里程碑|架构|分层|关系图|前后|差距|分布|占比|排名|trade-?off|comparison|versus|flow|pipeline|sequence|milestone|architecture|breakdown|gap)/i
// An embedded figure: markdown image, an HTML img tag, or a data URI.
const FIGURE_EMBED = /!\[[^\]]*\]\(|data:image\/|<img\b/i

/** Strip fenced code blocks so code never counts as answer structure. */
export function stripFences(text) {
  return String(text ?? '').replace(/```[\s\S]*?(?:```|$)/g, '').replace(/~~~[\s\S]*?(?:~~~|$)/g, '')
}

/** Extract plain text from an assistant message payload (content blocks or streamed frame). */
export function extractAssistantText(message) {
  if (message == null) return ''
  const candidates = [message.content, message.message?.content, message.frame?.content, message.delta?.content]
  for (const content of candidates) {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
    }
  }
  if (typeof message.text === 'string') return message.text
  return ''
}

/** Count embedded figures in a reply (markdown images, HTML img, data URIs). */
export function countFiguresIn(text) {
  const body = stripFences(text)
  const markdown = body.match(/!\[[^\]]*\]\(/g)
  const html = body.match(/<img\b/gi)
  return (markdown?.length ?? 0) + (html?.length ?? 0)
}

/**
 * Figure targets an answer embeds, in the order they appear. Data URIs are
 * inline and carry no path, so they never appear here.
 * @returns array of { alt, target }
 */
export function figureReferencesIn(text) {
  const body = stripFences(text)
  const refs = []
  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) {
    if (!match[2].startsWith('data:')) refs.push({ alt: match[1], target: match[2] })
  }
  for (const match of body.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)) {
    if (!match[1].startsWith('data:')) refs.push({ alt: '', target: match[1] })
  }
  return refs
}

/** Whether a target is a workspace-relative path (as opposed to a URL). */
export function isWorkspaceRelativeTarget(target) {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target) && !target.startsWith('/')
}

/**
 * Does this reply text carry structure that a figure should have carried?
 * Pure, so it is unit-tested without a host.
 *
 * `opts.structural: true` skips the "it already has a figure" shortcut, which is
 * what a caller needs when the question is "does this answer carry structure at
 * all". The closing channel asks that and then checks the figure paths itself,
 * because a broken image link is NOT a figure.
 */
export function structureSignal(text, opts = {}) {
  const { minChars, minListItems, structural } = { ...DEFAULTS, ...opts }
  const body = stripFences(text).trim()
  if (body.length < minChars) return { structural: false, reason: 'too-short', chars: body.length }
  if (structural !== true && FIGURE_EMBED.test(body)) return { structural: false, reason: 'already-has-figure', chars: body.length }
  const lines = body.split(/\r?\n/)
  const tableRows = lines.filter((line) => TABLE_ROW.test(line)).length
  if (tableRows >= 3) return { structural: true, reason: 'table', chars: body.length, tableRows }
  const listItems = lines.filter((line) => LIST_ITEM.test(line)).length
  if (listItems >= minListItems) return { structural: true, reason: 'list', chars: body.length, listItems }
  if (STRUCTURE_WORDS.test(body)) return { structural: true, reason: 'structure-words', chars: body.length }
  return { structural: false, reason: 'plain-prose', chars: body.length }
}

/**
 * Pure nudge decision from a usage snapshot.
 * @param usage - { drawCalls, turns, nudgesSent, steersSent, turn, lastNudgeTurn, lastSteerTurn, turnsSinceDraw, structured, text }
 *   `turn` / `lastNudgeTurn` / `lastSteerTurn` are 1-based answered-turn numbers.
 *   `structured` is true once this session has produced at least one structured
 *   answer; it gates the cheap channel, so a working session is never nudged.
 *   `text` is the reply text the channels judge; `null`/`undefined` means the
 *   answer could not be read and only the counter fallback applies. Text travels
 *   in `usage`, never in `opts`, so a caller cannot silently fall into the
 *   fallback by putting it in the wrong argument.
 * @param opts - tunable overrides. `only: 'remind' | 'steer'` restricts which
 *   channel a caller may open: a tool result can carry `additionalContexts` but
 *   cannot re-open a turn, and a closing turn can do both.
 * @returns 'none' | 'remind' | 'steer'
 */
export function decideNudge(usage, opts = {}) {
  const { minTurns, maxNudges, maxSteers, gapTurns, dormantTurns, only } = { ...DEFAULTS, ...opts }
  const draws = Math.max(0, Number(usage?.drawCalls) || 0)
  const turns = Math.max(0, Number(usage?.turns) || 0)
  const sent = Math.max(0, Number(usage?.nudgesSent) || 0)
  const steers = Math.max(0, Number(usage?.steersSent) || 0)
  const turn = Number(usage?.turn) || turns
  if (turns < minTurns) return 'none'

  // Channel selection. A session that has never drawn is answered with the
  // cheap channel only (a reminder that costs no extra model step), so a
  // non-drawing session never pays for two wasted steers. Once the model has
  // drawn, the strong channel owns structured answers: the cheap channel stays
  // out of the way, so one answer never burns two extra steps, and an exhausted
  // steer budget ends the conversation with us rather than looping through the
  // cheaper channel on the same text.
  const strongChannel = draws >= 1
  const maySteer = strongChannel && only !== 'remind'
  // The cheap reminder is the fallback for a host whose answer text we cannot
  // read (`text == null`). A working session - code, commits, verification logs -
  // must never be steered into drawing, so the reminder speaks only once this
  // session has shown structure AND has stopped drawing.
  const dormant = usage?.structured === true && (draws === 0
    ? turns >= dormantTurns
    : Number.isFinite(usage?.turnsSinceDraw) && usage.turnsSinceDraw >= dormantTurns)
  const mayRemind = !strongChannel && dormant && only !== 'steer'

  if (usage?.text == null) {
    if (mayRemind && sent < maxNudges && gap(turn, usage?.lastNudgeTurn, gapTurns)) return 'remind'
    return 'none'
  }
  if (usage.text === '') return 'none'
  const signal = structureSignal(usage.text, opts)
  if (!signal.structural) return 'none'

  // Steer is the strong channel: the answer already exists and would ship
  // figure-less, so the turn must re-open.
  if (maySteer && steers < maxSteers && gap(turn, usage?.lastSteerTurn, gapTurns)) return 'steer'
  // Cheap channel behind a readable answer: a session that has stopped drawing
  // (or has spent its steer budget) still gets the reminder, never the steer.
  if (mayRemind && sent < maxNudges && gap(turn, usage?.lastNudgeTurn, gapTurns)) return 'remind'
  return 'none'
}

/** True when `gapTurns` answered turns separate `turn` from `last`. */
function gap(turn, last, gapTurns) {
  if (last == null) return true
  return Math.abs(turn - Number(last)) >= gapTurns
}

export const NUDGE_DEFAULTS = DEFAULTS

// Producer identity stamped on every injected reminder. The `{kind}` label is
// load-bearing: an unlabeled context would render as a user prompt in derived
// history (same contract as the first-party repeat-tool-reminder source).
export const NUDGE_SOURCE = { kind: 'inline-figures-nudge' }
