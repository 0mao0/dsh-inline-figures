import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideNudge,
  structureSignal,
  countFiguresIn,
  extractAssistantText,
  stripFences,
  NUDGE_DEFAULTS,
  NUDGE_REMINDER,
  NUDGE_STEER,
  NUDGE_SOURCE,
} from '../lib/nudge.js'

// A reply long enough that only its STRUCTURE decides the verdict.
const body = (extra) => `${extra}\n${'细粒度说明。'.repeat(120)}`

const TABLE_REPLY = body([
  '| 项 | 现状 | 目标 |',
  '| --- | --- | --- |',
  '| 语义层 | 逐字全带 | 不变 |',
  '| 证据层 | 压成一行 | 会话图 |',
].join('\n'))

const LIST_REPLY = body(
  ['计划分五步：', '- 第一步', '- 第二步', '- 第三步', '- 第四步', '- 第五步'].join('\n'),
)

const PROSE_REPLY = body('这段文字只讲一件事：把结论说清楚，没有别的结构。')

const FIGURE_REPLY = `${TABLE_REPLY}\n![某张图](.dsh-figures/abc12345/1-x.png)`

// A drawing session: counters plus the reply text the channels judge. Text
// travels in `usage`, never in `opts` (a caller that puts it in `opts` falls
// into the counter fallback, which is exactly the bug this shape prevents).
const U = (extra) => ({ turns: 6, drawCalls: 2, nudgesSent: 0, steersSent: 0, turn: 6, ...extra })

test('nudge defaults stay conservative about extra model steps', () => {
  assert.equal(NUDGE_DEFAULTS.minTurns, 2)
  assert.equal(NUDGE_DEFAULTS.maxNudges, 3)
  assert.equal(NUDGE_DEFAULTS.maxSteers, 2)
  assert.equal(NUDGE_DEFAULTS.gapTurns, 2)
})

test('structureSignal: tables and long lists are structural', () => {
  assert.equal(structureSignal(TABLE_REPLY).structural, true)
  assert.equal(structureSignal(TABLE_REPLY).reason, 'table')
  assert.equal(structureSignal(LIST_REPLY).reason, 'list')
})

test('structureSignal: comparison vocabulary marks prose structural', () => {
  const prose = body('方案 A 与方案 B 的取舍：前者快，后者稳。这是一段对比说明，没有表格也没有列表。')
  assert.equal(structureSignal(prose).structural, true)
  assert.equal(structureSignal(prose).reason, 'structure-words')
})

test('structureSignal: a short atomic reply is never structural', () => {
  assert.equal(structureSignal('docs 有 49 个文件').structural, false)
  assert.equal(structureSignal('docs 有 49 个文件').reason, 'too-short')
  assert.equal(structureSignal('').structural, false)
  assert.equal(structureSignal(undefined).structural, false)
})

test('structureSignal: an answer that already carries a figure is left alone', () => {
  assert.equal(structureSignal(FIGURE_REPLY).reason, 'already-has-figure')
  assert.equal(structureSignal(`${TABLE_REPLY}\n<img src="x.png">`).structural, false)
})

test('structureSignal: fenced code never counts as answer structure', () => {
  // A fenced table is code, not answer structure: the reply stays plain prose.
  const fenced = body(`\`\`\`\n${'| a | b |\n| --- | --- |\n'.repeat(6)}\`\`\``)
  assert.equal(structureSignal(fenced).reason, 'plain-prose')
  assert.equal(structureSignal(fenced).structural, false)
  assert.equal(stripFences('```\n| a |\n```\nkeep').includes('| a |'), false)
})

test('countFiguresIn counts markdown images and never code fences', () => {
  assert.equal(countFiguresIn(FIGURE_REPLY), 1)
  assert.equal(countFiguresIn('![](a.png) text ![](b.png)'), 2)
  assert.equal(countFiguresIn('```\n![](inside.png)\n```'), 0)
  assert.equal(countFiguresIn(''), 0)
})

test('extractAssistantText reads content blocks and streamed frames', () => {
  assert.equal(extractAssistantText({ content: [{ type: 'text', text: 'hi' }] }), 'hi')
  assert.equal(extractAssistantText({ content: 'plain' }), 'plain')
  assert.equal(extractAssistantText({ message: { content: [{ type: 'text', text: 'nested' }] } }), 'nested')
  assert.equal(extractAssistantText({ frame: { content: [{ type: 'text', text: 'framed' }] } }), 'framed')
  assert.equal(extractAssistantText(null), '')
  assert.equal(extractAssistantText({ content: [{ type: 'reasoning', text: 'skip' }] }), '')
})

test('first turn never nudges; silence waits for evidence', () => {
  assert.equal(decideNudge({ turns: 0, text: TABLE_REPLY }), 'none')
  assert.equal(decideNudge({ turns: 1, drawCalls: 1, text: TABLE_REPLY }), 'none')
})

