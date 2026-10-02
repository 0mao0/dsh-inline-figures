import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawFigure, FigureError, validateSpec, sanitizeSvg, GUIDANCE_TEXT, GUIDANCE_TITLE } from '../lib/engine.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('drawFigure dispatches to the layout engine', () => {
  const r = drawFigure({
    kind: 'architecture',
    title: 't',
    layers: [
      { label: 'a', nodes: [{ label: 'x' }] },
      { label: 'b', nodes: [{ label: 'y' }] },
    ],
  })
  assert.ok(r.svg.startsWith('<?xml'))
  assert.ok(r.svg.includes('width="1600"'))
  assert.deepEqual(r.warnings, [])
})

test('drawFigure throws FigureError SPEC_INVALID with field paths', () => {
  try {
    drawFigure({ kind: 'chart', title: 't', chartType: 'bar', data: [] })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof FigureError)
    assert.equal(error.code, 'SPEC_INVALID')
    assert.match(error.message, /spec\.data/)
  }
})

test('raw_svg routes through the sanitizer', () => {
  const r = drawFigure({ kind: 'raw_svg', svg: '<svg viewBox="0 0 100 100"><rect onclick="x"/></svg>' })
  assert.ok(!r.svg.includes('onclick'))
  assert.ok(r.warnings.length > 0)
})

test('engine re-exports the portable API surface', () => {
  assert.equal(typeof validateSpec, 'function')
  assert.equal(typeof sanitizeSvg, 'function')
  assert.equal(GUIDANCE_TITLE, 'inline-figures:guidance')
  assert.match(GUIDANCE_TEXT, /draw_figure/)
  assert.match(GUIDANCE_TEXT, /VERBATIM/)
  assert.match(GUIDANCE_TEXT, /one figure = one topic/)
  assert.match(GUIDANCE_TEXT, /WHEN TO DRAW/)
  // Semi-mandatory trigger (product decision): describing a structure MUST draw it,
  // with an explicit exemption for one-line factual lookups / definitions / code.
  assert.match(GUIDANCE_TEXT, /you MUST draw it/)
  assert.match(GUIDANCE_TEXT, /EXEMPTION/)
  // SVG-first ordering is a product decision: free-form SVG primary, JSON presets fallback.
  assert.match(GUIDANCE_TEXT, /SVG FIRST/)
  assert.match(GUIDANCE_TEXT, /never ASCII art/)
  const freeform = GUIDANCE_TEXT.indexOf('Free-form SVG (primary)')
  const preset = GUIDANCE_TEXT.indexOf('Preset spec (fallback)')
  assert.ok(freeform > 0 && preset > freeform, 'raw_svg must be listed as primary before preset fallback')
})

test('portability boundary: lib/ never imports @deepseek-ai or cordis', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  const files = walk(path.join(root, 'lib')).filter((f) => f.endsWith('.js'))
  assert.ok(files.length >= 9, 'engine modules discovered')
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(!src.includes('@deepseek-ai/'), `${path.basename(file)} must stay DSH-free`)
    assert.ok(!src.includes("from 'cordis"), `${path.basename(file)} must not import cordis`)
  }
})
