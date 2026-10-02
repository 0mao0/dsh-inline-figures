// scripts/_repro-activate.mjs — activate inline-figures against REAL services,
// then actually INVOKE draw_figure end-to-end (schema-compile + execute) so a
// parameter-shape regression can never slip past again.
// Run inside the installed package dir: node _repro-activate.mjs
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '@local/dsh-inline-figures'

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()

async function step(label, target, config) {
  try { await root.registry.plugin(target, config ?? {}); console.log(`OK    ${label}`) }
  catch (e) { console.log(`THREW ${label}: ${e?.message ?? e}\n` + (e?.stack ?? '').split('\n').slice(1, 6).join('\n')) }
}

await step('SystemPrompt', SystemPrompt, { personaPrefix: '' })
await step('ToolRuntime', ToolRuntime, {})
const plugin = { name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }
await step('inline-figures', plugin, {})

const tool = root.tools?.get?.('draw_figure', root)
console.log('draw_figure registered:', !!tool)
if (!tool) process.exit(1)

// Fake exec: signal + agent.session.header.{id,cwd}. Write into a temp workspace.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'iff-verify-'))
const mkExec = () => ({
  signal: new AbortController().signal,
  agent: { session: { header: { id: 'verify-session-0001', cwd } } },
})

const cases = {
  raw_svg: { kind: 'raw_svg', svg: '<svg viewBox="0 0 680 120"><text class="t" x="20" y="60">hi</text></svg>' },
  architecture: { kind: 'architecture', title: 't', layers: [{ label: 'L1', nodes: [{ label: 'A' }] }, { label: 'L2', nodes: [{ label: 'B' }] }] },
  timeline: { kind: 'timeline', title: 't', steps: [{ label: 'A', state: 'done' }, { label: 'B' }] },
  compare: { kind: 'compare', title: 't', rows: [{ left: { label: 'x' }, right: { label: 'y' } }] },
  chart: { kind: 'chart', title: 't', chartType: 'bar', data: [{ label: 'a', value: 3 }, { label: 'b', value: 5 }] },
}

let pass = 0, fail = 0
for (const [name, spec] of Object.entries(cases)) {
  try {
    const res = await tool.execute({ spec, alt: `${name} verify`, slug: `verify-${name}` }, mkExec())
    const ok = typeof res?.markdown === 'string' && res.markdown.startsWith('![') && /\.svg\)?$/.test(res.markdown)
    console.log(`${ok ? 'PASS' : 'FAIL'} execute:${name} -> ${res?.path}  (warnings:${res?.warnings?.length ?? '?'})`)
    ok ? pass++ : fail++
  } catch (e) {
    console.log(`FAIL execute:${name} -> ${e?.message ?? e}`)
    fail++
  }
}
fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
