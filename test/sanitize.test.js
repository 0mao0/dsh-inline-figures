import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSvg, SanitizeError } from '../lib/sanitize.js'

const codeOf = (fn) => {
  try {
    fn()
    return null
  } catch (error) {
    assert.ok(error instanceof SanitizeError, `expected SanitizeError, got ${error}`)
    return error.code
  }
}
const BASIC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 200"><rect width="10" height="10"/></svg>'

test('basic svg passes and gets full-width sizing', () => {
  const { svg, warnings } = sanitizeSvg(BASIC)
  assert.deepEqual(warnings, [])
  assert.match(svg, /width="1600" height="471"/)
})

test('author width/height attributes are overridden from viewBox ratio', () => {
  const { svg } = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="10" height="5"><rect/></svg>')
  assert.match(svg, /width="1600" height="800"/)
})

test('rejects script / entity / doctype / iframe', () => {
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>')), 'SVG_REJECTED')
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 10 10"><!ENTITY x "y">x</svg>')), 'SVG_REJECTED')
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 10 10"><!DOCTYPE weird></svg>')), 'SVG_REJECTED')
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 10 10"><iframe src="x"/></svg>')), 'SVG_REJECTED')
})

test('strips event attributes, external hrefs, images, foreignObject, comments', () => {
  const { svg, warnings } = sanitizeSvg([
    '<svg viewBox="0 0 100 100">',
    '<!-- sneaky comment -->',
    '<rect onclick="alert(1)" onload=\'boom\' width="9"/>',
    '<a href="https://evil.example"><rect/></a>',
    '<image href="data:image/png;base64,AAA"/>',
    '<use xlink:href="http://remote/x.svg#y"/>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>',
    '</svg>',
  ].join(''))
  assert.ok(!svg.includes('onclick') && !svg.includes('onload'), svg)
  assert.ok(!svg.includes('evil.example'))
  assert.ok(!svg.includes('base64'))
  assert.ok(!svg.includes('remote'))
  assert.ok(!svg.toLowerCase().includes('foreignobject><div'))
  assert.ok(!svg.includes('sneaky'))
  assert.ok(warnings.some((w) => w.includes('event attributes')))
  assert.ok(warnings.some((w) => w.includes('href')))
  assert.ok(warnings.some((w) => w.includes('image')))
  assert.ok(warnings.some((w) => w.includes('foreignObject')))
})

test('safe internal references survive', () => {
  const { svg, warnings } = sanitizeSvg('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect fill="url(#g)"/></svg>')
  assert.ok(svg.includes('url(#g)'))
  assert.deepEqual(warnings, [])
})

test('structure errors', () => {
  assert.equal(codeOf(() => sanitizeSvg('<svg><rect/></svg>')), 'SVG_VIEWBOX')
  assert.equal(codeOf(() => sanitizeSvg('<div/>')), 'SVG_ROOT')
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 10 10"><svg viewBox="0 0 5 5"/></svg>')), 'SVG_ROOT')
  assert.equal(codeOf(() => sanitizeSvg('<svg viewBox="0 0 0 0"></svg>')), 'SVG_VIEWBOX')
})
