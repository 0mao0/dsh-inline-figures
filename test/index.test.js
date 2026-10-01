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
  // Section must hide itself when the tool is not visible to the agent scope.
  assert.match(src, /ctx\.tools\.get\('draw_figure', scope\)/)
})

test('output contract matches the portable render fields', () => {
  assert.match(src, /required: \['path', 'markdown', 'warnings'\]/)
  assert.match(src, /render: \(_args, value\) =>/)
})

test('delegates to portable modules only (no inline layout logic)', () => {
  for (const importee of ['./lib/engine.js', './lib/host-utils.js']) assert.ok(src.includes(importee), importee)
  assert.ok(!src.includes('function architecture('))
})
