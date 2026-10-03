import test from 'node:test'
import assert from 'node:assert/strict'
import { W, M, OUT_W, esc, textWidth, wrapText, ellipsis, styleBlock, svgDoc, titleLine } from '../lib/primitives.js'

test('constants: canvas geometry', () => {
  assert.equal(W, 680)
  assert.equal(OUT_W, 1600)
  assert.ok(M > 8 && M < 64)
})

test('esc: escapes all XML-special characters', () => {
  assert.equal(esc('a<b>c'), 'a&lt;b&gt;c')
  assert.equal(esc('x&y'), 'x&amp;y')
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;')
  assert.equal(esc("it's"), 'it&apos;s')
})

test('textWidth: CJK wider per char than latin; empty is zero', () => {
  assert.equal(textWidth(''), 0)
  assert.ok(textWidth('汉字') > textWidth('ab'))
  assert.ok(textWidth('汉字汉字') > textWidth('abcd'))
})

test('wrapText: keeps content, wraps to width, breaks a single overlong token', () => {
  const out = wrapText('这是一个非常非常长的中文标签需要折行处理它', 80)
  assert.ok(Array.isArray(out) && out.length > 1)
  assert.equal(out.join(''), '这是一个非常非常长的中文标签需要折行处理它')
  for (const line of out) assert.ok(textWidth(line) <= 80 + 1e-6, `line overflows: ${line}`)
  const oneWord = wrapText('supercalifragilisticexpialidocious', 40)
  assert.ok(oneWord.length >= 2)
  assert.equal(oneWord.join(''), 'supercalifragilisticexpialidocious')
})

test('wrapText: splits latin on word boundaries when possible', () => {
  const out = wrapText('alpha beta gamma delta', 60)
  assert.ok(out.every((line) => /^[a-z ]+$/.test(line)))
  assert.equal(out.join(' ').replace(/\s+/g, ' ').trim(), 'alpha beta gamma delta')
})

test('ellipsis: leaves short text, truncates long text with … within budget', () => {
  const short = ellipsis('short', 200)
  assert.equal(short.text, 'short')
  assert.equal(short.truncated, false)
  const long = ellipsis('这是一个很长很长的中文标题内容需要截断处理', 60)
  assert.ok(long.truncated)
  assert.ok(long.text.endsWith('…'))
  assert.ok(textWidth(long.text) <= 60 + 1e-6)
})

test('styleBlock: light defaults with dark media override', () => {
  const s = styleBlock()
  assert.match(s, /prefers-color-scheme:\s*dark/)
  assert.match(s, /\.box\s*\{/)
  assert.match(s, /\.chip\s*\{/)
  assert.match(s, /\.t\s*\{/)
})

test('svgDoc: intrinsic width 1600, viewBox width 680, marker def present', () => {
  const doc = svgDoc(200, '<rect class="box" x="1" y="1" width="10" height="10"/>')
  assert.match(doc, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 680 200"/)
  assert.match(doc, /width="1600"/)
  assert.match(doc, /<style>/)
  assert.match(doc, /marker id="arr"/)
  assert.ok(doc.endsWith('</svg>'))
  const outH = Math.round((OUT_W * 200) / W)
  assert.match(doc, new RegExp(`height="${outH}"`))
})

test('titleLine: rendered as t-class text node at page margin', () => {
  const t = titleLine('测试 & <安全>')
  assert.match(t, new RegExp(`x="${M}"`))
  assert.match(t, /class="t"/)
  assert.ok(t.includes('测试 &amp; &lt;安全&gt;'))
})
