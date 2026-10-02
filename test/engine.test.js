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
  assert.match(GUIDANCE_TEXT, /one figure = one idea/i)
  assert.match(GUIDANCE_TEXT, /WHEN TO DRAW/)
  // Trigger posture (product decision): judge by comparison but LEAN toward drawing;
  // a figure REPLACES the paragraph it covers (cures "too little figure, too much text").
  assert.match(GUIDANCE_TEXT, /lean toward drawing/)
  assert.match(GUIDANCE_TEXT, /at least one figure/)
  assert.match(GUIDANCE_TEXT, /figures replace prose, they do not stack on it/)
  assert.match(GUIDANCE_TEXT, /DENSITY/)
  // Guard against BOTH old failure modes: no forced quota AND no prose-default under-draw.
  assert.ok(!/you MUST draw it/.test(GUIDANCE_TEXT), 'must not force a figure (regression to semi-mandatory)')
  assert.ok(!/many use none/.test(GUIDANCE_TEXT), 'must not default to no-figures (regression to under-draw)')
  // Analysis / evaluation / "should we use X" is NOT exempt as "just discussion" - the
  // Clef session drew zero figures because the guidance left evaluative answers ambiguous.
  assert.match(GUIDANCE_TEXT, /NOT exempt for being "just discussion"/)
  assert.match(GUIDANCE_TEXT, /feasibility|decision|trade-off/)
  // Closed exemption list: only atomic replies skip; category-words cannot claim exemption.
  assert.match(GUIDANCE_TEXT, /exempt ONLY for atomic replies/)
  assert.match(GUIDANCE_TEXT, /"Explanatory", "analytical", "evaluative" and "discursive" are NOT exempt/)
  // Controlled prose is the DEFAULT writing style (product decision, from Karpathy's
  // ASD-STE100 tip): ~80% ASD-STE100 for explanatory prose, figures are its strictest tier.
  assert.match(GUIDANCE_TEXT, /ASD-STE100/)
  assert.match(GUIDANCE_TEXT, /PROSE/)
  assert.match(GUIDANCE_TEXT, /80%/)
  // Count breakdowns are a chart signal, not an exempt "single value" (regression guard:
  // a distribution must not be pushed into prose/table by the exemption).
  assert.match(GUIDANCE_TEXT, /A multi-row table or bullet list of counts\/proportions/)
  assert.match(GUIDANCE_TEXT, /atomic and exempt/)
  // SVG-first ordering is a product decision: free-form SVG primary, JSON presets fallback.
  assert.match(GUIDANCE_TEXT, /SVG FIRST/)
  assert.match(GUIDANCE_TEXT, /never ASCII art/)
  const freeform = GUIDANCE_TEXT.indexOf('Free-form SVG (primary)')
  const preset = GUIDANCE_TEXT.indexOf('Preset spec (fallback)')
  assert.ok(freeform > 0 && preset > freeform, 'raw_svg must be listed as primary before preset fallback')
  // Color model: transparent canvas + theme surfaces; color on strokes/text/bars.
  assert.match(GUIDANCE_TEXT, /tint1/)
  assert.match(GUIDANCE_TEXT, /\.accent1/)
  assert.match(GUIDANCE_TEXT, /Colored titles\/labels/)
  assert.match(GUIDANCE_TEXT, /NOT as a tinted fill/)
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
