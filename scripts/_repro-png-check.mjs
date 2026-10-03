// E2E: mount the real cordis services, then the plugin from this checkout, and
// execute every spec kind. Asserts the PNG embed, the PNG magic bytes, the SVG
// twin, and that unloading the plugin removes the tool again (which only holds
// if every resource was registered through ctx.effect).
//
// Run from the package root with dependencies present:
//     node scripts/_repro-png-check.mjs
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '../index.js'

// The PNG must be fully opaque: a transparent canvas leaves light-mode text
// dark-on-dark in a dark GUI (the rasterizer ignores prefers-color-scheme).
const { loadSharp } = await import('./readme-assets.mjs')
const { sharp } = await loadSharp()

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()

async function step(label, target, config) {
  try { await root.registry.plugin(target, config ?? {}); console.log(`OK    ${label}`) }
  catch (e) { console.log(`THREW ${label}: ${e?.message ?? e}\n` + (e?.stack ?? '').split('\n').slice(1, 6).join('\n')) }
}

await step('SystemPrompt', SystemPrompt, { personaPrefix: '' })
await step('ToolRuntime', ToolRuntime, {})
const plugin = { name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }
const fiber = await root.registry.plugin(plugin, {})
console.log('OK    inline-figures')

const tool = root.tools?.get?.('draw_figure', root)
console.log('draw_figure registered:', !!tool)
if (!tool) process.exit(1)

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
    const ok = typeof res?.markdown === 'string' && res.markdown.startsWith('![') && /\.png\)?$/.test(res.markdown)
    const onDisk = ok && fs.existsSync(path.join(cwd, res.path))
    const magic = onDisk && fs.readFileSync(path.join(cwd, res.path)).subarray(0, 4).toString('hex') === '89504e47'
    const svgTwin = onDisk && fs.existsSync(path.join(cwd, res.path.replace(/\.png$/, '.svg')))
    // Fully opaque: the PNG must not depend on the page background.
    let opaque = false
    if (onDisk && magic && sharp) {
      const { data, info } = await sharp(fs.readFileSync(path.join(cwd, res.path))).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let clear = 0
      for (let i = 3; i < data.length; i += info.channels) if (data[i] < 255) clear += 1
      opaque = clear === 0
    }
    const okAll = ok && onDisk && magic && svgTwin && opaque
    console.log(`${okAll ? 'PASS' : 'FAIL'} execute:${name} -> ${res?.path}  (png:${!!magic} svgTwin:${!!svgTwin} opaque:${opaque} warnings:${res?.warnings?.length ?? '?'})`)
    okAll ? pass++ : fail++
  } catch (e) {
    console.log(`FAIL execute:${name} -> ${e?.message ?? e}`)
    fail++
  }
}
fs.rmSync(cwd, { recursive: true, force: true })

// Disposal: host-plugin.md requires every contributed resource to be registered
// through ctx.effect, and the returned cleanup to remove it. If the tool
// survives an unload, disabling the plugin row leaves dead state behind.
await fiber?.dispose?.()
const leaked = !!root.tools?.get?.('draw_figure', root)
console.log(`${leaked ? 'FAIL' : 'PASS'} unload removes draw_figure (ctx.effect registration)`)
leaked ? fail++ : pass++

console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
