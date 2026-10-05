// E2E for the two nudge channels against the real cordis services:
//  - a structured, figure-less answer read from `session/event` must ATTACH a
//    reminder to the next tool result (tools/post-execute), or STEER the closing
//    turn (agent/turn-stopping) when the session has drawn before;
//  - a figure-bearing answer must stay silent.
// Run from the package root: node scripts/_repro-nudge-channels.mjs
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '../index.js'

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()
await root.registry.plugin(SystemPrompt, { personaPrefix: '' })
await root.registry.plugin(ToolRuntime, {})
await root.registry.plugin({ name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }, {})

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-channels-'))
const steered = []
const agent = {
  sessionId: 'nudge-channels-0001',
  session: { header: { id: 'nudge-channels-0001', cwd } },
  steer: (message) => steered.push(message),
}

const body = (extra) => `${extra}\n${'细粒度说明。'.repeat(120)}`
const TABLE_REPLY = body(['| 项 | 现状 | 目标 |', '| --- | --- | --- |', '| A | 1 | 2 |', '| B | 3 | 4 |'].join('\n'))

// A figure that EXISTS, so "a figure-bearing answer is left alone" tests the
// channel and not the (separate) broken-reference repair. The session key is
// what figureDirName maps to, so the file lands where the check looks.
const FIGURE_SVG = '![图](.dsh-figures/nudge-channels-0001/1-timeline.svg)'
fs.mkdirSync(path.join(cwd, '.dsh-figures', 'nudge-channels-0001'), { recursive: true })
fs.writeFileSync(path.join(cwd, '.dsh-figures', 'nudge-channels-0001', '1-timeline.svg'), '<svg viewBox="0 0 10 10"/>')

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`)
}
const textOf = (message) => message?.content?.[0]?.text ?? ''

// Real host order inside one turn: user prompt enters a step (pre-step), the
// model streams an assistant message (session/event), a tool call completes
// (post-execute), and finally the turn tries to close (turn-stopping).
const firePreStep = () => root.waterfall('agent/pre-step', { agent, messages: [{ source: { kind: 'user' } }] }, () => undefined)
const firePost = async (name = 'read') => root.waterfall('tools/post-execute', { agent, name }, { kind: 'proceed' }, () => ({ kind: 'accept' }))
const fireAssistant = (text) => root.emit('session/event', agent.session, { type: 'assistant/message', data: { content: [{ type: 'text', text }] } })
const fireTurnStopping = () => root.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

const hasReminder = (r) => (r?.additionalContexts ?? []).some((m) => (m.source?.kind ?? '') === 'inline-figures-nudge')

// Turn 1 and 2: the model has drawn figures already (simulated through the tool
// path so the counters are real), then closes on a structured answer.
for (let turn = 1; turn <= 2; turn++) {
  await firePreStep()
  if (turn === 1) {
    // A real draw: counters (drawCalls) and the "has drawn" gate both come from here.
    const tool = root.tools.get('draw_figure', root)
    await tool.execute({ spec: { kind: 'timeline', title: 't', steps: [{ label: 'A', state: 'done' }, { label: 'B' }] }, alt: 'x' }, { signal: new AbortController().signal, agent })
  }
  await fireAssistant(TABLE_REPLY)
  await firePost('grep')
}

// A drawing session that closes on a structured, figure-less answer: the closing
// channel must steer, whatever the post-execute channel did or did not attach.
steered.length = 0
await fireAssistant(TABLE_REPLY)
await fireTurnStopping()
check('closing channel steers a structured answer', steered.length === 1, `steers=${steered.length}`)
check('the steer carries producer identity', steered[0]?.source?.kind === 'inline-figures-nudge', JSON.stringify(steered[0]?.source))

// The answer now carries the figure it was missing: the next turn must stay silent.
steered.length = 0
await firePreStep()
await firePreStep()
await fireAssistant(`${TABLE_REPLY}\n${FIGURE_SVG}`)
await fireTurnStopping()
check('a figure-bearing answer is left alone', steered.length === 0, `steers=${steered.length}`)

// The same answer with a path that does not exist is a different case, owned by
// the broken-reference repair (scripts/_repro-broken-refs.mjs covers it in full);
// this proves the two checks do not fight: the repair speaks, and it is not the
// structure steer.
steered.length = 0
await firePreStep()
await firePreStep()
await fireAssistant(`${TABLE_REPLY}\n![编的](.dsh-figures/nudge-channels-0001/9-invented.svg)`)
await fireTurnStopping()
check('an invented path is repaired, not ignored', steered.length === 1, `steers=${steered.length}`)
check('the repair is the broken-reference notice', /DO NOT\s+EXIST/.test(textOf(steered[0])), textOf(steered[0]).slice(0, 80))

// An atomic answer never triggers anything, even on a drawing session.
steered.length = 0
await firePreStep()
await firePreStep()
await fireAssistant('docs 有 49 个文件')
await fireTurnStopping()
check('an atomic answer is left alone', steered.length === 0, `steers=${steered.length}`)

// A tool result can attach a reminder, but it must never be the steer decision.
await firePreStep()
await fireAssistant(TABLE_REPLY)
const postResult = await firePost('grep')
check('post-execute never steals the closing channel', !hasReminder(postResult) || steered.length === 0, `reminder=${hasReminder(postResult)}`)

fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
