// E2E: an answer that references a figure file which does NOT exist must be
// repaired at the closing turn, because the reader otherwise sees a broken-image
// box. Measured cause (2026-10-05): the model invented a plausible file name
// (`23-mechanism-usage.svg`) while the tool had returned
// `23-challenge-verdict.png`, and one path repeated `.dsh-figures/` twice.
//
// Run from the package root: node scripts/_repro-broken-refs.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '../index.js'

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()
await root.registry.plugin(SystemPrompt, { personaPrefix: '' })
await root.registry.plugin(ToolRuntime, {})
await root.registry.plugin({ name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }, {})

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-refs-'))
const agent = {
  sessionId: 'aaaa1111-2222-3333-4444-555566667777',
  session: { id: 'aaaa1111-2222-3333-4444-555566667777', header: { id: 'aaaa1111-2222-3333-4444-555566667777', cwd } },
  steer: (message) => steered.push(message),
}
const steered = []

const fireAssistant = (text) => root.emit('session/event', agent.session, { type: 'assistant/message', data: { content: [{ type: 'text', text }] } })
const fireTurnStopping = () => root.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
const text = (message) => message?.content?.[0]?.text ?? ''

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`)
}

// A real figure on disk, so the repair text has something to offer.
const dir = path.join(cwd, '.dsh-figures', 'aaaa1111')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, '7-real-figure.svg'), '<svg viewBox="0 0 10 10"/>')

const body = (extra) => `${extra}\n${'说明。'.repeat(320)}`

// 1. A broken reference: the answer links a file that was never written.
steered.length = 0
await fireAssistant(body('![编出来的图](.dsh-figures/aaaa1111/23-mechanism-usage.svg)'))
await fireTurnStopping()
check('a broken figure reference is repaired before the turn closes', steered.length === 1, `steers=${steered.length}`)
const repair = text(steered[0])
check('the repair names the broken path', repair.includes('23-mechanism-usage.svg'))
check('the repair offers the figures that do exist', repair.includes('.dsh-figures/aaaa1111/7-real-figure.svg'))
check('the repair tells the model to copy the returned line', /COPY the/.test(repair))
check('the repair carries producer identity', steered[0]?.source?.kind === 'inline-figures-nudge')

// 2. A doubled prefix - the other measured shape - is caught the same way.
steered.length = 0
await fireAssistant(body('![重复前缀](.dsh-figures/.dsh-figures/aaaa1111/7-real-figure.svg)'))
await fireTurnStopping()
check('a doubled .dsh-figures/ prefix is caught', steered.length === 1, `steers=${steered.length}`)

// 3. A reference to a file that DOES exist stays silent (no wasted model step).
steered.length = 0
await fireAssistant(body('![正常](.dsh-figures/aaaa1111/7-real-figure.svg)'))
await fireTurnStopping()
check('a valid reference stays silent', steered.length === 0, `steers=${steered.length}`)

// 4. An answer with no figure reference at all is not touched by this check.
steered.length = 0
await fireAssistant('这一行没有图。')
await fireTurnStopping()
check('a figure-less short answer stays silent', steered.length === 0, `steers=${steered.length}`)

// 5. Data URIs and remote URLs are not workspace paths: never reported.
steered.length = 0
await fireAssistant(body('![内联](data:image/svg+xml;base64,AAA) ![远端](https://example.com/a.png)'))
await fireTurnStopping()
check('data URIs and URLs are not treated as workspace files', steered.length === 0, `steers=${steered.length}`)

fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
