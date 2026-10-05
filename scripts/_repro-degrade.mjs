// Verify the raster degradation path with the REAL event/runtime path: force the
// sharp layers to miss (DSH_INLINE_FIGURES_SHARP), then check that
//  - the embed becomes an inline SVG data URI (a relative .svg is a broken image
//    in the GUI, so falling straight through to it is the bug being fixed), and
//  - raster-diagnostic.txt lands in the session workspace where the user can read it.
// Run from the package root with dependencies present:
//     $env:DSH_INLINE_FIGURES_SHARP='C:\nonexistent\sharp.cjs'; node scripts/_repro-degrade.mjs
import fs from 'node:fs'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'

// Force every sharp layer to miss BEFORE the plugin module loads its layers.
process.env.DSH_INLINE_FIGURES_SHARP = 'C:\\nonexistent\\sharp-entry.cjs'
const pluginNs = await import('../index.js')

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()
await root.registry.plugin(SystemPrompt, { personaPrefix: '' })
await root.registry.plugin(ToolRuntime, {})
await root.registry.plugin({ name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }, {})

const cwd = fs.mkdtempSync(path.join('C:/Users/飞/Documents/deepseek-harness/default-workspace/_probe/', 'degrade-'))
const tool = root.tools.get('draw_figure', root)
const exec = { signal: new AbortController().signal, agent: { session: { header: { id: 'aaaabbbb-1111-2222-3333-444455556666', cwd } } } }

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`)
}

const small = await tool.execute({ spec: { kind: 'timeline', title: 'degrade', steps: [{ label: 'A', state: 'done' }, { label: 'B' }] }, alt: 'inline' }, exec)
check('a small figure degrades to an inline data URI', small.markdown.startsWith('![') && small.markdown.includes('data:image/svg+xml;base64,'))
check('degradation is reported to the model', small.warnings.some((w) => /PNG raster unavailable/.test(w)), JSON.stringify(small.warnings).slice(0, 120))

const dir = path.join(cwd, '.dsh-figures', 'aaaabbbb')
const diagPath = path.join(dir, 'raster-diagnostic.txt')
const diag = fs.existsSync(diagPath)
check('the failure is recorded in the session workspace', diag)
if (diag) console.log('  diagnostic:', fs.readFileSync(diagPath, 'utf8').trim().split('\n')[0].slice(0, 140))
check('the vector original is still archived', fs.existsSync(path.join(dir, '1-timeline.svg')))

// The inline budget is enforced at the seam, not through a tool call: the tool's
// own 32 KB spec cap means a rendered figure rarely exceeds the inline budget,
// and the over-budget branch must still keep a usable path + a loud warning.
const { svgDataUri, withBackdrop } = await import('../index.js')
const budget = svgDataUri(`<svg viewBox="0 0 680 120">${'x'.repeat(40 * 1024)}</svg>`)
check('the inline budget fails closed', budget.ok === false && budget.bytes > 32 * 1024, JSON.stringify(budget.bytes))
const withinBudget = svgDataUri('<svg viewBox="0 0 10 10"/>')
check('a small figure inlines', withinBudget.ok === true && withinBudget.uri.startsWith('data:image/svg+xml;base64,'))
check('the raster backdrop is still applied to the PNG input, not the archive', withBackdrop('<svg viewBox="0 0 10 10"/>').includes('fill="#fbfbfa"'))

fs.rmSync(cwd, { recursive: true, force: true })
console.log(`\nE2E: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
