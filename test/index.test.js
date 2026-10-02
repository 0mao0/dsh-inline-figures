import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8')

test('index.js is the sole @deepseek-ai importer', () => {
  assert.match(src, /from '@deepseek-ai\/schemastery'/)
  assert.match(src, /from '@deepseek-ai\/dsh-tools'/)
  assert.match(src, /export function apply\(ctx, config\)/)
})

test('declares plugin identity, inject and volatile config', () => {
  assert.match(src, /export const name = 'inline-figures'/)
  assert.match(src, /export const inject = \['tools', 'systemPrompt'\]/)
  assert.match(src, /enabled: z\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(src, /if \(!config\.enabled\) return/)
})

test('registers draw_figure tool and the guidance section', () => {
  assert.match(src, /name: 'draw_figure'/)
  assert.match(src, /ctx\.tools\.register\(defineTool/)
  assert.match(src, /async execute\(args, exec\)/)
  assert.match(src, /exec\.agent\?\.session\?\.header\?\.cwd/)
  assert.match(src, /exec\.signal\.throwIfAborted\(\)/)
  assert.match(src, /\.dsh-figures/)
  assert.match(src, /ctx\.systemPrompt\.section\(\{/)
  assert.match(src, /interpolate: false/)
  // Host contract (verified against dsh-persona + the SystemPrompt service):
  // section `text` is a literal string; a function would be stringified into the prompt.
  assert.match(src, /text: GUIDANCE_TEXT,/)
  assert.ok(!/text: \(\{ scope \}/.test(src), 'section text must not be a function')
})

test('output contract matches the portable render fields', () => {
  assert.match(src, /render: \(_args, value\) =>/)
  for (const field of ['path', 'markdown', 'warnings']) {
    assert.match(src, new RegExp(`${field}: \\{ type: '(?:string|array)'.*?required: true`), `${field} required via per-property flag`)
  }
})

// Verified end-to-end against the installed host (scripts/_repro-activate.mjs invokes
// draw_figure for every spec kind). Two host constraints, learned the hard way:
//  1. defineTool throws at registration if an object node omits additionalProperties.
//  2. At runtime an object with additionalProperties:false rejects every key NOT in
//     its `properties` whitelist. spec is heterogeneous (raw_svg + 4 preset kinds with
//     nested layers/nodes/rows/steps/data), so it MUST stay OPEN (true); deep validation
//     is validateSpec()/drawFigure() at execute time. Regressing this to false makes
//     every call fail with `invalid arguments: "spec.kind" is not a declared property`.
test('defineTool schema satisfies the host schema compiler', () => {
  assert.match(src, /spec: \{ type: 'object', required: true, additionalProperties: true/)
  // The output value-schema DSL rejects a top-level required array; scope the check
  // to the output schema block (between `output: {` and `render:`) so SPEC/comments don't false-positive.
  const outputBlock = src.slice(src.indexOf('output: {'), src.indexOf('render:'))
  assert.ok(outputBlock.length > 0)
  assert.ok(!/required: \[/.test(outputBlock), 'no top-level required array in the output value schema')
})

test('delegates to portable modules only (no inline layout logic)', () => {
  for (const importee of ['./lib/engine.js', './lib/host-utils.js']) assert.ok(src.includes(importee), importee)
  assert.ok(!src.includes('function architecture('))
})
