// E2E for the nudge path: mount real services + plugin, register a dummy tool,
// drive the tool/post-execute + agent/pre-step events, assert the reminder lands.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '@local/dsh-inline-figures'

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
  // Correct cordis usage: waterfall([thisArg,] event, ...args, end).
  // ctx.waterfall binds `next` per hop; end runs when the chain drains.
  return root.waterfall('agent/pre-step', { agent, messages: [{ source: { kind: hasUser ? 'user' : 'tool' } }] }, () => undefined)
}
async function firePost(agent, toolName) {
  const result = { kind: 'proceed' }
  // Single-listener chain: plugin returns its (possibly extended) result here.
  return root.waterfall('tools/post-execute', { agent, name: toolName }, result, () => result)
}

const agent = mkAgent()
let pass = 0, fail = 0
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`) }

// Turn 1: user prompt arrives, then a non-figure tool call completes.
await firePreStep(agent, true).catch((e) => console.log('preStep emit threw:', e.message))
let res = await firePost(agent, 'read').catch((e) => ({ threw: e.message }))
check('turn1 (1st turn) no nudge', !hasReminder(res))

// Turn 2: user prompt + another zero-figure tool call => nudge due (0 draws, 2 turns).
await firePreStep(agent, true).catch(() => {})
res = await firePost(agent, 'grep').catch((e) => ({ threw: e.message }))
check('turn2 reminds', hasReminder(res), JSON.stringify(res?.additionalContexts?.length ?? res))

// Turn 3 draws a figure => healthy rate => no more reminders.
await tool.execute({ spec: { kind: 'timeline', title: 't', steps: [{ label: 'A', state: 'done' }, { label: 'B' }] }, alt: 'x' }, { signal: new AbortController().signal, agent })
await firePreStep(agent, true).catch(() => {})
res = await firePost(agent, 'grep').catch((e) => ({ threw: e.message }))
check('healthy rate stays quiet', !hasReminder(res))

function hasReminder(r) {
  const list = r?.additionalContexts ?? []
  return list.some((m) => (m.source?.kind ?? '') === 'inline-figures-nudge')
}

fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
