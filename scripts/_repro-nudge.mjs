// E2E for the nudge path: mount real services + plugin, register a dummy tool,
// drive the tool/post-execute + agent/pre-step events, assert the reminder lands.
// Run from the package root with dependencies present:
//     node scripts/_repro-nudge.mjs
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '../index.js'

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()
const reg = async (target, config) => root.registry.plugin(target, config ?? {})

await reg(SystemPrompt, { personaPrefix: '' })
await reg(ToolRuntime, {})
const plugin = { name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }
await reg(plugin, {})

const tool = root.tools?.get?.('draw_figure', root)
console.log('registered:', !!tool)

// Fakes that satisfy the event payload shapes the plugin listens to.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-e2e-'))
const mkAgent = () => ({ session: { header: { id: 'nudge-session-0001', cwd } } })

// Drive the two waterfall events exactly as the host emits them:
// ('agent/pre-step', {agent, messages}, next) and
// ('tools/post-execute', {agent, name}, result, next).
// In cordis, a waterfall listener chain returns the LAST result, so the emit
// promise resolves to whatever the plugin's listener returned downstream.
async function firePreStep(agent, hasUser) {
  return root.waterfall('agent/pre-step', { agent, messages: [{ source: { kind: hasUser ? 'user' : 'tool' } }] }, () => undefined)
}
// The reply text is what the channels judge; `session/event` is how the plugin
// learns it. Emitting it here keeps the repro on the real event path.
async function fireAssistant(agent, text) {
  return root.emit('session/event', agent.session, { type: 'assistant/message', data: { content: [{ type: 'text', text }] } })
}
async function firePost(agent, toolName) {
  const result = { kind: 'proceed' }
  // Single-listener chain: plugin returns its (possibly extended) result here.
  return root.waterfall('tools/post-execute', { agent, name: toolName }, result, () => result)
}

// A structured answer (a table) with no figure: what opens the window in which
// the cheap channel may speak. Long enough to pass the structure floor
// (NUDGE_DEFAULTS.minChars), because a two-line reply is atomic by definition.
const STRUCTURED_REPLY = `| 项 | 现状 |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n${'说明。'.repeat(320)}`

const agent = mkAgent()
let pass = 0, fail = 0
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`) }

// Turn 1: a structured answer is written, then the next user prompt arrives.
await fireAssistant(agent, STRUCTURED_REPLY)
await firePreStep(agent, true).catch((e) => console.log('preStep emit threw:', e.message))
let res = await firePost(agent, 'read').catch((e) => ({ threw: e.message }))
check('turn1 (1st turn) no nudge', !hasReminder(res))
// Turn 2: the answer text is not in the turn ledger yet (an assistant message is
// still streaming), so the counter fallback applies and still waits for a
// DORMANT session (3+ answered turns with zero draws).
await firePreStep(agent, true).catch(() => {})
res = await firePost(agent, 'grep').catch((e) => ({ threw: e.message }))
check('turn2 stays quiet (dormant threshold not reached)', !hasReminder(res))

// Turn 3: three answered turns, zero draws, structured session => one reminder.
await firePreStep(agent, true).catch(() => {})
res = await firePost(agent, 'grep').catch((e) => ({ threw: e.message }))
if (process.env.DSH_IF_DEBUG === '1') console.log('DEBUG turn3 result:', JSON.stringify(res))
check('turn3 reminds a dormant structured session', hasReminder(res), JSON.stringify(res?.additionalContexts?.length ?? res))

// The model then draws => the strong channel owns this session, so the cheap
// channel goes quiet (see _repro-nudge-channels.mjs for the closing channel).
await tool.execute({ spec: { kind: 'timeline', title: 't', steps: [{ label: 'A', state: 'done' }, { label: 'B' }] }, alt: 'x' }, { signal: new AbortController().signal, agent })
await firePreStep(agent, true).catch(() => {})
res = await firePost(agent, 'grep').catch((e) => ({ threw: e.message }))
check('a drawing session does not use the cheap channel', !hasReminder(res))

function hasReminder(r) {
  const list = r?.additionalContexts ?? []
  return list.some((m) => (m.source?.kind ?? '') === 'inline-figures-nudge')
}

fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