test('a structured answer from a drawing session re-opens the turn (steer)', () => {
  assert.equal(decideNudge({ ...U({}), text: TABLE_REPLY }), 'steer')
  // The cheap channel is not spent on the same text: one answer, one delivery.
  assert.equal(decideNudge({ ...U({}), text: TABLE_REPLY }, { only: 'remind' }), 'none')
})

test('steer is capped and spaced; a second structural answer does not loop', () => {
  assert.equal(decideNudge({ ...U({ steersSent: 0 }), text: LIST_REPLY }), 'steer')
  // Already steered twice in this session: no channel fires, so no extra step.
  assert.equal(decideNudge({ ...U({ steersSent: 2 }), text: LIST_REPLY }), 'none')
  // Steered on the PREVIOUS turn: the gap keeps this answer quiet.
  assert.equal(decideNudge({ ...U({ steersSent: 1, turn: 6, lastSteerTurn: 5 }), text: LIST_REPLY }), 'none')
  // Steered two turns ago: due again.
  assert.equal(decideNudge({ ...U({ steersSent: 1, turn: 6, lastSteerTurn: 4 }), text: LIST_REPLY }), 'steer')
})

test('the cheap channel serves a structured session that has never drawn', () => {
  const stale = { turns: 6, drawCalls: 0, nudgesSent: 0, steersSent: 0, turn: 6, structured: true }
  assert.equal(decideNudge({ ...stale, text: TABLE_REPLY }), 'remind')
  // Never steered: a non-drawing session pays no extra model step.
  assert.equal(decideNudge({ ...stale, text: TABLE_REPLY }, { only: 'steer' }), 'none')
  assert.equal(decideNudge({ ...stale, nudgesSent: 3, text: TABLE_REPLY }), 'none')
  assert.equal(decideNudge({ ...stale, nudgesSent: 1, lastNudgeTurn: 5, text: TABLE_REPLY }), 'none')
})

// A working session - code, commits, verification logs - must be left alone even
// when a status answer carries a table. Only a session that has already produced
// a structured answer may be nudged, and only a drawing session may be steered.
test('a session with no structured answer is never touched', () => {
  const working = { turns: 9, drawCalls: 0, nudgesSent: 0, steersSent: 0, turn: 9, structured: false }
  assert.equal(decideNudge({ ...working, text: TABLE_REPLY }), 'none')
  const unknown = { turns: 9, drawCalls: 0, nudgesSent: 0, steersSent: 0, turn: 9 }
  assert.equal(decideNudge({ ...unknown, text: TABLE_REPLY }), 'none')
})

test('a figure-bearing or plain answer is never touched', () => {
  assert.equal(decideNudge({ ...U({}), text: FIGURE_REPLY }), 'none')
  assert.equal(decideNudge({ ...U({}), text: PROSE_REPLY }), 'none')
})

test('counter fallback fires only when the host never gave us answer text', () => {
  // An older host: no readable text ever, so the counter rule is all there is.
  const legacy = { turns: 5, drawCalls: 0, nudgesSent: 0, steersSent: 0, turn: 5, structured: true }
  assert.equal(decideNudge(legacy), 'remind')
  assert.equal(decideNudge(legacy, { only: 'steer' }), 'none')
  assert.equal(decideNudge({ ...legacy, turns: 2, turn: 2 }, { dormantTurns: 3 }), 'none')
  assert.equal(decideNudge({ ...legacy, structured: false }), 'none')
  // Text was readable in this session: an empty text is an ordinary mid-turn
  // state (the answer has not been written yet), so the fallback stays out.
  assert.equal(decideNudge({ ...legacy, sawText: true, text: '' }), 'none')
  assert.equal(decideNudge({ ...legacy, sawText: true, text: undefined }), 'remind')
})

test('garbage input degrades to none, never throws', () => {
  assert.equal(decideNudge(undefined), 'none')
  assert.equal(decideNudge({}), 'none')
  assert.equal(decideNudge({ drawCalls: 'x', turns: 'y', nudgesSent: null }), 'none')
  assert.equal(decideNudge({ turns: 5, drawCalls: 1, text: 42 }), 'none')
})

test('both reminders are self-contained and carry producer identity', () => {
  // Self-contained: survives compaction, so the rule is restated inline.
  for (const text of [NUDGE_REMINDER, NUDGE_STEER]) {
    assert.match(text, /inline-figures plugin/)
    assert.match(text, /draw_figure/)
    assert.match(text, /atomic/)
    assert.match(text, /DELETE the paragraph/)
    assert.equal(text.length <= 1000, true, 'stays one compact block')
  }
  assert.match(NUDGE_STEER, /before the turn closes/)
  assert.equal(NUDGE_SOURCE.kind, 'inline-figures-nudge')
})
